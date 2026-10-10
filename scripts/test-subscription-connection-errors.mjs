// Real Worker with isolated migrated SQLite and synthetic receiving callbacks.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(['alpha','beta'].map(id=>({email:id+'@example.test',role:'member'})))};
for(const id of ['alpha','beta'])sql.prepare('INSERT INTO accounts (email,user_id,role,enabled) VALUES (?,?,?,1)').run(id+'@example.test',id,'member');
sql.prepare('INSERT INTO discords (id,owner,name,connection_url,guild_id,channel_id,bot_token) VALUES (?,?,?,?,?,?,?)').run('shared','alpha','Shared','','123456789012345678','234567890123456789','synthetic_bot_token');
const secret='whsec_'+Buffer.alloc(32,8).toString('base64');
let events=[],callbackStatus=204,verificationCalls=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(body.type==='verification'){verificationCalls++;return Response.json({challenge:body.challenge});}events.push({url,body});return new Response(null,{status:callbackStatus});};
async function rpc(who,method,params){const response=await worker.fetch(new Request('https://relay.test/mcp',{method:'POST',headers:{'content-type':'application/json',origin:'https://relay.test','oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);return {status:response.status,...await response.json()};}
async function tool(who,name,args={}){const r=await rpc(who,'tools/call',{name,arguments:args});assert.ok(!r.error,JSON.stringify(r));return JSON.parse(r.result.content[0].text);}
async function subscribe(who,args={}){const r=await rpc(who,'events/subscribe',{name:'dot.mentioned',arguments:args,delivery:{mode:'webhook',url:'https://chatgpt.com/mock/'+who,secret},ttlMs:60000});assert.ok(!r.error,JSON.stringify(r));return r.result;}
async function register(who,handle){return tool(who,'register_dot',{dot_id:handle,discord_id:'shared'});}
try{
 await register('alpha','receiver');
 const binding=(await tool('alpha','get_wake_status')).account_binding;
 const delivery={mode:'webhook',url:'https://chatgpt.com/mock/receiver',secret};
 const tokenResponse=await worker.fetch(new Request('https://relay.test/api/tokens',{method:'POST',headers:{'content-type':'application/json',origin:'https://relay.test','oai-authenticated-user-id':'alpha','oai-authenticated-user-email':'alpha@example.test'},body:JSON.stringify({name:'wake'})}),env);
 const tokenBody=await tokenResponse.json();assert.equal(tokenResponse.status,201,JSON.stringify(tokenBody));
 for(const method of ['events/subscribe','events/unsubscribe']){
  for(const [args,reason] of [[{dot_id:'receiver'},'wrong_connected_account'],[{account_binding:binding},'wrong_connected_account'],[{dot_id:'missing'},'handle_not_registered']]){
   const result=await rpc('beta',method,{name:'dot.mentioned',arguments:args,delivery});
   assert.equal(result.status,200);assert.equal(result.error.code,-32016);assert.equal(result.error.data.reason,reason);
   assert.equal(verificationCalls,0,'Denied requests never verify a callback');
   const encoded=JSON.stringify(result);for(const sensitive of [secret,delivery.url,'alpha@example.test'])assert.ok(!encoded.includes(sensitive),'No credentials or owning identity in errors');
  }
  const request=new Request('https://relay.test/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokenBody.secret},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{name:'dot.mentioned',arguments:{dot_id:'receiver'},delivery}})});
  const response=await worker.fetch(request,env),result=await response.json();assert.equal(response.status,200);assert.equal(result.error.code,-32017);assert.equal(result.error.data.reason,'wake_token_cannot_subscribe');assert.equal(verificationCalls,0);
 }
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,0);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM security_audit WHERE action IN ('events/subscribe','events/unsubscribe') AND outcome='denied'").get().n,8);
 const success=await rpc('alpha','events/subscribe',{name:'dot.mentioned',arguments:{dot_id:'receiver',account_binding:binding},delivery});assert.equal(success.status,200);assert.ok(success.result.id);assert.equal(verificationCalls,1);
 const deniedDelete=await rpc('beta','events/unsubscribe',{name:'dot.mentioned',arguments:{dot_id:'receiver'},delivery});assert.equal(deniedDelete.error.data.reason,'wrong_connected_account');assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,1);
 const deleted=await rpc('alpha','events/unsubscribe',{name:'dot.mentioned',arguments:{dot_id:'receiver'},delivery});assert.deepEqual(deleted.result,{});assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,0);
 console.log('PASS: structured subscription connection errors, denied audit, callback ordering, owner success and wake token denial (mock callbacks).');
}finally{globalThis.fetch=originalFetch;sql.close();}
