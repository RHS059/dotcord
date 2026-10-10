// Configuration/authorization tests use in-memory migrated SQLite, no provider calls.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={batch(items){sql.exec('BEGIN');try{const out=items.map(i=>i.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return{bind(...args){return{first:()=>sql.prepare(q).get(...args)||null,all:()=>({results:sql.prepare(q).all(...args)}),run:()=>sql.prepare(q).run(...args)}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'owner@example.test',role:'owner'},{email:'member@example.test',role:'member'}])};
async function req(method='GET',body,who='owner',origin='https://shared.test',path='/api/auth/google-settings'){
 const headers={'content-type':'application/json'};
 if(who){headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who+'@example.test';}
 if(origin)headers.origin=origin;
 const r=await worker.fetch(new Request('https://shared.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 return {status:r.status,data:await r.json()};
}
const config={client_id:'synthetic-client.apps.googleusercontent.com',client_secret:'synthetic-secret'};
assert.equal((await req('GET',undefined,null)).status,401);
assert.equal((await req('GET',undefined,'member')).status,403);
assert.equal((await req('POST',config,'member')).status,403);
assert.equal((await req('POST',config,'owner',null)).status,403);
assert.equal((await req('POST',config,'owner','https://evil.test')).status,403);
assert.equal((await req('POST',{...config,redirect_uri:'https://evil.test'})).status,400);
assert.equal((await req('POST',{...config,client_secret:'x'.repeat(2500)})).status,413);
assert.equal((await req()).data.source,'none');
assert.equal((await req('POST',config)).status,200);
let status=await req();assert.equal(status.data.configured,true);assert.equal(status.data.has_secret,true);assert.equal(status.data.source,'database');assert.equal(status.data.redirect_uri,'https://shared.test/auth/google/callback');
assert.ok(!JSON.stringify(status).includes(config.client_secret));
assert.equal((await req('GET',undefined,null,undefined,'/api/auth/providers')).data.google,true);
assert.equal((await req('POST',{client_id:config.client_id,client_secret:''})).status,200);
assert.equal(sql.prepare('SELECT client_secret FROM google_oauth_settings').get().client_secret,config.client_secret);
assert.equal((await req('POST',{client_id:'different.apps.googleusercontent.com',client_secret:''})).status,400);
assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM security_audit').all()).includes(config.client_secret));
assert.equal((await req('DELETE',undefined,'member')).status,403);
assert.equal((await req('DELETE',undefined,'owner',null)).status,403);
env.GOOGLE_CLIENT_ID='fallback.apps.googleusercontent.com';env.GOOGLE_CLIENT_SECRET='fallback-secret';env.GOOGLE_REDIRECT_URI='https://shared.test/auth/google/callback';
assert.equal((await req('DELETE')).status,200);
status=await req();assert.equal(status.data.source,'environment');assert.equal(status.data.client_id,env.GOOGLE_CLIENT_ID);assert.ok(!JSON.stringify(status).includes(env.GOOGLE_CLIENT_SECRET));
assert.equal((await req('POST',{client_id:env.GOOGLE_CLIENT_ID,client_secret:''})).status,200);
assert.equal(sql.prepare('SELECT client_secret FROM google_oauth_settings').get().client_secret,env.GOOGLE_CLIENT_SECRET);
console.log('PASS Google settings: owner-only, strict origin, bounded validation, secret redaction/retention, server persistence, provider availability, audit metadata, environment fallback.');
