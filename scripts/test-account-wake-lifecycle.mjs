// Real Worker and migrated transactional SQLite; external receivers/Discord are mocked.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
const migrations=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort();
for(const f of migrations.filter(f=>f<'0013'))sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
for(const id of ['legacy_one','legacy_many','legacy_none'])sql.prepare('INSERT INTO accounts (email,user_id,role,enabled) VALUES (?,?,?,1)').run(id+'@example.test',id,'member');
for(const [id,owner] of [['old_one','legacy_one'],['old_two','legacy_many'],['old_three','legacy_many']])sql.prepare("INSERT INTO dots (id,owner,created,agent_type) VALUES (?,?,'2026-01-01','dot')").run(id,owner);
sql.prepare("INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES ('legacy','legacy_one','old_one','https://chatgpt.com/test','secret','2099-01-01')").run();
for(const f of migrations.filter(f=>f>='0013'))sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
assert.equal(sql.prepare('SELECT primary_dot FROM accounts WHERE user_id=?').get('legacy_one').primary_dot,'old_one');
assert.equal(sql.prepare('SELECT primary_dot FROM accounts WHERE user_id=?').get('legacy_many').primary_dot,null);
assert.equal(sql.prepare('SELECT primary_dot FROM accounts WHERE user_id=?').get('legacy_none').primary_dot,null);
assert.equal(sql.prepare('SELECT scope FROM subscriptions WHERE id=?').get('legacy').scope,'handle');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM dots').get().n,3);
const DB={batch(items){sql.exec('BEGIN');try{const r=items.map(x=>x.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return {bind(...args){return {first:()=>sql.prepare(q).get(...args)||null,all:()=>({results:sql.prepare(q).all(...args)}),run:()=>sql.prepare(q).run(...args)}}}}};
const identities=['admin','sender','recipient','other','legacy_one','legacy_many','legacy_none'];
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(identities.map(id=>({email:id+'@example.test',role:id==='admin'?'owner':'member'})))};
async function request(path,body,who='recipient'){
 const headers={'content-type':'application/json',origin:'https://lifecycle.test','oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'};
 const r=await worker.fetch(new Request('https://lifecycle.test'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),env);return {status:r.status,data:await r.json()};
}
async function tool(name,args={},who='recipient'){const r=await request('/api/tool',{name,arguments:args},who);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
async function event(method,args={},who='recipient',url='https://chatgpt.com/lifecycle/'+who){return request('/mcp',{jsonrpc:'2.0',id:1,method,params:{name:'dot.mentioned',arguments:args,delivery:{mode:'webhook',url,secret:'whsec_'+Buffer.alloc(32,2).toString('base64')}}},who);}
const originalFetch=globalThis.fetch,events=[];
const guild='123456789012345678',channel='234567890123456789';
const hook='https://discord.com/api/webhooks/434567890123456789/'+'x'.repeat(60);
let postId=534567890123456789n;
globalThis.fetch=async(url,options={})=>{
 if(url.startsWith('https://chatgpt.com/lifecycle/')){const payload=JSON.parse(options.body);if(payload.type==='verification')return Response.json({challenge:payload.challenge});events.push({url,payload});return new Response(null,{status:204});}
 if(url.startsWith(hook)){assert.equal(options.method,'POST');return Response.json({id:String(++postId),channel_id:channel});}
 throw Error('Unexpected mocked request: '+url);
};
const resetRate=()=>sql.prepare('DELETE FROM wake_limits').run();
try{
 const destination=await tool('add_discord',{name:'Shared',channel_url:`https://discord.com/channels/${guild}/${channel}`,bot_token:'synthetic_shared_bot_token'},'admin');
 // Account subscription may be established before profile setup, but never claims readiness.
 let status=await tool('get_wake_status');assert.equal(status.state,'profile_required');assert.match(status.account_binding,/^acct_[a-f0-9]{64}$/);
 const subscribed=await event('events/subscribe',status.filter);assert.ok(subscribed.data.result?.id,JSON.stringify(subscribed));
 const subId=subscribed.data.result.id,expires=subscribed.data.result.refreshBefore;
 await tool('register_dot',{dot_id:'external_agent',agent_type:'agent',discord_id:destination.id});
 status=await tool('get_wake_status');assert.equal(status.state,'profile_required');assert.equal(status.account_subscriptions,1);assert.equal(status.active_subscriptions,0);
 // Choosing a handle makes it the account profile, with no new wake task registration.
 const onboard=await request('/api/onboarding',{action:'accept',dot_id:'first_handle',discord_id:destination.id});assert.equal(onboard.status,201,JSON.stringify(onboard));assert.equal(onboard.data.subscription_required,false,'Existing account receiver needs no additional subscription');
 status=await tool('get_wake_status');assert.equal(status.dot_id,'first_handle');assert.equal(status.state,'ready');assert.equal(status.refresh_before,expires);
 const browser=await request('/api/account');assert.equal(browser.data.profile.dot_id,'first_handle');assert.equal(browser.data.wake.state,'ready');assert.equal(browser.data.needs_setup,false);
 await tool('register_dot',{dot_id:'sender_handle',discord_id:destination.id,webhook_url:hook},'sender');
 let sent=await tool('post_to_discord',{dot_id:'sender_handle',text:'ordinary text @first_handle hello'},'sender');assert.equal(sent.mention_delivery.results[0].status,'accepted');assert.equal(events.at(-1).payload.data.dot_id,'first_handle');
 // Renaming keeps the same canonical account subscription, expiry and callback.
 await tool('update_agent',{dot_id:'first_handle',handle:'renamed_handle',discord_id:destination.id});
 status=await tool('get_wake_status');assert.equal(status.dot_id,'renamed_handle');assert.equal(status.state,'ready');assert.equal(sql.prepare('SELECT expires FROM subscriptions WHERE id=?').get(subId).expires,expires);
 resetRate();sent=await tool('post_to_discord',{dot_id:'sender_handle',text:'@renamed_handle after rename'},'sender');assert.equal(sent.mention_delivery.results[0].status,'accepted');
 // Removing handle makes account delivery dormant, then own recreation recovers it.
 assert.equal((await request('/api/tool',{name:'delete_agent',arguments:{dot_id:'renamed_handle'}})).status,403,'Scoped-token deletion requires admin');
 await tool('delete_agent',{dot_id:'renamed_handle'},'admin');assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(subId));
 assert.equal((await tool('get_wake_status')).state,'profile_required');assert.equal((await request('/api/account')).data.needs_setup,true);
 const recreated=await request('/api/onboarding',{action:'accept',dot_id:'renamed_handle',discord_id:destination.id});assert.equal(recreated.status,201,JSON.stringify(recreated));
 assert.equal((await tool('get_wake_status')).state,'ready');assert.equal(sql.prepare('SELECT expires FROM subscriptions WHERE id=?').get(subId).expires,expires);
 // The same spelling reclaimed by another account does not inherit callback authority.
 assert.equal((await request('/api/tool',{name:'delete_agent',arguments:{dot_id:'renamed_handle'}})).status,403,'Scoped-token deletion requires admin');
 await tool('delete_agent',{dot_id:'renamed_handle'},'admin');
 await tool('register_dot',{dot_id:'renamed_handle',discord_id:destination.id},'other');resetRate();const before=events.length;
 sent=await tool('post_to_discord',{dot_id:'sender_handle',text:'@renamed_handle belongs to another account'},'sender');assert.equal(sent.mention_delivery.results[0].status,'not_subscribed');assert.equal(events.length,before);
 assert.equal((await tool('get_wake_status',{},'other')).account_subscriptions,0);
 // Existing many-handle accounts select their identity explicitly; no arbitrary migration pick.
 let many=await request('/api/account',null,'legacy_many');assert.equal(many.data.profile.selection_required,true);assert.equal(many.data.wake.state,'selection_required');
 const selected=await request('/api/account',{dot_id:'old_two'},'legacy_many');assert.equal(selected.status,200);assert.equal(selected.data.profile.dot_id,'old_two');assert.equal(selected.data.wake.state,'destination_required');
 assert.equal((await request('/api/account',{dot_id:'old_one'},'legacy_many')).status,403);
 await tool('set_discord',{dot_id:'old_two',discord_id:destination.id},'legacy_many');assert.equal((await tool('get_wake_status',{},'legacy_many')).state,'not_subscribed');
 // Account unsubscribe is explicit and cannot remove another account's receiver.
 assert.ok((await event('events/unsubscribe',{},'other','https://chatgpt.com/lifecycle/recipient')).data.result);assert.ok(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(subId));
 assert.ok((await event('events/unsubscribe',{},'recipient')).data.result);assert.equal(sql.prepare('SELECT id FROM subscriptions WHERE id=?').get(subId),undefined);
 console.log('PASS account wake lifecycle: migration preserves legacy, primary selection, account subscriptions before setup, text mention posting, rename/delete/same-owner recreation, cross-account isolation and explicit unsubscribe. External services mocked.');
}finally{globalThis.fetch=originalFetch;sql.close();}
