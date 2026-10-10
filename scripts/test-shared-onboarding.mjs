// Real Worker and transactional SQLite; Discord and MCP receivers are synthetic.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={batch(items){sql.exec('BEGIN');try{const out=items.map(i=>i.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return{bind(...args){return{first:()=>sql.prepare(q).get(...args)||null,all:()=>({results:sql.prepare(q).all(...args)}),run:()=>sql.prepare(q).run(...args)}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(['admin','aella','halcyon'].map(id=>({email:id+'@example.test',role:id==='admin'?'owner':'member'})))};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function req(path,body,who='admin',options={}){
 const headers={'content-type':'application/json',origin:'https://shared.test'};
 if(options.token)headers.authorization='Bearer '+options.token;else if(who){headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who+'@example.test';}
 const r=await worker.fetch(new Request('https://shared.test'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),env);
 return {status:r.status,data:await r.json()};
}
async function tool(name,args={},who='admin',options={}){return req('/api/tool',{name,arguments:args},who,options);}
async function okTool(name,args={},who='admin'){const r=await tool(name,args,who);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
const originalFetch=globalThis.fetch,events=[];
const guild='123456789012345678',channel='234567890123456789',otherChannel='234567890123456780';
const hook='https://discord.com/api/webhooks/434567890123456789/'+'x'.repeat(60);
let patches=0;
globalThis.fetch=async(url,options={})=>{
 if(url.startsWith('https://chatgpt.com/shared-fixture/')){
  const event=JSON.parse(options.body);assert.ok(options.headers['webhook-signature']);
  if(event.type==='verification')return Response.json({challenge:event.challenge});
  events.push(event);return new Response(null,{status:204});
 }
 if(url.startsWith(hook+'/messages/')){if(options.method==='PATCH'){patches++;assert.deepEqual(JSON.parse(options.body).allowed_mentions,{parse:[]});}return Response.json({id:'534567890123456789',channel_id:channel});}
 throw Error('Unexpected network request: '+url);
};
try{
 assert.equal((await req('/api/account',null)).status,200);
 const c=await okTool('add_discord',{name:'Shared',channel_url:`https://discord.com/channels/${guild}/${channel}`,bot_token:'synthetic_shared_bot_token'});
 const other=await okTool('add_discord',{name:'Other',channel_url:`https://discord.com/channels/${guild}/${otherChannel}`,bot_token:'synthetic_shared_bot_token'});
 const secrets={};
 for(const who of ['aella','halcyon']){
  const invitation=await req('/api/invitations',{account_id:digest(who+'@example.test'),dot_id:who,discord_id:c.id});assert.equal(invitation.status,201,JSON.stringify(invitation));
  const invite=new URL(invitation.data.url).hash.slice('#invite='.length);
  assert.equal((await req('/api/onboarding',{invite,action:'accept'},who==='aella'?'halcyon':'aella')).status,403,'Invitation bound to verified email');
  const results=await Promise.all(Array.from({length:5},()=>req('/api/onboarding',{invite,action:'accept'},who)));
  const success=results.filter(r=>r.status===201);assert.equal(success.length,1,JSON.stringify(results));
  const result=success[0].data;secrets[who]=result.secret;assert.equal(result.subscription_required,true);assert.equal(result.token.dot,who);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens WHERE owner=?').get(who).n,1);
  assert.equal(sql.prepare('SELECT token_hash FROM api_tokens WHERE owner=?').get(who).token_hash,digest(result.secret));
  assert.equal((await req('/api/onboarding',{invite,action:'accept'},who)).status,403);
  const subscribe=await req('/mcp',{jsonrpc:'2.0',id:1,method:'events/subscribe',params:{name:'dot.mentioned',arguments:{dot_id:who},delivery:{mode:'webhook',url:'https://chatgpt.com/shared-fixture/'+who,secret:'whsec_'+Buffer.alloc(32,1).toString('base64')}}},who);
  assert.ok(subscribe.data.result?.id,JSON.stringify(subscribe));
 }
 const adminList=await okTool('list_dots');assert.ok(adminList.every(d=>d.can_manage&&d.subscriptions===1));
 const memberList=await okTool('list_dots',{},'aella');assert.equal(memberList.find(d=>d.dot_id==='halcyon').can_manage,0);
 const wake=await okTool('send_mention',{sender:'aella',message_id:'shared-aella-to-halcyon',text:'@halcyon hello'},'aella');assert.equal(wake.results[0].status,'accepted');
 assert.equal(events.at(-1).data.sender,'aella');
 const reply=await okTool('send_mention',{sender:'halcyon',message_id:'shared-halcyon-to-aella',text:'@aella hello'},'halcyon');assert.equal(reply.results[0].status,'accepted');assert.equal(events.at(-1).data.sender,'halcyon');
 let inbox=await okTool('list_pending_messages',{dot_id:'halcyon'});assert.equal(inbox.messages.length,1);
 const id=inbox.messages[0].inbox_id;
 assert.equal((await okTool('read_pending_message',{dot_id:'halcyon',inbox_id:id})).text,'@halcyon hello');
 assert.equal((await tool('read_pending_message',{dot_id:'halcyon',inbox_id:id},'aella')).status,403);
 await okTool('acknowledge_message',{dot_id:'halcyon',inbox_id:id});assert.equal((await okTool('list_pending_messages',{dot_id:'halcyon'},'halcyon')).messages.length,0);
 // Shared cooldown still applies across the OAuth and token paths.
 let scoped=await tool('send_mention',{recipients:['halcyon'],message_id:'token-same-window',text:'wake'},null,{token:secrets.aella});assert.equal(scoped.status,429);
 sql.exec('DELETE FROM wake_limits');
 scoped=await tool('send_mention',{recipients:['halcyon'],message_id:'token-aella-halcyon',text:'wake'},null,{token:secrets.aella});assert.equal(scoped.data.results[0].status,'accepted');assert.equal(events.at(-1).data.sender,'aella');
 await okTool('set_discord',{dot_id:'halcyon',discord_id:other.id});sql.exec('DELETE FROM wake_limits');
 scoped=await tool('send_mention',{recipients:['halcyon'],message_id:'cross-channel',text:'wake'},null,{token:secrets.aella});assert.equal(scoped.data.results[0].status,'different_discord');
 await okTool('set_discord',{dot_id:'halcyon',discord_id:c.id});
 await okTool('set_webhook',{dot_id:'halcyon',webhook_url:hook});assert.equal(sql.prepare('SELECT owner FROM dots WHERE id=?').get('halcyon').owner,'halcyon','Admin update preserves resource ownership');
 assert.equal((await tool('set_webhook',{dot_id:'halcyon',webhook_url:hook},'aella')).status,403);
 const args={dot_id:'halcyon',message_id:'534567890123456789',text:'Edited @aella'};
 assert.equal((await tool('edit_discord_message',args,'aella')).status,403);
 assert.equal((await tool('edit_discord_message',args,null,{token:secrets.halcyon})).status,403);
 const eventCount=events.length;assert.equal((await okTool('edit_discord_message',args,'halcyon')).edited,true);assert.equal((await okTool('edit_discord_message',args)).edited,true);assert.equal(patches,2);assert.equal(events.length,eventCount,'Edits never trigger duplicate wakes');
 await okTool('update_agent',{dot_id:'aella',handle:'aella_new',discord_id:c.id});assert.equal(sql.prepare('SELECT dot FROM api_tokens WHERE owner=?').get('aella').dot,'aella_new');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions WHERE dot=?').get('aella').n,0,'Rename requires a fresh recipient subscription');
 await okTool('delete_agent',{dot_id:'halcyon'});assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens WHERE dot=?').get('halcyon').n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions WHERE dot=?').get('halcyon').n,0);
 const auditText=JSON.stringify(sql.prepare('SELECT * FROM security_audit').all());for(const secret of [...Object.values(secrets),hook,'@halcyon hello'])assert.equal(auditText.includes(secret),false);
 console.log('PASS shared onboarding: concurrent one-time email-bound invitations, scoped first tokens, real subscription handshake, two-way OAuth/token routing, cooldown, owner inbox/config access, member isolation, message edit permissions/no duplicate wake, rename/delete lifecycle. External services mocked.');
}finally{globalThis.fetch=originalFetch;sql.close();}
