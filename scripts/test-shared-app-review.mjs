// Independent authorization review. Real Worker and transactional SQLite; no live network.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const results=items.map(i=>i.exec());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return {bind(...args){return {exec:()=>sql.prepare(q).run(...args),run:async()=>sql.prepare(q).run(...args),first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)})};}}}};
const accounts=[{email:'admin@example.test',role:'owner'},{email:'alice@example.test',role:'member'},{email:'bob@example.test',role:'member'}];
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(accounts)};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function req(path,body,{who='admin',token,origin='https://relay.test',method}={}){
const headers={'content-type':'application/json',origin};if(token)headers.authorization='Bearer '+token;else{headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who+'@example.test';}
const r=await worker.fetch(new Request('https://relay.test'+path,{method:method||(body?'POST':'GET'),headers,...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,data:await r.json()};}
const tool=(name,args,opts)=>req('/api/tool',{name,arguments:args},opts);
const originalFetch=globalThis.fetch;let calls=[];
try{
globalThis.fetch=async(url,opts={})=>{calls.push({url,opts});throw Error('Unexpected network');};
await req('/api/account');
const guild='123456789012345678',channel='234567890123456789',other='334567890123456789',message='434567890123456789';
const add=async ch=>(await tool('add_discord',{name:ch,channel_url:`https://discord.com/channels/${guild}/${ch}`,bot_token:'synthetic_bot_token_123456789'})).data.id;
const discord=await add(channel),different=await add(other);
const issue=async(dot,who='alice')=>req('/api/invitations',{account_id:digest(who+'@example.test'),dot_id:dot,discord_id:discord});
assert.equal((await req('/api/invitations',{account_id:digest('alice@example.test'),dot_id:'hostile',discord_id:discord},{origin:'https://hostile.test'})).status,403);
assert.equal((await req('/api/invitations',{padding:'x'.repeat(2001)})).status,413);
assert.equal((await req('/api/onboarding',{padding:'x'.repeat(2001)},{who:'alice'})).status,413);
assert.equal((await issue('alice')).status,201,'An invited user need not have logged in first');
// Recreate with a retrievable secret after verifying duplicate reservation.
assert.equal((await issue('alice')).status,400);
const invitation=await issue('alice_two'),secret=new URL(invitation.data.url).hash.slice('#invite='.length);
assert.equal((await req('/api/onboarding',{invite:secret,action:'accept'},{who:'bob'})).status,403);
assert.equal((await req('/api/onboarding',{invite:secret,action:'unknown'},{who:'alice'})).status,400);
assert.equal(sql.prepare('SELECT redeemed_by FROM invitations WHERE secret_hash=?').get(digest(secret)).redeemed_by,null);
assert.equal((await req('/api/invitations',{account_id:digest('bob@example.test'),dot_id:'forged',discord_id:discord},{who:'alice'})).status,403);
assert.equal((await req('/api/onboarding',{invite:secret,action:'accept'},{who:'alice',origin:'https://hostile.test'})).status,403);
env.AUTHORIZED_ACCOUNTS=JSON.stringify(accounts.map(a=>({...a,role:'member'})));
assert.equal((await req('/api/onboarding',{invite:secret,action:'accept'},{who:'alice'})).status,403,'Removed admin authority invalidates pending invites');
env.AUTHORIZED_ACCOUNTS=JSON.stringify(accounts);
// Expiration rejects at the exact boundary, with no registration side effects.
const expiring=await issue('expired'),expiringSecret=new URL(expiring.data.url).hash.slice('#invite='.length);
const RealDate=globalThis.Date,boundary=Date.now();
sql.prepare('UPDATE invitations SET expires=? WHERE id=?').run(new Date(boundary).toISOString(),expiring.data.id);
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[boundary]));}static now(){return boundary;}};
try{assert.equal((await req('/api/onboarding',{invite:expiringSecret,action:'accept'},{who:'alice'})).status,403);}finally{globalThis.Date=RealDate;}
assert.equal(sql.prepare('SELECT COUNT(*) n FROM dots WHERE id=?').get('expired').n,0);
const revoked=await issue('revoked'),revokedSecret=new URL(revoked.data.url).hash.slice('#invite='.length);
assert.equal((await req('/api/invitations',{id:revoked.data.id},{method:'DELETE'})).status,200);
assert.equal((await req('/api/onboarding',{invite:revokedSecret,action:'accept'},{who:'alice'})).status,403);
// An actual SQLite failure after the handle write must roll back all prior batch writes.
const rollback=await issue('rollback'),rollbackSecret=new URL(rollback.data.url).hash.slice('#invite='.length);
sql.exec("CREATE TRIGGER fail_onboarding_token BEFORE INSERT ON api_tokens WHEN NEW.dot='rollback' BEGIN SELECT RAISE(ABORT, 'synthetic insertion failure'); END");
const failedResponse=await req('/api/onboarding',{invite:rollbackSecret,action:'accept'},{who:'alice'});assert.equal(failedResponse.status,503);assert.equal(failedResponse.data.error,'Operation failed','Database exception details are never exposed');
const failedClaim=sql.prepare('SELECT redeemed_by,claim FROM invitations WHERE id=?').get(rollback.data.id);
assert.equal(failedClaim.redeemed_by,null);assert.equal(failedClaim.claim,null);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM dots WHERE id=?').get('rollback').n,0);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens WHERE dot=?').get('rollback').n,0);
sql.exec('DROP TRIGGER fail_onboarding_token');
assert.equal((await req('/api/onboarding',{invite:rollbackSecret,action:'accept'},{who:'alice'})).status,201,'Retry succeeds after failed batch rollback');
const results=await Promise.all(Array.from({length:4},()=>req('/api/onboarding',{invite:secret,action:'accept'},{who:'alice'})));
assert.equal(results.filter(r=>r.status===201).length,1,'Concurrent claims issue only one credential');
const accepted=results.find(r=>r.status===201).data;
assert.equal(sql.prepare('SELECT COUNT(*) n FROM api_tokens WHERE dot=?').get('alice_two').n,1);
assert.equal(sql.prepare('SELECT owner FROM dots WHERE id=?').get('alice_two').owner,'alice');
assert.equal((await req('/api/invitations',null,{token:accepted.secret})).status,403);
assert.equal((await tool('edit_discord_message',{dot_id:'alice_two',message_id:message,text:'test'},{token:accepted.secret})).status,403);
await tool('register_dot',{dot_id:'bob',discord_id:different},{who:'bob'});
const wake=await req('/api/wake',{message_id:'scope',text:'@bob',recipients:['bob']},{token:accepted.secret});
assert.equal(wake.data.results[0].status,'different_discord');
// Replacement credentials retain registered identity and destination scope.
const replacement=await req('/api/tokens',{dot_id:'alice_two',name:'bob',expires_in_days:7},{who:'alice'});
assert.equal(replacement.status,201);assert.equal(replacement.data.token.name,'alice_two');assert.equal(replacement.data.token.dot,'alice_two');
const storedReplacement=sql.prepare('SELECT name,dot,owner FROM api_tokens WHERE id=?').get(replacement.data.token.id);
assert.deepEqual({...storedReplacement},{name:'alice_two',dot:'alice_two',owner:'alice'});
assert.equal((await req('/api/tokens',{dot_id:'alice_two',name:'spoof'},{who:'bob'})).status,403);
assert.equal((await req('/api/tokens',{dot_id:'alice_two',name:'spoof'})).status,403,'Owner cannot mint another account’s handle identity');
const replacementWake=await req('/api/wake',{sender:'bob',message_id:'replacement-scope',text:'@bob',recipients:['bob']},{token:replacement.data.secret});
assert.equal(replacementWake.data.results[0].status,'different_discord','Replacement keeps channel binding despite supplied sender');
const aliceDots=(await tool('list_dots',{}, {who:'alice'})).data;
assert.equal(!!aliceDots.find(d=>d.dot_id==='alice_two').is_owned,true);assert.equal(!!aliceDots.find(d=>d.dot_id==='bob').is_owned,false);
const adminDots=(await tool('list_dots',{})).data;
assert.equal(!!adminDots.find(d=>d.dot_id==='alice_two').can_manage,true);assert.equal(!!adminDots.find(d=>d.dot_id==='alice_two').is_owned,false);
const hook='https://discord.com/api/webhooks/534567890123456789/'+'x'.repeat(60);
assert.equal((await tool('set_webhook',{dot_id:'alice_two',webhook_url:hook})).status,200,'Admin can manage another user’s handle');
assert.equal((await tool('edit_discord_message',{dot_id:'alice_two',message_id:message,text:'edit'},{who:'bob'})).status,403);
assert.equal(calls.length,0,'All denied requests stop before external effects');
globalThis.fetch=async(url,opts={})=>{calls.push({url,opts});return Response.json({id:message,channel_id:other});};
assert.equal((await tool('edit_discord_message',{dot_id:'alice_two',message_id:message,text:'edit'},{who:'alice'})).status,400);
assert.equal(calls.length,1,'Wrong destination preflight prevents PATCH');
assert.equal(calls[0].opts.method,undefined);
calls=[];
globalThis.fetch=async(url,opts={})=>{calls.push({url,opts});return Response.json({id:message,channel_id:channel});};
assert.equal((await tool('edit_discord_message',{dot_id:'alice_two',message_id:message,text:'@everyone edited'},{who:'alice'})).status,200);
assert.equal(calls.length,2);assert.equal(calls[1].opts.method,'PATCH');assert.deepEqual(JSON.parse(calls[1].opts.body).allowed_mentions,{parse:[]});
assert.equal((await tool('delete_agent',{dot_id:'alice_two'})).status,200);
assert.equal((await req('/api/wake',{message_id:'deleted',text:'@bob'},{token:accepted.secret})).status,401,'Deleting a handle revokes its scoped credential');
console.log('PASS independent shared-app review: invitation binding, issuer downgrade, expiry/revocation, CSRF, concurrent redemption, rollback/recovery, scoped replacement identity and restrictions/revocation, admin management, edit preflight and mention suppression. All external requests mocked.');
}finally{globalThis.fetch=originalFetch;sql.close();}
