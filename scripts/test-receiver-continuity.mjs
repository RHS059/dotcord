// Real shared Worker, migrated SQLite and synthetic callbacks only.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker/index.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const migrations=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort();
const sql=new DatabaseSync(':memory:');
for(const f of migrations)sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const values=[];for(const st of items)values.push(await st.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return {bind(...a){return {first:async()=>sql.prepare(q).get(...a)||null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'alpha@example.test',role:'owner'},{email:'beta@example.test',role:'member'}])};
for(const owner of ['alpha','beta'])sql.prepare('INSERT INTO accounts(email,user_id,role,enabled,primary_dot) VALUES (?,?,?,1,?)').run(owner+'@example.test',owner,owner==='alpha'?'owner':'member',owner);
sql.prepare('INSERT INTO discords(id,owner,name,connection_url,guild_id,channel_id) VALUES (?,?,?,?,?,?)').run('shared','alpha','Shared','','123456789012345678','234567890123456789');
for(const owner of ['alpha','beta'])sql.prepare('INSERT INTO dots(id,owner,created,agent_type,discord_id) VALUES (?,?,?,\'dot\',\'shared\')').run(owner,owner,new Date().toISOString());
const originalFetch=globalThis.fetch,originalInfo=console.info,originalWarn=console.warn;
const logs=[];console.info=console.warn=x=>logs.push(x);
let callbacks=0,verifications=0;
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(body.type==='verification'){verifications++;return Response.json({challenge:body.challenge});}callbacks++;return new Response(null,{status:204});};
const request=async(path,method,body,{who='alpha',token,environment=env}={})=>{const response=await worker.fetch(new Request('https://relay.test'+path,{method,headers:{'content-type':'application/json',origin:'https://relay.test',...(token?{authorization:'Bearer '+token}:{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'})},...(body?{body:JSON.stringify(body)}:{})}),environment);return {status:response.status,...await response.json()};};
const create=async(who='alpha')=>request('/api/receivers','POST',{name:'Synthetic receiver',expires_in_days:1},{who});
const lineage='1'.repeat(64);
const receiver=(token,method,params,revision,extra={})=>request('/api/receiver','POST',{method,params,...(revision?{revision,...(extra.lineage===false?{}:{lineage:extra.lineage||lineage})}:{})},{token,...extra});
const restore=(token,proofs,revision)=>receiver(token,'restore',{previous_tokens:proofs},revision);
const revoke=id=>request('/api/receivers','DELETE',{id});
const params={name:'dot.mentioned',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/synthetic/receiver',secret:'whsec_'+Buffer.alloc(32,8).toString('base64')},ttlMs:604800000};
const current=id=>({...sql.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)});
let seq=0;const mention=async()=>{sql.exec('DELETE FROM wake_limits');return request('/api/tool','POST',{name:'send_mention',arguments:{sender:'beta',message_id:'continuity-'+(++seq),text:'@alpha synthetic wake'}},{who:'beta'});};
try{
 const a=await create();const registered=await receiver(a.secret,'subscribe',params,1,{lineage:false});assert.equal(registered.status,200);
 const id=registered.result.id,initial=current(id);assert.ok(initial.expires>a.receiver.expires);assert.equal(initial.receiver_secret_hash,digest(a.secret));
 await revoke(a.receiver.id);assert.deepEqual(current(id),initial);assert.equal((await receiver(a.secret,'status',{})).status,401);
 callbacks=0;await mention();assert.equal(callbacks,0);assert.equal((await request('/api/tool','POST',{name:'get_wake_status',arguments:{}})).active_subscriptions,0);
 sql.exec('DELETE FROM security_maintenance');await worker.scheduled({},env,{});assert.deepEqual(current(id),initial,'Cleanup retains the authorized lease without a valid credential');
 const b=await create(),foreign=await create('beta');
 assert.equal((await receiver(foreign.secret,'restore',{previous_tokens:[a.secret]},2,{lineage:'2'.repeat(64)})).result.restored,0,'No cross-account callback takeover');
 assert.equal((await receiver(b.secret,'restore',{previous_tokens:['dcr_'+'z'.repeat(43)]},2,{lineage:'3'.repeat(64)})).result.restored,0,'No guessed continuity');
 assert.equal((await receiver(b.secret,'restore',{previous_tokens:[a.secret],url:'https://chatgpt.com/other'},2)).error.code,-32602,'No callback override');
 assert.equal((await restore(a.secret,[a.secret],2)).status,401,'Revoked token is never authentication');
 const beforeVerify=verifications;assert.equal((await restore(b.secret,[a.secret],2)).result.restored,1);assert.equal(verifications,beforeVerify);
 const rebound=current(id);for(const key of ['id','owner','dot','scope','url','secret','expires'])assert.equal(rebound[key],initial[key],key+' remains unchanged');
 assert.equal(rebound.receiver_id,b.receiver.id);assert.equal(rebound.receiver_revision,2);await restore(b.secret,[a.secret],2);assert.deepEqual(current(id),rebound,'Replay is idempotent');
 assert.equal((await receiver(b.secret,'status',{})).result.receiver_ready,true);callbacks=0;await mention();assert.equal(callbacks,1);
 const renewed=await receiver(b.secret,'subscribe',params,2);assert.equal(renewed.result.id,id);assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,1,'Renewal preserves subscription identity without duplicates');
 sql.prepare('UPDATE receiver_credentials SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',b.receiver.id);
 callbacks=0;await mention();assert.equal(callbacks,0);assert.equal((await receiver(b.secret,'status',{})).status,401);
 sql.exec('DELETE FROM security_maintenance');await worker.scheduled({},env,{});assert.ok(current(id).id);
 const c=await create();assert.equal((await restore(c.secret,[a.secret,b.secret],3)).result.restored,1);assert.equal(current(id).receiver_id,c.receiver.id);
 const d=await create(),e=await create();
 // Newer replacement wins even if an older request arrives afterward.
 assert.equal((await restore(e.secret,[c.secret,d.secret],5)).result.restored,1);
 assert.equal((await restore(d.secret,[c.secret],4)).error.code,-32009);assert.equal(current(id).receiver_id,e.receiver.id);
 // Even a deliberately reused token cannot let an old queued restore win.
 assert.equal((await restore(c.secret,[e.secret],6)).result.restored,1);
 assert.equal((await restore(d.secret,[c.secret],4)).error.code,-32009);assert.equal(current(id).receiver_id,c.receiver.id);

 // Both directions of an A -> B -> A reuse are fenced, as are old cancellations.
 for(const [credential,revision] of [[d,4],[e,5],[c,3]]){
  const count=verifications;
  assert.equal((await receiver(credential.secret,'subscribe',params,revision)).error.code,-32009);
  assert.equal((await receiver(credential.secret,'unsubscribe',params,revision)).error.code,-32009);
  assert.equal(verifications,count);assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,1);
 }
 for(const credential of [c,d,e])assert.equal((await receiver(credential.secret,'status',{})).status,200,'Rotation does not revoke credentials');
 assert.equal((await receiver(c.secret,'unsubscribe',params)).error.code,-32009,'Missing lineage cannot cancel a bound callback');
 // A delayed first subscription cannot commit after a rotation, even though the
 // lineage initially has no callbacks and the old bearer stays valid.
 const first=await create(),next=await create(),emptyLineage='4'.repeat(64);
 await receiver(first.secret,'restore',{previous_tokens:[]},1,{lineage:emptyLineage});
 const delayedParams={...params,delivery:{...params.delivery,url:'https://chatgpt.com/synthetic/first'}};
 const callbackFetch=globalThis.fetch;let release,started;
 const beginning=new Promise(resolve=>{started=resolve;});
 globalThis.fetch=async(url,options)=>{if(String(url)===delayedParams.delivery.url&&JSON.parse(options.body).type==='verification'){started();await new Promise(resolve=>{release=resolve;});}return callbackFetch(url,options);};
 const delayed=receiver(first.secret,'subscribe',delayedParams,1,{lineage:emptyLineage});await beginning;
 assert.equal((await receiver(next.secret,'restore',{previous_tokens:[]},2,{lineage:emptyLineage})).result.restored,0);
 release();assert.equal((await delayed).error.code,-32009);globalThis.fetch=callbackFetch;
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions WHERE url=?').get(delayedParams.delivery.url).n,0);
 assert.equal((await receiver(first.secret,'status',{})).status,200);
 assert.equal((await receiver(next.secret,'subscribe',delayedParams,2,{lineage:emptyLineage})).status,200);

 // A pre-upgrade untagged first subscribe also loses its authority to write once
 // that credential is pinned to an upgraded lineage, even after verification.
 const transitional=await create(),transitionLineage='7'.repeat(64),transitionParams={...params,delivery:{...params.delivery,url:'https://chatgpt.com/synthetic/transition'}};
 let transitionRelease,transitionStart;const transitioning=new Promise(resolve=>{transitionStart=resolve;});
 globalThis.fetch=async(url,options)=>{if(String(url)===transitionParams.delivery.url&&JSON.parse(options.body).type==='verification'){transitionStart();await new Promise(resolve=>{transitionRelease=resolve;});}return callbackFetch(url,options);};
 const oldFirst=receiver(transitional.secret,'subscribe',transitionParams);await transitioning;
 await receiver(transitional.secret,'restore',{previous_tokens:[]},1,{lineage:transitionLineage});
 transitionRelease();assert.equal((await oldFirst).error.code,-32009);globalThis.fetch=callbackFetch;
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions WHERE url=?').get(transitionParams.delivery.url).n,0);
 // Established receivers remain isolated even when they started with one token.
 const siblingLineage='5'.repeat(64),siblingParams={...params,delivery:{...params.delivery,url:'https://chatgpt.com/synthetic/sibling'}};
 await receiver(next.secret,'restore',{previous_tokens:[]},1,{lineage:siblingLineage});
 const sibling=await receiver(next.secret,'subscribe',siblingParams,1,{lineage:siblingLineage});assert.ok(sibling.result.id);
 assert.equal((await receiver(next.secret,'status',{},2,{lineage:emptyLineage})).result.receiver_subscriptions,1);
 assert.equal((await receiver(next.secret,'status',{},1,{lineage:siblingLineage})).result.receiver_subscriptions,1);
 const moved=await create();await receiver(moved.secret,'restore',{previous_tokens:[next.secret]},3,{lineage:emptyLineage});
 assert.equal(current(sibling.result.id).receiver_id,next.receiver.id,'Rotation never transfers a sibling receiver callback');
 assert.equal((await receiver(foreign.secret,'restore',{previous_tokens:[]},4,{lineage:emptyLineage})).error.code,-32009,'Lineage cannot transfer to another account');
 // A current same-token refresh can advance revision and still renew/cancel.
 await receiver(next.secret,'restore',{previous_tokens:[]},2,{lineage:siblingLineage});
 assert.equal((await receiver(next.secret,'subscribe',siblingParams,2,{lineage:siblingLineage})).result.id,sibling.result.id);
 assert.equal((await receiver(next.secret,'unsubscribe',siblingParams,2,{lineage:siblingLineage})).status,200);
 await receiver(moved.secret,'unsubscribe',delayedParams,3,{lineage:emptyLineage});
 // Revocation at the final cancellation write cannot destroy the retained lease.
 const cancel=await create(),cancelLineage='6'.repeat(64),cancelParams={...params,delivery:{...params.delivery,url:'https://chatgpt.com/synthetic/cancel'}};
 await receiver(cancel.secret,'restore',{previous_tokens:[]},1,{lineage:cancelLineage});
 const cancelSub=await receiver(cancel.secret,'subscribe',cancelParams,1,{lineage:cancelLineage});
 const cancelDB={...DB,prepare(q){const st=DB.prepare(q);if(!q.startsWith('DELETE FROM subscriptions WHERE receiver_id='))return st;return {bind(...args){const bound=st.bind(...args);return {...bound,async run(){sql.prepare('DELETE FROM receiver_credentials WHERE id=?').run(cancel.receiver.id);return bound.run();}};}};}};
 assert.equal((await receiver(cancel.secret,'unsubscribe',cancelParams,1,{lineage:cancelLineage,environment:{...env,DB:cancelDB}})).status,401);
 assert.ok(current(cancelSub.result.id).id);sql.prepare('DELETE FROM subscriptions WHERE id=?').run(cancelSub.result.id);
 // Revocation immediately before mutation fails closed.
 const f=await create();const guarded={...DB,prepare(q){const st=DB.prepare(q);if(!q.startsWith('UPDATE subscriptions SET receiver_id='))return st;return {bind(...args){const bound=st.bind(...args);return {...bound,async run(){sql.prepare('DELETE FROM receiver_credentials WHERE id=?').run(f.receiver.id);return bound.run();}};}};}};
 assert.equal((await receiver(f.secret,'restore',{previous_tokens:[c.secret]},7,{environment:{...env,DB:guarded}})).status,401);assert.equal(current(id).receiver_id,c.receiver.id);
 const lease=current(id).expires;sql.prepare('UPDATE subscriptions SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',id);
 assert.equal((await restore(d.secret,[c.secret],8)).result.restored,0);assert.equal(current(id).expires,'2000-01-01T00:00:00.000Z','Expired registration is never revived');
 sql.prepare('UPDATE subscriptions SET expires=? WHERE id=?').run(lease,id);sql.prepare('UPDATE subscriptions SET receiver_id=?,receiver_revision=? WHERE id=?').run(d.receiver.id,8,id);await receiver(d.secret,'unsubscribe',params,8);assert.equal(sql.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,0);
 assert.equal((await restore(d.secret,[c.secret],8)).result.restored,0,'Explicit unsubscribe is final');
 const serial=JSON.stringify(sql.prepare('SELECT * FROM security_audit').all())+logs.join('\n');for(const x of [a.secret,b.secret,c.secret,d.secret,e.secret,f.secret,params.delivery.secret,params.delivery.url])assert.ok(!serial.includes(x),'No credential, proof or callback leaks in logs/audit');
 // Additive migration keeps every preexisting field and limits backfill by owner.
 const old=new DatabaseSync(':memory:');for(const f of migrations.filter(f=>f<'0016'))old.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 old.prepare('INSERT INTO receiver_credentials VALUES (?,?,?,?,?,?)').run('legacy','alpha','Old','SYNTHETIC_HASH','2026-01-01','2027-01-01');
 for(const [row,owner] of [['owned','alpha'],['foreign','beta'],['orphan','alpha']])old.prepare('INSERT INTO subscriptions(id,owner,dot,url,secret,expires,scope,receiver_id) VALUES (?,?,?,?,?,?,?,?)').run(row,owner,'','https://chatgpt.com/synthetic/'+row,'SYNTHETIC_SECRET','2027-01-01','account',row==='orphan'?'missing':'legacy');
 const snapshot=old.prepare('SELECT * FROM subscriptions ORDER BY id').all();old.exec(readFileSync('drizzle/0016_receiver_continuity.sql','utf8').replaceAll('--> statement-breakpoint',''));
 for(const before of snapshot){const after=old.prepare('SELECT * FROM subscriptions WHERE id=?').get(before.id);for(const key of Object.keys(before))assert.equal(after[key],before[key]);assert.equal(after.receiver_revision,0);assert.equal(after.receiver_secret_hash,before.id==='owned'?'SYNTHETIC_HASH':null);}old.close();
 console.log('PASS: receiver continuity preserves callback/lease/identity, pauses revoked and expired credentials, resumes with same-owner proof, rejects cross-account/forged/stale/in-flight-revoked requests, survives cleanup, keeps renewal identity, never revives expired/unsubscribed rows, migrates conservatively, and redacts secrets. Synthetic only.');
}finally{globalThis.fetch=originalFetch;console.info=originalInfo;console.warn=originalWarn;sql.close();}
