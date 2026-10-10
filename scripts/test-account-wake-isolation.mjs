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
async function rpc(who,method,params){const response=await worker.fetch(new Request('https://relay.test/mcp',{method:'POST',headers:{'content-type':'application/json',origin:'https://relay.test','oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);return response.json();}
async function tool(who,name,args={}){const r=await rpc(who,'tools/call',{name,arguments:args});assert.ok(!r.error,JSON.stringify(r));return JSON.parse(r.result.content[0].text);}
async function subscribe(who,args={}){const r=await rpc(who,'events/subscribe',{name:'dot.mentioned',arguments:args,delivery:{mode:'webhook',url:'https://chatgpt.com/mock/'+who,secret},ttlMs:60000});assert.ok(!r.error,JSON.stringify(r));return r.result;}
async function register(who,handle){return tool(who,'register_dot',{dot_id:handle,discord_id:'shared'});}
let sequence=0;
async function mention(handle){sql.exec('DELETE FROM wake_limits');return tool('beta','send_mention',{sender:'sender',text:'@'+handle+' private message',message_id:'isolation-'+(++sequence)});}
try{
 await register('beta','sender');
 const alphaBinding=(await tool('alpha','get_wake_status')).account_binding;
 const betaBinding=(await tool('beta','get_wake_status')).account_binding;
 assert.notEqual(alphaBinding,betaBinding);
 const wrong=await rpc('beta','events/subscribe',{name:'dot.mentioned',arguments:{account_binding:alphaBinding},delivery:{mode:'webhook',url:'https://chatgpt.com/mock/beta',secret}});
 assert.equal(wrong.error?.code,-32016,'Binding guard rejects wrong connected account');assert.equal(verificationCalls,0,'Wrong binding fails before callback verification');
 const sub=await subscribe('alpha',{account_binding:alphaBinding});
 assert.notEqual((await tool('alpha','get_wake_status')).state,'ready','Callback alone does not create a profile');
 await register('alpha','account');
 const legacy=await subscribe('alpha',{dot_id:'account'});assert.notEqual(legacy.id,sub.id,'Legacy handle named account cannot collide with account-scoped subscription');
 await tool('alpha','delete_agent',{dot_id:'account'});assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(sub.id));assert.equal(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(legacy.id),undefined);
 await register('alpha','original');assert.equal((await tool('alpha','get_wake_status')).state,'ready');
 await mention('original');assert.equal(events.length,1);assert.ok(events[0].url.endsWith('/alpha'));
 await tool('alpha','delete_agent',{dot_id:'original'});
 assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(sub.id),'Canonical subscription survives deletion');
 assert.notEqual((await tool('alpha','get_wake_status')).state,'ready');
 await register('beta','original');events=[];
 const reassigned=await mention('original');assert.equal(reassigned.results[0].status,'not_subscribed');assert.equal(events.length,0,'Old canonical callback cannot receive recreated handle under another owner');
 const dots=await tool('beta','list_dots');assert.equal(dots.find(d=>d.dot_id==='original').subscriptions,0);
 assert.ok((await rpc('alpha','events/subscribe',{name:'dot.mentioned',arguments:{dot_id:'original'},delivery:{mode:'webhook',url:'https://chatgpt.com/mock/alpha',secret}})).error,'Legacy filter cannot name another owner');
 await register('alpha','replacement');await mention('replacement');assert.equal(events.length,1,'Account subscription resumes for its canonical owner only');
 const oldExpiry=sql.prepare('SELECT expires FROM subscriptions WHERE id=?').get(sub.id).expires;
 sql.prepare('UPDATE dots SET discord_id=NULL WHERE id=?').run('replacement');assert.notEqual((await tool('alpha','get_wake_status')).state,'ready','Missing destination must not report ready');
 sql.prepare('UPDATE dots SET discord_id=? WHERE id=?').run('shared','replacement');
 // A callback error cannot extend its subscription TTL.
 callbackStatus=400;await mention('replacement');assert.equal(sql.prepare('SELECT expires FROM subscriptions WHERE id=?').get(sub.id).expires,oldExpiry);callbackStatus=204;
 sql.prepare('UPDATE subscriptions SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',sub.id);events=[];
 assert.notEqual((await tool('alpha','get_wake_status')).state,'ready');
 await register('alpha','replacement');assert.notEqual((await tool('alpha','get_wake_status')).state,'ready','Reconnect does not forge renewal');
 assert.equal((await mention('replacement')).results[0].status,'not_subscribed');assert.equal(events.length,0);
 // Persisted account subscriptions do not bypass the current access list.
 await subscribe('alpha');env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'beta@example.test',role:'member'}]);
 assert.equal((await mention('replacement')).results[0].status,'inactive');assert.equal(events.length,0);
 console.log('PASS: canonical account wake isolation, deletion/recreation ownership, foreign legacy filter denial, no readiness without profile/destination, no renewal on reconnect/errors, current allowlist enforcement. Mock callbacks only.');
}finally{globalThis.fetch=originalFetch;sql.close();}
