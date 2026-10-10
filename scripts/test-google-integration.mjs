// Actual Worker and migrated SQLite. Google identity/session fixtures are synthetic;
// cryptographic OIDC validation is covered separately by test-google-auth.mjs.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={batch(items){sql.exec('BEGIN');try{const out=items.map(i=>i.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return{bind(...args){return{first:()=>sql.prepare(q).get(...args)||null,all:()=>({results:sql.prepare(q).all(...args)}),run:()=>sql.prepare(q).run(...args)}}}}};
const emails=['admin','agent_one','agent_two','fresh','legacy','other'];
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(emails.map(id=>({email:id+'@example.test',role:id==='admin'?'owner':'member'})))};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function req(path,body,{host,cookie,origin='https://shared.test',method}={}){
 const headers={'content-type':'application/json'};
 if(origin!==null)headers.origin=origin;
 if(host){headers['oai-authenticated-user-id']=host.id;if(host.email)headers['oai-authenticated-user-email']=host.email;}
 if(cookie)headers.cookie=cookie;
 const r=await worker.fetch(new Request('https://shared.test'+path,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined}),env);
 return {status:r.status,data:await r.json(),headers:r.headers};
}
const host=id=>({host:{id,email:id+'@example.test'}});
const tool=(name,args,auth)=>req('/api/tool',{name,arguments:args},auth);
env.GOOGLE_CLIENT_ID='synthetic-client.apps.googleusercontent.com';
env.GOOGLE_CLIENT_SECRET='synthetic-secret';
env.GOOGLE_REDIRECT_URI='https://shared.test/auth/google/callback';
function session(subject,email,user_id,expired=false){
 const secret=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const id=createHash('sha256').update(secret).digest('base64url');
 sql.prepare('INSERT INTO auth_sessions (id,subject,email,user_id,created,expires) VALUES (?,?,?,?,?,?)').run(id,subject,email,user_id,Date.now(),Date.now()+(expired?-1:3600000));
 return '__Host-dotcord_session='+secret;
}
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'integration-key',alg:'RS256',use:'sig'};
let tokenResponse, lastTokenRequest, onTokenExchange;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,options={})=>{
 if(String(url)==='https://chatgpt.com/google-integration-fixture'){const event=JSON.parse(options.body);return Response.json({challenge:event.challenge});}
 if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
 if(String(url)==='https://oauth2.googleapis.com/token'){lastTokenRequest=new URLSearchParams(options.body);if(onTokenExchange)await onTokenExchange();return Response.json({id_token:tokenResponse});}
 throw new Error('Unexpected external request: '+url);
};
async function googleLogin(subject,email,hostIdentity){
 const start=await worker.fetch(new Request('https://shared.test/auth/google/start'),env);
 assert.equal(start.status,302);
 const location=new URL(start.headers.get('location'));
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const input=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://accounts.google.com',aud:location.searchParams.get('client_id'),sub:subject,email,email_verified:true,nonce:location.searchParams.get('nonce'),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});
 tokenResponse=input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input))).toString('base64url');
 const headers={cookie:start.headers.get('set-cookie').split(';')[0]};
 if(hostIdentity){headers['oai-authenticated-user-id']=hostIdentity.id;headers['oai-authenticated-user-email']=hostIdentity.email;}
 const callback=await worker.fetch(new Request('https://shared.test/auth/google/callback?state='+location.searchParams.get('state')+'&code=synthetic',{headers}),env);
 const cookie=callback.headers.getSetCookie().find(c=>c.startsWith('__Host-dotcord_session='))?.split(';')[0];
 return {status:callback.status,cookie};
}
try{
 assert.equal((await req('/api/account',null,host('admin'))).status,200);
 const destination=await tool('add_discord',{name:'Shared',channel_url:'https://discord.com/channels/123456789012345678/234567890123456789',bot_token:'synthetic_discord_bot'},host('admin'));
 assert.equal(destination.status,200,JSON.stringify(destination));
 const fresh=await googleLogin('fresh-subject','fresh@example.test');assert.equal(fresh.status,303);assert.ok(fresh.cookie);
 assert.equal(sql.prepare('SELECT user_id FROM accounts WHERE email=?').get('fresh@example.test').user_id,'google:fresh-subject');
 assert.equal((await req('/api/account',null,{cookie:fresh.cookie})).status,200);
 assert.equal((await req('/api/account',null,host('fresh'))).status,401,'Matching email without both identities cannot link host account');
 // Selected Google identity owns browser requests even with a different passive host identity.
 assert.equal((await req('/api/accounts',null,{cookie:fresh.cookie,...host('admin')})).status,403);
 // Host-owned resources must keep the same owner when Google identity is explicitly proven.
 assert.equal((await req('/api/account',null,host('legacy'))).status,200);
 assert.equal((await tool('register_dot',{dot_id:'legacy_handle',discord_id:destination.data.id},host('legacy'))).status,200);
 assert.equal((await googleLogin('legacy-google','legacy@example.test')).status,403,'Email alone cannot take over established host account');
 assert.equal((await googleLogin('legacy-google','legacy@example.test',host('other').host)).status,403);
 const legacy=await googleLogin('legacy-google','legacy@example.test',host('legacy').host);assert.equal(legacy.status,303);
 assert.equal(sql.prepare('SELECT user_id FROM accounts WHERE email=?').get('legacy@example.test').user_id,'legacy');
 assert.equal(sql.prepare('SELECT owner FROM dots WHERE id=?').get('legacy_handle').owner,'legacy');
 assert.equal((await tool('set_webhook',{dot_id:'legacy_handle',webhook_url:'https://discord.com/api/webhooks/434567890123456789/'+'x'.repeat(60)},{cookie:fresh.cookie})).status,403);
 assert.equal((await googleLogin('legacy-google','other@example.test')).status,403,'Stable Google subject cannot move to another allowed email');
 assert.equal((await googleLogin('rogue','unknown@example.test')).status,403,'Verified email still requires allowlist');
 // Cookie authentication must never inherit the native header exemption from Origin checks.
 assert.equal((await tool('register_dot',{dot_id:'csrf_google'},{cookie:fresh.cookie,origin:null})).status,403);
 assert.equal((await req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'register_dot',arguments:{dot_id:'csrf_google'}}},{cookie:fresh.cookie,origin:null})).status,403);
 assert.equal((await tool('register_dot',{dot_id:'csrf_google'},{cookie:fresh.cookie,origin:'https://attacker.test'})).status,403);
 assert.equal(sql.prepare('SELECT id FROM dots WHERE id=?').get('csrf_google'),undefined);
 const expired=session('fresh-subject','fresh@example.test','google:fresh-subject',true);
 assert.equal((await req('/api/account',null,{cookie:expired})).status,401);
 // Google-to-host linking requires the explicit same-origin endpoint and matching identity pair.
 assert.equal((await req('/api/auth/link-host',{}, {cookie:fresh.cookie,...host('other')})).status,403);
 assert.equal((await req('/api/auth/link-host',{}, {cookie:fresh.cookie,...host('fresh'),origin:null})).status,403);
 assert.equal((await req('/api/auth/link-host',{}, {cookie:fresh.cookie,...host('fresh')})).status,200);
 assert.equal((await req('/api/account',null,host('fresh'))).status,200);
 assert.equal((await req('/api/account',null,{host:{id:'fresh'}})).status,200,'Linked native identity can omit email after binding');
 assert.equal(sql.prepare('SELECT user_id FROM accounts WHERE email=?').get('fresh@example.test').user_id,'google:fresh-subject');
 // The recipient selects their handle; direct setup mints exactly one initial token.
 assert.equal((await req('/api/account',null,{cookie:fresh.cookie})).data.needs_setup,true);
 const competing=await Promise.all(Array.from({length:4},()=>req('/api/onboarding',{action:'accept',dot_id:'fresh_chosen',discord_id:destination.data.id},{cookie:fresh.cookie})));
 const admitted=competing.filter(r=>r.status===201);assert.equal(admitted.length,1,JSON.stringify(competing));
 assert.equal(admitted[0].data.dot_id,'fresh_chosen');assert.equal(admitted[0].data.token.dot,'fresh_chosen');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens WHERE owner=?').get('google:fresh-subject').n,1);
 assert.equal((await req('/api/account',null,{cookie:fresh.cookie})).data.needs_setup,false);
 assert.notEqual((await req('/api/onboarding',{action:'accept',dot_id:'second_handle',discord_id:destination.data.id},{cookie:fresh.cookie})).status,201);
 // Native MCP identity resolves to the Google canonical owner after explicit linking.
 const nativeList=await req('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'list_dots',arguments:{}}},{...host('fresh'),origin:null});
 assert.equal(nativeList.status,200);const nativeDots=JSON.parse(nativeList.data.result.content[0].text);assert.equal(nativeDots.find(d=>d.dot_id==='fresh_chosen').can_manage,1);
 const subscribed=await req('/mcp',{jsonrpc:'2.0',id:3,method:'events/subscribe',params:{name:'dot.mentioned',arguments:{dot_id:'fresh_chosen'},delivery:{mode:'webhook',url:'https://chatgpt.com/google-integration-fixture',secret:'whsec_'+Buffer.alloc(32,1).toString('base64')}}},{...host('fresh'),origin:null});
 assert.ok(subscribed.data.result?.id,JSON.stringify(subscribed));
 assert.equal(sql.prepare('SELECT owner FROM subscriptions WHERE dot=?').get('fresh_chosen').owner,'google:fresh-subject');
 // Invitations don't reserve a required handle. Collision failures must leave them redeemable.
 const agent_one=await googleLogin('agent_one-subject','agent_one@example.test');assert.equal(agent_one.status,303);
 const invitation=await req('/api/invitations',{account_id:digest('agent_one@example.test'),discord_id:destination.data.id},host('admin'));
 assert.equal(invitation.status,201,JSON.stringify(invitation));const invite=new URL(invitation.data.url).hash.slice('#invite='.length);
 assert.equal((await req('/api/onboarding',{action:'preview',invite},{cookie:agent_one.cookie})).data.suggested_handle,'');
 assert.notEqual((await req('/api/onboarding',{action:'accept',invite,dot_id:'fresh_chosen'},{cookie:agent_one.cookie})).status,201);
 const accepted=await req('/api/onboarding',{action:'accept',invite,dot_id:'agent_one_selected'},{cookie:agent_one.cookie});
 assert.equal(accepted.status,201,JSON.stringify(accepted));assert.equal(accepted.data.dot_id,'agent_one_selected');
 assert.equal(sql.prepare('SELECT owner FROM dots WHERE id=?').get('agent_one_selected').owner,'google:agent_one-subject');
 assert.notEqual((await req('/api/onboarding',{action:'accept',invite,dot_id:'agent_one_second'},{cookie:agent_one.cookie})).status,201);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens WHERE owner=?').get('google:agent_one-subject').n,1);
 // Already-issued links provide an editable suggestion rather than fixing the handle.
 const oldInvitation=await req('/api/invitations',{account_id:digest('agent_two@example.test'),dot_id:'old_suggestion',discord_id:destination.data.id},host('admin'));
 assert.equal(oldInvitation.status,201);const oldInvite=new URL(oldInvitation.data.url).hash.slice('#invite='.length);
 const overridden=await req('/api/onboarding',{action:'accept',invite:oldInvite,dot_id:'agent_two_chosen'},host('agent_two'));
 assert.equal(overridden.status,201);assert.equal(overridden.data.dot_id,'agent_two_chosen');assert.equal(sql.prepare('SELECT id FROM dots WHERE id=?').get('old_suggestion'),undefined);
 // Current allowlist and disabled flag apply even to a valid Google browser session.
 const savedAllowlist=env.AUTHORIZED_ACCOUNTS;
 env.AUTHORIZED_ACCOUNTS=JSON.stringify(JSON.parse(savedAllowlist).filter(a=>a.email!=='fresh@example.test'));
 assert.equal((await req('/api/account',null,{cookie:fresh.cookie})).status,401);
 env.AUTHORIZED_ACCOUNTS=savedAllowlist;
 sql.prepare('UPDATE accounts SET enabled=0 WHERE email=?').run('fresh@example.test');
 assert.equal((await req('/api/account',null,{cookie:fresh.cookie})).status,401);
 sql.prepare('UPDATE accounts SET enabled=1 WHERE email=?').run('fresh@example.test');
 const logout=await req('/auth/logout',{}, {cookie:fresh.cookie});assert.equal(logout.status,200);
 assert.equal((await req('/api/account',null,{cookie:fresh.cookie,...host('admin')})).status,401,'Revoked session cannot silently fall back to host administrator');
 // Owner-saved configuration drives a complete signed OIDC flow without hosting credentials.
 const pending=await worker.fetch(new Request('https://shared.test/auth/google/start'),env);
 assert.equal(pending.status,302);
 const dbClient='database-client.apps.googleusercontent.com',dbSecret='database-synthetic-secret';
 const configured=await req('/api/auth/google-settings',{client_id:dbClient,client_secret:dbSecret},host('admin'));
 assert.equal(configured.status,200,JSON.stringify(configured));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0,'Configuration mutation revokes existing sessions');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM oauth_states').get().n,0,'Configuration mutation invalidates pending flows');
 assert.equal((await req('/api/account',null,{cookie:agent_one.cookie})).status,401);
 const pendingLocation=new URL(pending.headers.get('location'));
 const staleCallback=await worker.fetch(new Request('https://shared.test/auth/google/callback?state='+pendingLocation.searchParams.get('state')+'&code=synthetic',{headers:{cookie:pending.headers.get('set-cookie').split(';')[0]}}),env);
 assert.equal(staleCallback.status,403,'Previously started flow cannot finish after rotation');
 delete env.GOOGLE_CLIENT_ID;delete env.GOOGLE_CLIENT_SECRET;delete env.GOOGLE_REDIRECT_URI;
 assert.equal((await req('/api/auth/providers')).data.google,true);
 const dbLogin=await googleLogin('agent_one-subject','agent_one@example.test');
 assert.equal(dbLogin.status,303,'DB-only saved credentials support full signed Google callback');
 assert.equal(lastTokenRequest.get('client_id'),dbClient);assert.equal(lastTokenRequest.get('client_secret'),dbSecret);
 assert.equal(lastTokenRequest.get('redirect_uri'),'https://shared.test/auth/google/callback');
 assert.equal((await req('/api/account',null,{cookie:dbLogin.cookie})).status,200);
 assert.equal((await req('/api/auth/google-settings',null,host('admin'))).data.source,'database');
 const rotate=await req('/api/auth/google-settings',{client_id:'rotated-client.apps.googleusercontent.com',client_secret:'rotated-secret'},host('admin'));
 assert.equal(rotate.status,200);
 assert.equal((await req('/api/account',null,{cookie:dbLogin.cookie})).status,401);
 const rotatedLogin=await googleLogin('agent_one-subject','agent_one@example.test');assert.equal(rotatedLogin.status,303);
 assert.equal(lastTokenRequest.get('client_id'),'rotated-client.apps.googleusercontent.com');
 const sameConfig=await req('/api/auth/google-settings',{client_id:'rotated-client.apps.googleusercontent.com',client_secret:''},host('admin'));assert.equal(sameConfig.status,200);
 assert.equal((await req('/api/account',null,{cookie:rotatedLogin.cookie})).status,401,'Even same-config saves revoke previous sessions');
 const afterSame=await googleLogin('agent_one-subject','agent_one@example.test');assert.equal(afterSame.status,303);
 assert.equal(lastTokenRequest.get('client_secret'),'rotated-secret','Blank same-client secret retains saved credential');

 // Rotation during a token exchange must not resurrect an old-config session.
 let exchangeStarted,continueExchange;
 const started=new Promise(resolve=>{exchangeStarted=resolve;}),release=new Promise(resolve=>{continueExchange=resolve;});
 onTokenExchange=async()=>{exchangeStarted();await release;};
 const inFlight=googleLogin('agent_one-subject','agent_one@example.test');await started;
 assert.equal((await req('/api/auth/google-settings',{client_id:'newest-client.apps.googleusercontent.com',client_secret:'newest-secret'},host('admin'))).status,200);
 continueExchange();const racedLogin=await inFlight;onTokenExchange=null;
 assert.ok(racedLogin.status!==303||(await req('/api/account',null,{cookie:racedLogin.cookie})).status===401,'An old-config in-flight callback must never create an accepted session');
 const removed=await req('/api/auth/google-settings',null,{...host('admin'),method:'DELETE'});assert.equal(removed.status,200);
 assert.equal((await req('/api/auth/providers')).data.google,false);
 assert.equal((await req('/api/account',null,{cookie:rotatedLogin.cookie})).status,401);
 assert.equal((await req('/auth/logout',{}, {cookie:rotatedLogin.cookie})).status,200,'Logout remains available after provider removal');
 env.GOOGLE_CLIENT_ID='fallback-client.apps.googleusercontent.com';env.GOOGLE_CLIENT_SECRET='fallback-secret';env.GOOGLE_REDIRECT_URI='https://shared.test/auth/google/callback';
 assert.equal((await req('/api/auth/google-settings',{client_id:dbClient,client_secret:dbSecret},host('admin'))).status,200);
 const fallback=await req('/api/auth/google-settings',null,{...host('admin'),method:'DELETE'});assert.equal(fallback.status,200);assert.equal(fallback.data.source,'environment');
 const fallbackLogin=await googleLogin('agent_one-subject','agent_one@example.test');assert.equal(fallbackLogin.status,303);assert.equal(lastTokenRequest.get('client_id'),env.GOOGLE_CLIENT_ID);assert.equal(lastTokenRequest.get('client_secret'),env.GOOGLE_CLIENT_SECRET);

 const audit=JSON.stringify(sql.prepare('SELECT * FROM security_audit').all());
 for(const secret of [dbSecret,'rotated-secret',fresh.cookie.split('=')[1],agent_one.cookie.split('=')[1],accepted.data.secret,admitted[0].data.secret,invite])assert.equal(audit.includes(secret),false);
 console.log('PASS Google integration: signed synthetic env/DB callback, settings rotation and in-flight invalidation, fallback, identity isolation/linking, canonical native MCP ownership, cookie CSRF/expiry/revocation, current allowlist, recipient-chosen handles, collision/replay/concurrent initial-token safety. External provider mocked.');
}finally{globalThis.fetch=originalFetch;sql.close();}
