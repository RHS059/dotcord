// Real Worker + migrated SQLite; every callback is mocked. No live wake is sent.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import worker from '../worker/index.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
let auditFault=()=>false,receiptFault=false;
const DB={async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>{if(query.startsWith('INSERT INTO security_audit')&&auditFault(args))throw Error('Synthetic audit failure');if(query.startsWith('UPDATE wake_tests')&&receiptFault)throw Error('Synthetic receipt failure');return {meta:{changes:sql.prepare(query).run(...args).changes}};}}}}}};
const identities=['admin','member','other','disabled','removed'];
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(identities.filter(id=>id!=='removed').map(id=>({email:id+'@example.test',role:id==='admin'?'owner':'member'})))};
for(const id of identities){sql.prepare('INSERT INTO accounts(email,user_id,role,enabled,primary_dot) VALUES (?,?,?,?,?)').run(id+'@example.test',id,id==='admin'?'owner':'member',id==='disabled'?0:1,id+'_dot');sql.prepare('INSERT INTO dots(id,owner,created,agent_type,discord_id) VALUES (?,?,?,?,?)').run(id+'_dot',id,new Date().toISOString(),'dot','destination');}
sql.prepare('INSERT INTO dots(id,owner,created,agent_type,discord_id) VALUES (?,?,?,?,?)').run('member_agent','member',new Date().toISOString(),'agent','destination');
sql.prepare('INSERT INTO discords(id,owner,name,connection_url,guild_id,channel_id,bot_token) VALUES (?,?,?,?,?,?,?)').run('destination','admin','Synthetic','','123456789012345678','234567890123456789','SYNTHETIC_PRIVATE_BOT');
const secret='whsec_'+Buffer.alloc(32,42).toString('base64');
function subscribe(id='sub_member',owner='member',scope='account',receiver=null){sql.prepare('INSERT OR REPLACE INTO subscriptions(id,owner,dot,url,secret,expires,scope,receiver_id) VALUES (?,?,?,?,?,?,?,?)').run(id,owner,scope==='handle'?owner+'_dot':'','https://chatgpt.com/test-wake/'+id,secret,'2099-01-01',scope,receiver);}
subscribe();subscribe('sub_other','other');
const token='t'.repeat(43);sql.prepare('INSERT INTO api_tokens(id,name,prefix,token_hash,created,owner,expires) VALUES (?,?,?,?,?,?,?)').run('token','Synthetic','tttt',hash(token),new Date().toISOString(),'member','2099-01-01');
const calls=[],originalFetch=globalThis.fetch;
let replyStatus=204,gate=null;
globalThis.fetch=async(url,options)=>{assert.ok(url.startsWith('https://chatgpt.com/test-wake/'),'No Discord post or arbitrary callback allowed');assert.equal(options.redirect,'manual');assert.ok(options.headers['webhook-signature']);assert.ok(options.headers['webhook-id']);const payload=JSON.parse(options.body);calls.push({url,payload,headers:options.headers});if(gate)await gate;return new Response(null,{status:typeof replyStatus==='function'?replyStatus(url):replyStatus});};
const requestId=()=>Date.now()+'_'+randomUUID();
async function request(body,{who='member',origin='https://wake.test',method='POST',bearer=null,environment=env}={}){const headers={'content-type':'application/json'};if(who){headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who+'@example.test';}if(origin)headers.origin=origin;if(bearer)headers.authorization='Bearer '+bearer;const r=await worker.fetch(new Request('https://wake.test/api/test-wake',{method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})}),environment);return {status:r.status,data:await r.json()};}
const test=(options={},body={})=>request({dot_id:'member_dot',request_id:requestId(),...body},options);
const reset=()=>{sql.prepare('DELETE FROM wake_limits').run();replyStatus=204;gate=null;auditFault=()=>false;receiptFault=false;};
try{
 for(const options of [{who:null},{origin:'https://hostile.test'},{origin:null},{bearer:token}]){const n=calls.length;assert.ok((await test(options)).status>=400);assert.equal(calls.length,n);}
 assert.equal((await test({method:'GET'})).status,405);
 assert.equal((await test({}, {recipients:['other_dot']})).status,400);
 assert.equal((await test({}, {callback_url:'https://hostile.test'})).status,400);
 assert.equal((await test({}, {dot_id:'other_dot'})).status,403);
 for(const dot of ['disabled_dot','removed_dot','member_agent'])assert.equal((await test({who:'admin'},{dot_id:dot})).status,403);
 const id=requestId();const accepted=await test({}, {request_id:id});assert.equal(accepted.status,200);assert.equal(accepted.data.status,'accepted');assert.equal(accepted.data.agent_execution_confirmed,false);assert.equal(accepted.data.results[0].attempts,1);assert.equal(calls.length,1);assert.equal(calls[0].payload.data.message_id,accepted.data.message_id);assert.equal(calls[0].payload.data.dot_id,'member_dot');
 assert.equal(calls[0].payload.data.sender,'Dotcord Test wake');assert.ok(calls[0].payload.data.text.includes('Test wake'));
 const inbox=sql.prepare('SELECT payload FROM temporary_inbox WHERE id=?').get(accepted.data.results[0].inbox_id);assert.equal(JSON.parse(inbox.payload).message_id,accepted.data.message_id);
 const retry=await test({}, {request_id:id});assert.equal(retry.data.replayed,true);assert.equal(retry.data.status,'accepted');assert.equal(calls.length,1);
 assert.equal((await test()).data.status,'rate_limited');assert.equal(calls.length,1);
 reset();const admin=await test({who:'admin'},{dot_id:'other_dot'});assert.equal(admin.data.status,'accepted');assert.equal(calls.at(-1).payload.data.dot_id,'other_dot');
 assert.equal((await test({who:'admin'},{dot_id:'member_dot',request_id:admin.data.request_id})).status,400,'Cannot retarget the same click');
 // Concurrent HTTP retries share an atomic claim; only one starts delivery.
 reset();let release;gate=new Promise(resolve=>{release=resolve;});const raceId=requestId(),before=calls.length;const first=test({}, {request_id:raceId});while(calls.length===before)await new Promise(r=>setTimeout(r,1));
 const duplicate=await test({}, {request_id:raceId});assert.equal(duplicate.data.status,'in_progress');assert.equal(duplicate.data.replayed,true);assert.equal(calls.length,before+1);release();gate=null;assert.equal((await first).data.status,'accepted');assert.equal((await test({}, {request_id:raceId})).data.status,'accepted');assert.equal(calls.length,before+1);
 // Missing configuration reports useful state, with no notification/inbox writes.
 reset();sql.prepare('DELETE FROM subscriptions WHERE owner=?').run('member');let n=calls.length,inboxCount=sql.prepare('SELECT COUNT(*) n FROM temporary_inbox').get().n;
 assert.equal((await test()).data.status,'not_subscribed');assert.equal(calls.length,n);assert.equal(sql.prepare('SELECT COUNT(*) n FROM temporary_inbox').get().n,inboxCount);
 sql.prepare('UPDATE dots SET discord_id=NULL WHERE id=?').run('member_dot');assert.equal((await test()).data.status,'destination_required');sql.prepare('UPDATE dots SET discord_id=? WHERE id=?').run('destination','member_dot');
 // Receiver expiry/revocation and handle-scoped subscriptions use the existing filter.
 sql.prepare('INSERT INTO receiver_credentials(id,owner,name,secret_hash,created,expires) VALUES (?,?,?,?,?,?)').run('revoked','member','Synthetic',hash('synthetic'),new Date().toISOString(),'2099-01-01');subscribe('sub_revoked','member','account','revoked');sql.prepare('DELETE FROM receiver_credentials WHERE id=?').run('revoked');assert.equal((await test()).data.status,'not_subscribed');subscribe('sub_member','member','handle');assert.equal((await test()).data.status,'accepted');
 reset();subscribe('sub_second','member');replyStatus=url=>url.endsWith('sub_second')?400:204;const partial=await test();assert.equal(partial.data.status,'partial');assert.equal(partial.data.results.filter(r=>r.status==='accepted').length,1);assert.equal(partial.data.results.filter(r=>r.status==='rejected').length,1);
 reset();replyStatus=503;const failed=await test();assert.equal(failed.data.status,'failed');assert.ok(failed.data.results.every(r=>r.status==='transient'&&r.attempts===3));const eventIds=calls.slice(-6).map(c=>c.headers['webhook-id']);assert.equal(eventIds[0],eventIds[1]);assert.equal(eventIds[1],eventIds[2]);n=calls.length;assert.equal((await test({}, {request_id:failed.data.request_id})).data.replayed,true);assert.equal(calls.length,n,'A retry never restarts exhausted callbacks');
 reset();auditFault=args=>args[3]==='test_wake'&&args[4]==='attempt';n=calls.length;assert.equal((await test()).status,503);assert.equal(calls.length,n,'Audit preflight fails closed');
 reset();auditFault=args=>args[3]==='test_wake_delivery'&&args[4]==='accepted';const audit=await test();assert.equal(audit.data.status,'accepted');assert.equal(audit.data.audit_warning,'audit_unavailable');n=calls.length;await test({}, {request_id:audit.data.request_id});assert.equal(calls.length,n);
 reset();receiptFault=true;const uncertain=await test();assert.equal(uncertain.data.status,'unknown');assert.equal(uncertain.data.receipt_warning,'receipt_unavailable');assert.equal(uncertain.data.results[0].status,'accepted');n=calls.length;receiptFault=false;assert.equal((await test({}, {request_id:uncertain.data.request_id})).data.status,'in_progress');assert.equal(calls.length,n);
 reset();const oldId=(Date.now()-2*86400000)+'_'+randomUUID();assert.equal((await test({}, {request_id:oldId})).status,400);assert.equal((await test({}, {request_id:(Date.now()+3600000)+'_'+randomUUID()})).status,400);
 // Even a receipt that has aged out cannot reopen its original request ID.
 const expiredReceipt='test_'+hash(JSON.stringify(['member',oldId]));sql.prepare('INSERT INTO wake_tests VALUES (?,?,?,?,?,?)').run(expiredReceipt,'member','member_dot','member',Date.now()-2*86400000,JSON.stringify({status:'accepted',results:[]}));sql.prepare('DELETE FROM security_maintenance').run();n=calls.length;assert.equal((await test({}, {request_id:oldId})).status,400);assert.equal(calls.length,n);assert.equal(sql.prepare('SELECT id FROM wake_tests WHERE id=?').get(expiredReceipt),undefined);
 const safe=JSON.stringify([accepted.data,partial.data,uncertain.data,sql.prepare('SELECT result FROM wake_tests').all(),sql.prepare('SELECT * FROM security_audit').all()]);for(const value of [secret,token,'SYNTHETIC_PRIVATE_BOT','https://chatgpt.com/test-wake/'])assert.equal(safe.includes(value),false,'No secret or callback URL in results/receipts/audit');
 console.log('PASS Test wake: auth/CSRF/roles, current recipient ownership, existing saved subscriptions, signed callback and inbox, explicit accepted vs execution, missing/partial/failed/rate-limited outcomes, atomic duplicate suppression, audit/receipt faults, old-ID replay protection and secret-free responses. All callbacks mocked.');
}finally{globalThis.fetch=originalFetch;sql.close();}
