import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../worker/index.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f.slice(0,4)<'0009').sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const stamp=new Date().toISOString(),later=new Date(Date.now()+86400000).toISOString();
const token='s'.repeat(43),secret='whsec_'+Buffer.alloc(32,17).toString('base64');
const webhook='https://discord.com/api/webhooks/123456789012345678/SYNTHETIC_PRIVATE_WEBHOOK_1234567890';
const accounts=[['owner@example.test','owner','owner',1],['member@example.test','member','member',1],['disabled@example.test','disabled','member',0],['removed@example.test','removed','member',1]];
for(const a of accounts)sql.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(...a);
for(const [id,owner] of [['owner_dot','owner'],['member_dot','member'],['disabled_dot','disabled'],['removed_dot','removed']]){
 sql.prepare('INSERT INTO dots VALUES (?,?,?,?,?,?)').run(id,owner,stamp,'dot','saved_connection',webhook);
 sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub_'+id,owner,id,'https://chatgpt.com/mock/'+id,secret,later);
}
sql.prepare('INSERT INTO discords VALUES (?,?,?,?,?,?,?)').run('saved_connection','owner','Configured destination','','123456789012345678','234567890123456789','SYNTHETIC_PRIVATE_BOT_1234567890');
sql.prepare('INSERT INTO api_tokens VALUES (?,?,?,?,?)').run('legacy','Existing trusted label','ssss',hash(token),stamp);
sql.prepare('INSERT INTO api_tokens VALUES (?,?,?,?,?)').run('legacy_second','Another label','qqqq',hash('q'.repeat(43)),stamp);
const inbox='inbox_'+hash('old inbox');
sql.prepare('INSERT INTO temporary_inbox VALUES (?,?,?,?,?,?,?)').run(inbox,'member','member_dot',JSON.stringify({message_id:'original-private-id',sender:'original sender',text:'ORIGINAL_PRIVATE_BODY',event_ids:['evt_original']}),hash('fixture'),stamp,later);
const tables=['accounts','dots','discords','subscriptions','api_tokens','temporary_inbox'];
const snapshot=Object.fromEntries(tables.map(t=>[t,sql.prepare('SELECT * FROM '+t+' ORDER BY rowid').all().map(v=>({...v}))]));
const start=Date.now();sql.exec(readFileSync('drizzle/0009_wake_security.sql','utf8').replaceAll('--> statement-breakpoint',''));
for(const t of tables){const cols=Object.keys(snapshot[t][0]);const after=sql.prepare('SELECT '+cols.join(',')+' FROM '+t+' ORDER BY rowid').all().map(v=>({...v}));assert.deepEqual(after,snapshot[t],t+' data unchanged by additive migration');}
for(const row of sql.prepare('SELECT owner,expires FROM api_tokens').all()){assert.equal(row.owner,null);assert.ok(Date.parse(row.expires)>=start+30*86400000-2000);assert.ok(Date.parse(row.expires)<=Date.now()+30*86400000+2000);}
for(const t of ['security_audit','security_maintenance','wake_limits'])assert.equal(sql.prepare('SELECT COUNT(*) n FROM '+t).get().n,0);
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f.slice(0,4)>'0009').sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
assert.ok(sql.prepare('SELECT dot FROM api_tokens').all().every(row=>row.dot===null),'Existing tokens remain unscoped');
for(const row of snapshot.accounts){
 assert.equal(sql.prepare('SELECT status FROM accounts WHERE email=?').get(row.email).status,row.enabled?'active':'inactive','Status migration preserves existing activation/disablement');
}
const DB={async batch(statements){sql.exec('BEGIN');try{const values=[];for(const st of statements)values.push(await st.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return {bind(...a){return {first:async()=>sql.prepare(q).get(...a)||null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})}}}}};
const allow=accounts.filter(x=>x[1]!=='removed').map(([email,,role])=>({email,role}));
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(allow)};
const OriginalDate=Date;let time=Date.now();globalThis.Date=class extends OriginalDate{constructor(...a){super(...(a.length?a:[time]));}static now(){return time;}};
const originalFetch=globalThis.fetch,originalWarn=console.warn;let callbacks=0;const logs=[];console.warn=(x)=>logs.push(String(x));
globalThis.fetch=async(url,options)=>{assert.ok(url.startsWith('https://chatgpt.com/mock/'));callbacks++;assert.ok(options.headers['webhook-signature']);return new Response(null,{status:204});};
async function request(path,body,{who='owner',authToken,method=body?'POST':'GET',environment=env,origin='https://relay.test',extra={}}={}){
 const headers={'content-type':'application/json',...extra};if(who){headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who+'@example.test';}if(authToken)headers.authorization='Bearer '+authToken;if(origin)headers.origin=origin;
 const response=await worker.fetch(new Request('https://relay.test'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),environment);
 const json=await response.json();return {status:response.status,json,headers:response.headers};
}
const tool=(name,args,opts)=>request('/api/tool',{name,arguments:args},opts);
let seq=0;const wake=(recipients=['member_dot'],opts={})=>request('/api/wake',{message_id:'review-'+(++seq),text:'SYNTHETIC_PRIVATE_WAKE_BODY',recipients},{who:null,authToken:token,...opts});
try{
 assert.equal((await request('/api/account')).status,200);
 assert.equal((await request('/api/account',null,{who:'member'})).status,200);
 assert.equal((await request('/api/account',null,{who:'disabled'})).status,401);
 const unconfigured=await request('/api/account',null,{who:'removed'});assert.equal(unconfigured.status,200);assert.equal(unconfigured.json.can_manage_accounts,false);
 assert.equal((await request('/api/accounts',null,{who:'removed'})).status,403);
 assert.equal(sql.prepare("SELECT enabled FROM accounts WHERE user_id='disabled'").get().enabled,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,4,'Role configuration removal retains the account and its data');
 const read=await tool('read_pending_message',{dot_id:'member_dot',inbox_id:inbox},{who:'member'});assert.equal(read.status,200);assert.equal(read.json.text,'ORIGINAL_PRIVATE_BODY');
 const outcome=await wake();assert.equal(outcome.status,200);assert.equal(outcome.json.results[0].status,'accepted');assert.equal(callbacks,1);
 assert.equal((await wake()).status,429);
 const mixed=await wake(['disabled_dot','removed_dot']);assert.deepEqual(mixed.json.results.map(x=>x.status),['inactive','accepted']);assert.equal(callbacks,2,'Only persisted-disabled accounts block callbacks');
 // Bearer never falls back to valid OAuth; preserved legacy token cannot administer.
 assert.equal((await request('/api/tokens',null,{authToken:token})).status,403);
 assert.equal((await request('/api/accounts',null,{authToken:'!invalid'})).status,401);
 for(const roles of [undefined,'[]']){
  const environment={DB,AUTHORIZED_ACCOUNTS:roles};const account=await request('/api/account',null,{environment});
  assert.equal(account.status,200);assert.equal(account.json.can_manage_accounts,false,'Absent trusted role grants never preserve owner authority');
  assert.equal(sql.prepare('SELECT role FROM accounts WHERE user_id=?').get('owner').role,'member');
  assert.equal((await request('/api/accounts',null,{environment})).status,403);
  assert.equal((await request('/api/account',null,{who:'disabled',environment})).status,401,'Disabled flag remains authoritative without role configuration');
 }
 for(const bad of ['{}','bad-json','[{"email":"owner@example.test","role":"admin"}]'])assert.equal((await request('/api/account',null,{environment:{DB,AUTHORIZED_ACCOUNTS:bad}})).status,401,'Malformed role configuration fails closed');
 assert.deepEqual(sql.prepare('SELECT id,name,prefix,token_hash,created FROM api_tokens ORDER BY rowid').all().map(v=>({...v})),snapshot.api_tokens,'Read-only runtime does not change legacy credentials');
 // New token lifecycle is account-bound; all four documented expiry choices precise.
 for(const days of [1,7,30,90]){const r=await request('/api/tokens',{name:'synthetic '+days,expires_in_days:days},{who:'member'});assert.equal(r.status,201);assert.equal(Date.parse(r.json.token.expires)-time,days*86400000);assert.equal(sql.prepare('SELECT owner FROM api_tokens WHERE id=?').get(r.json.token.id).owner,'member');assert.equal(JSON.stringify(sql.prepare('SELECT * FROM api_tokens').all()).includes(r.json.secret),false);}
 // Audit unavailable before action must prevent writes and external callbacks.
 const broken={...DB,prepare(q){if(q.startsWith('INSERT INTO security_audit'))throw Error('SYNTHETIC_AUDIT_FAILURE');return DB.prepare(q);}};
 const count=sql.prepare('SELECT COUNT(*) n FROM api_tokens').get().n;
 assert.equal((await request('/api/tokens',{name:'blocked issuance'},{environment:{...env,DB:broken}})).status,503);assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens').get().n,count);
 time+=15000;assert.equal((await wake(['member_dot'],{environment:{...env,DB:broken}})).status,503);assert.equal(callbacks,2);
 // Legacy expiry is enforced precisely, including valid OAuth attached to the request.
 const expires=sql.prepare("SELECT expires FROM api_tokens WHERE id='legacy'").get().expires;const restoreTime=time;time=Date.parse(expires);assert.equal((await wake(['member_dot'],{who:'owner'})).status,401);time=restoreTime;
 // Cleanup is limited to 500/table, shared once/minute, never run on static/discovery/anonymous.
 sql.exec('DELETE FROM security_maintenance; DELETE FROM temporary_inbox; DELETE FROM subscriptions; DELETE FROM wake_limits; DELETE FROM security_audit;');
 for(let i=0;i<1001;i++){
  sql.prepare('INSERT INTO temporary_inbox VALUES (?,?,?,?,?,?,?)').run('inbox_'+hash('expired'+i),'member','member_dot','{}','fingerprint','2000-01-01','2000-01-02');
  sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('expired'+i,'member','member_dot','https://chatgpt.com/mock/'+i,secret,'2000-01-02');
  sql.prepare('INSERT INTO wake_limits VALUES (?,?)').run('expired'+i,0);
  sql.prepare('INSERT INTO security_audit VALUES (?,?,?,?,?,?,?)').run('expired'+i,'2000-01-01','synthetic','fixture','fixture','',1);
 }
 const pending=()=>sql.prepare('SELECT COUNT(*) n FROM temporary_inbox').get().n;
 await worker.fetch(new Request('https://relay.test/'),env);
 await request('/mcp',{id:1,method:'tools/list'},{who:null,origin:null});
 await request('/api/account',null,{who:null});assert.equal(pending(),1001);
 await request('/api/account');assert.equal(pending(),501);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,501);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM wake_limits').get().n,501);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM security_audit WHERE created='2000-01-01'").get().n,501);
 await worker.scheduled({},env,{});assert.equal(pending(),501,'Same lease holds scheduled and authenticated cleanup');
 time+=60000;await worker.scheduled({},env,{});assert.equal(pending(),1);
 time+=60000;await worker.scheduled({},env,{});assert.equal(pending(),0);
 // Logs/audit contain neither production data nor any synthetic secrets/private body.
 const auditText=JSON.stringify(sql.prepare('SELECT * FROM security_audit').all())+logs.join('\n');
 for(const forbidden of [token,secret,webhook,'ORIGINAL_PRIVATE_BODY','SYNTHETIC_PRIVATE_WAKE_BODY','owner@example.test'])assert.ok(!auditText.includes(forbidden));
 console.log('PASS independent review: v25 whole-record migration preservation across six tables; legacy hash/30-day expiry; existing OAuth identity+disabled flag+subscription continuity; regular-member fallback and fail-closed owner authority; bearer no fallback/admin; preserved inbox read; new lifetime options/issuer binding/hash-only storage; preaction audit failures block writes/callbacks; exact legacy expiry; 500-row shared-lease cleanup and no public cleanup; secret-free logs. Entirely synthetic SQLite and mocked callbacks.');
}finally{globalThis.Date=OriginalDate;globalThis.fetch=originalFetch;console.warn=originalWarn;sql.close();}
