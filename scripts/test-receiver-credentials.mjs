// Real Worker with isolated migrated SQLite and synthetic receiving callbacks.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
import companion from '../receiver/worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(['alpha','beta'].map(id=>({email:id+'@example.test',role:id==='alpha'?'owner':'member'})))};
for(const id of ['alpha','beta'])sql.prepare('INSERT INTO accounts (email,user_id,role,enabled) VALUES (?,?,?,1)').run(id+'@example.test',id,'member');
sql.prepare('INSERT INTO discords (id,owner,name,connection_url,guild_id,channel_id,bot_token) VALUES (?,?,?,?,?,?,?)').run('shared','alpha','Shared','','123456789012345678','234567890123456789','synthetic_bot_token');
const secret='whsec_'+Buffer.alloc(32,8).toString('base64');
let events=[],callbackStatus=204,verificationCalls=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(body.type==='verification'){verificationCalls++;return Response.json({challenge:body.challenge});}events.push({url,body,subscription:new Headers(options.headers).get("X-MCP-Subscription-Id")});return new Response(null,{status:callbackStatus});};
async function rpc(who,method,params){const response=await worker.fetch(new Request('https://relay.test/mcp',{method:'POST',headers:{'content-type':'application/json',origin:'https://relay.test','oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);return response.json();}
async function tool(who,name,args={}){const r=await rpc(who,'tools/call',{name,arguments:args});assert.ok(!r.error,JSON.stringify(r));return JSON.parse(r.result.content[0].text);}
async function subscribe(who,args={}){const r=await rpc(who,'events/subscribe',{name:'dot.mentioned',arguments:args,delivery:{mode:'webhook',url:'https://chatgpt.com/mock/'+who,secret},ttlMs:60000});assert.ok(!r.error,JSON.stringify(r));return r.result;}
async function register(who,handle){return tool(who,'register_dot',{dot_id:handle,discord_id:'shared'});}
let sequence=0;
async function mention(handle){sql.exec('DELETE FROM wake_limits');return tool('beta','send_mention',{sender:'sender',text:'@'+handle+' private message',message_id:'isolation-'+(++sequence)});}
async function management(who,method,body){return worker.fetch(new Request('https://relay.test/api/receivers',{method,headers:{'content-type':'application/json',origin:'https://relay.test','oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'},...(body?{body:JSON.stringify(body)}:{})}),env);}
async function receiver(secret,method,params){const response=await worker.fetch(new Request('https://relay.test/api/receiver',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({method,params})}),env);return {status:response.status,...await response.json()};}
const params={name:'dot.mentioned',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/mock/alpha',secret},ttlMs:604800000};
try{
 await register('alpha','recipient');await register('beta','sender');
 const created=await (await management('alpha','POST',{name:'Receiver',expires_in_days:1})).json();assert.match(created.secret,/^dcr_[\w-]{43}$/);
 const stored=sql.prepare('SELECT * FROM receiver_credentials WHERE id=?').get(created.receiver.id);assert.notEqual(stored.secret_hash,created.secret);assert.equal(stored.owner,'alpha');
 assert.equal(JSON.stringify(await (await management('alpha','GET')).json()).includes(created.secret),false);
 assert.deepEqual((await (await management('beta','GET')).json()).receivers,[]);
 assert.equal((await management('beta','DELETE',{id:created.receiver.id})).status,403);
 assert.equal((await receiver('wrong','status')).status,401);
 const wake=await worker.fetch(new Request('https://relay.test/api/wake',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+created.secret},body:JSON.stringify({message_id:'denied',text:'@recipient'})}),env);assert.equal(wake.status,401,'Receiver credential cannot send wakes');
 const foreign=await receiver(created.secret,'subscribe',{...params,arguments:{dot_id:'sender'}});assert.ok(foreign.error);assert.equal(verificationCalls,0);
 const native=await subscribe('alpha');
 const result=await receiver(created.secret,'subscribe',params);assert.ok(result.result,JSON.stringify(result));assert.notEqual(result.result.id,native.id);assert.ok(result.result.refreshBefore>created.receiver.expires,'Platform lease is separate from token authorization');
 assert.equal((await receiver(created.secret,'status')).result.active_subscriptions,2);
 events=[];await mention('recipient');assert.equal(events.length,2,'Mention resolves receiver and native subscriptions for recipient account');
 await rpc('alpha','events/unsubscribe',params);assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(result.result.id),'Native unsubscribe cannot remove receiver');assert.equal(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(native.id),undefined);
 const native2=await subscribe('alpha');await receiver(created.secret,'unsubscribe',params);assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(native2.id),'Receiver cannot remove native');
 await receiver(created.secret,'subscribe',params);await management('alpha','DELETE',{id:created.receiver.id});assert.equal((await receiver(created.secret,'status')).status,401);assert.equal((await tool('alpha','get_wake_status')).active_subscriptions,1);
 const second=await (await management('alpha','POST',{name:'Expiry',expires_in_days:1})).json();await receiver(second.secret,'subscribe',{...params,delivery:{...params.delivery,url:params.delivery.url+'/expiry'}});
 sql.prepare('UPDATE receiver_credentials SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',second.receiver.id);assert.equal((await receiver(second.secret,'status')).status,401);assert.equal((await tool('alpha','get_wake_status')).active_subscriptions,1);assert.equal((await tool('alpha','list_dots')).find(d=>d.dot_id==='recipient').subscriptions,1);
 events=[];await mention('recipient');assert.equal(events.length,1,'Expired credentials prevent delivery despite unexpired subscription');
 const third=await (await management('alpha','POST',{name:'Revoked during challenge'})).json();const before=globalThis.fetch;globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(body.type==='verification')sql.prepare('DELETE FROM receiver_credentials WHERE id=?').run(third.receiver.id);return before(url,options);};
 assert.equal((await receiver(third.secret,'subscribe',{...params,delivery:{...params.delivery,url:params.delivery.url+'/challenge'}})).status,401);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE receiver_id=?').get(third.receiver.id).n,0);globalThis.fetch=before;
 // Complete synthetic companion -> relay -> ChatGPT callback -> mention route.
 const paired=await (await management('alpha','POST',{name:'Companion roundtrip'})).json();
 const companionEnv={DOTCORD_ORIGIN:'https://relay.test',DOTCORD_RECEIVER_TOKEN:paired.secret,RECEIVER_SUBJECT:'receiver-platform-subject'};
 let relayCalls=0;const external=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{if(String(url)==='https://relay.test/api/receiver'){relayCalls++;assert.equal(new Headers(options.headers).has('oai-authenticated-user-id'),false);return worker.fetch(new Request(url,options),env);}return external(url,options);};
 const companionCall=async subject=>companion.fetch(new Request('https://receiver.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':subject},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'events/subscribe',params:{...params,delivery:{...params.delivery,url:params.delivery.url+'/companion'}}})}),companionEnv);
 assert.equal((await companionCall('other-subject')).status,403);assert.equal(relayCalls,0,'Wrong companion account cannot reach relay');
 const bridge=await (await companionCall('receiver-platform-subject')).json();assert.ok(bridge.result?.id,JSON.stringify(bridge));assert.equal(relayCalls,1);
 events=[];await mention('recipient');assert.ok(events.some(e=>e.body.data.dot_id==='recipient'&&e.subscription===bridge.result.id),'Shared app mention reaches companion-registered callback');
 await management('alpha','DELETE',{id:paired.receiver.id});globalThis.fetch=external;
 // Owner creation and metadata listing target allowed recipients; revocation stays self-only.
 const digest=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
 const alphaId=await digest('alpha@example.test'),betaId=await digest('beta@example.test');
 assert.equal((await management('beta','POST',{name:'Denied target',account_id:alphaId})).status,403);
 env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'alpha@example.test',role:'owner'},{email:'beta@example.test',role:'member'},{email:'new@example.test',role:'member'}]);
 const selectedResponse=await management('alpha','POST',{name:'Selected recipient',account_id:betaId});assert.equal(selectedResponse.status,201);
 const selected=await selectedResponse.json();assert.equal(sql.prepare('SELECT owner FROM receiver_credentials WHERE id=?').get(selected.receiver.id).owner,'beta');
 assert.deepEqual(selected.recipient,{account_id:betaId,email:'beta@example.test',is_self:false});
 const beforeList=sql.prepare('SELECT * FROM receiver_credentials ORDER BY id').all();
 // Even a due cleanup must not mutate credentials during this read.
 sql.prepare("UPDATE security_maintenance SET next_run=0 WHERE id='cleanup'").run();
 const ownerList=(await (await management('alpha','GET')).json()).receivers;
 assert.deepEqual(ownerList.find(r=>r.id===selected.receiver.id),{...selected.receiver,recipient:{email:'beta@example.test',is_self:false},can_revoke:true});
 assert.ok(ownerList.some(r=>r.recipient.is_self&&r.can_revoke));
 assert.deepEqual(sql.prepare('SELECT * FROM receiver_credentials ORDER BY id').all(),beforeList);
 assert.ok(!JSON.stringify(ownerList).includes(selected.secret));
 for(const row of ownerList){assert.deepEqual(Object.keys(row).sort(),['can_revoke','created','expires','id','name','recipient']);assert.deepEqual(Object.keys(row.recipient).sort(),['email','is_self']);}
 const memberList=(await (await management('beta','GET')).json()).receivers;
 assert.ok(memberList.every(r=>r.recipient.email==='beta@example.test'&&!r.can_revoke));
 // Orphaned, uninitialized, disabled, and removed accounts are never admin-list recipients.
 for(const [email,userId] of [['outside@example.test','outside'],['new@example.test',null],['empty@example.test','']]){
  sql.prepare('INSERT OR IGNORE INTO accounts (email,user_id,role,enabled) VALUES (?,?,?,1)').run(email,userId,'member');
 }
 for(const id of ['outside','orphan',''])sql.prepare('INSERT INTO receiver_credentials (id,owner,name,secret_hash,created,expires) VALUES (?,?,?,?,?,?)').run('hidden-'+id,id,'Hidden','hash-'+id,new Date().toISOString(),'2099-01-01T00:00:00.000Z');
 assert.ok(!(await (await management('alpha','GET')).json()).receivers.some(r=>r.id.startsWith('hidden-')));
 sql.prepare('UPDATE accounts SET enabled=0 WHERE user_id=?').run('beta');
 assert.ok(!(await (await management('alpha','GET')).json()).receivers.some(r=>r.id===selected.receiver.id));
 sql.prepare('UPDATE accounts SET enabled=1 WHERE user_id=?').run('beta');
 const configured=env.AUTHORIZED_ACCOUNTS;env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'alpha@example.test',role:'owner'}]);
 assert.ok(!(await (await management('alpha','GET')).json()).receivers.some(r=>r.id===selected.receiver.id));env.AUTHORIZED_ACCOUNTS=configured;
 assert.ok((await (await management('beta','GET')).json()).receivers.some(r=>r.id===selected.receiver.id));
 assert.equal((await management('beta','DELETE',{id:selected.receiver.id})).status,403);
 const audit=sql.prepare("SELECT actor,resource FROM security_audit WHERE action='receiver_create' AND outcome='success' AND resource LIKE ?").get(selected.receiver.id+'%');
 assert.equal(audit.actor,'account:'+await digest('alpha'));assert.equal(audit.resource,selected.receiver.id+':account:'+betaId);assert.ok(!JSON.stringify(audit).includes('@'));
 assert.equal((await receiver(selected.secret,'status')).result.account_binding,(await tool('beta','get_wake_status')).account_binding);
 assert.equal((await management('alpha','POST',{name:'Raw identity',user_id:'beta'})).status,400);
 assert.equal((await management('alpha','POST',{name:'Raw binding',account_binding:betaId})).status,400);
 assert.equal((await management('alpha','POST',{name:'Invalid',account_id:'beta'})).status,400);
 assert.equal((await management('alpha','POST',{name:'Unknown',account_id:'0'.repeat(64)})).status,403);
 assert.equal((await management('alpha','POST',{name:'Uninitialized',account_id:await digest('new@example.test')})).status,403);
 sql.prepare('UPDATE accounts SET enabled=0 WHERE user_id=?').run('beta');assert.equal((await management('alpha','POST',{name:'Disabled',account_id:betaId})).status,403);sql.prepare('UPDATE accounts SET enabled=1 WHERE user_id=?').run('beta');
 env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'alpha@example.test',role:'owner'}]);assert.equal((await management('alpha','POST',{name:'Removed',account_id:betaId})).status,403);
 env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'alpha@example.test',role:'owner'},{email:'beta@example.test',role:'member'}]);
 for(let i=1;i<20;i++)assert.equal((await management('alpha','POST',{name:'Target limit '+i,account_id:betaId})).status,201);
 assert.equal((await management('alpha','POST',{name:'Target full',account_id:betaId})).status,400);
 assert.equal((await management('alpha','POST',{name:'Issuer not full'})).status,201);
 await receiver(selected.secret,'subscribe',params);
 const untouched=await (await management('alpha','POST',{name:'Keep this receiver'})).json();
 assert.equal((await management('alpha','DELETE',{id:selected.receiver.id})).status,200);
 assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE receiver_id=?').get(selected.receiver.id),'Revocation retains the inactive platform registration');
 assert.ok(sql.prepare('SELECT id FROM receiver_credentials WHERE id=?').get(untouched.receiver.id));
 env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'alpha@example.test',role:'member'},{email:'beta@example.test',role:'member'}]);assert.equal((await management('alpha','POST',{name:'Demoted issuer',account_id:betaId})).status,403);
 const fourth=await (await management('alpha','POST',{name:'Current access'})).json();env.AUTHORIZED_ACCOUNTS=JSON.stringify([{email:'beta@example.test',role:'member'}]);assert.equal((await receiver(fourth.secret,'status')).status,401);
 console.log('PASS: receiver credential issuance, hash-only storage, owner isolation, restricted authority, namespace isolation, mention delivery, expiry/revocation/readiness, in-flight revocation, current allowlist. Synthetic callbacks only.');
}finally{globalThis.fetch=originalFetch;sql.close();}
