import {seedActiveAccounts} from './helpers/accounts.mjs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHmac,createHash} from 'node:crypto';
import worker,{mentions,signedHeaders,callbackURL} from '../worker/index.js';
const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),['account_identities','account_onboarding','accounts','api_tokens','auth_sessions','discords','dots','external_wake_receipts','google_oauth_settings','invitations','oauth_states','receiver_credentials','receiver_lineages','security_audit','security_maintenance','subscriptions','temporary_inbox','wake_limits','wake_tests']);
const DB={async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})}}}}};const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'test@example.test',role:'owner'},{email:'b@example.test',role:'member'}])};
seedActiveAccounts(sql,env);
let connectionOne='';
async function call(owner,method,params={}){
 // Independent functional case; cooldown behavior is covered by test-wake-security.mjs.
 sql.exec('DELETE FROM wake_limits');
const headers={'content-type':'application/json'};if(owner){headers['oai-authenticated-user-id']=owner;headers['oai-authenticated-user-email']=owner==='account-a'?'test@example.test':'b@example.test';}return (await worker.fetch(new Request('https://relay.test/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env)).json();}
async function tool(owner,name,args={}){if(name==='add_discord')args={bot_token:'test_bot_token_not_real_123456789',...args};if(name==='register_dot'&&!args.discord_id)args={...args,discord_id:connectionOne};const r=await call(owner,'tools/call',{name,arguments:args});if(r.error)return r;return JSON.parse(r.result.content[0].text);}
assert.deepEqual(mentions('hello @receiver, user@receiver.test @sender'),['receiver','sender']);assert.deepEqual(mentions('@example.handle, @receiver.'),['example.handle','receiver']);assert.deepEqual(mentions('@.example. hi',['.example.']),['.example.']);
for(const url of ['https://127.0.0.1/x','https://chatgpt.com.evil.test/x','http://chatgpt.com/x','https://x@chatgpt.com/x'])assert.throws(()=>callbackURL(url));
assert.ok((await call(null,'server/discover')).result.capabilities.events);assert.equal((await call(null,'events/list')).result.events[0].name,'dot.mentioned');assert.equal((await call(null,'tools/call',{name:'list_dots'})).error.message,'Sign in to Dotcord to continue.');
connectionOne=(await tool('account-a','add_discord',{name:'Test Discord',channel_url:'https://discord.com/channels/123456789012345678/234567890123456789'})).id;assert.ok(connectionOne);
assert.equal((await tool('account-a','register_dot',{dot_id:'sender'})).registered,true);assert.equal((await tool('account-b','register_dot',{dot_id:'receiver'})).registered,true);assert.ok((await tool('account-b','register_dot',{dot_id:'sender'})).error);assert.ok((await tool('account-b','send_mention',{sender:'sender',message_id:'spoof',text:'hi'})).error);
assert.equal((await tool('account-a','register_dot',{dot_id:'@Example.Handle'})).dot_id,'example.handle');assert.ok((await tool('account-a','register_dot',{dot_id:'bad..handle'})).error);assert.equal((await tool('account-b','register_dot',{dot_id:'worker_bot',agent_type:'agent'})).agent_type,'agent');assert.ok((await tool('account-b','register_dot',{dot_id:'worker_bot',agent_type:'dot'})).error);
const secret='whsec_'+Buffer.alloc(32,42).toString('base64');const signed=await signedHeaders(secret,'evt_test','{"x":1}','sub',123);assert.equal(signed['webhook-signature'],'v1,'+createHmac('sha256',Buffer.alloc(32,42)).update('evt_test.123.{"x":1}').digest('base64'));
const originalFetch=globalThis.fetch;let delivered=[];let failures=0;globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(options.redirect,'manual');const h=options.headers;assert.equal(h['webhook-signature'],'v1,'+createHmac('sha256',Buffer.alloc(32,42)).update(h['webhook-id']+'.'+h['webhook-timestamp']+'.'+options.body).digest('base64'));if(body.type==='verification')return Response.json({challenge:body.challenge});delivered.push(body);if(failures-- >0)return new Response(null,{status:503});return new Response(null,{status:204});};
const subscription={name:'dot.mentioned',arguments:{dot_id:'receiver'},delivery:{mode:'webhook',url:'https://chatgpt.com/test-callback',secret}};
assert.ok((await call('account-a','events/subscribe',subscription)).error);const s=await call('account-b','events/subscribe',subscription);assert.ok(s.result.id);assert.equal((await call('account-b','events/subscribe',subscription)).result.id,s.result.id);
const args={sender:'sender',message_id:'m1',text:'@receiver check this',source_url:'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890'};const sent=await tool('account-a','send_mention',args);assert.equal(sent.results[0].status,'accepted');assert.equal(delivered[0].data.text,args.text);await tool('account-a','send_mention',args);assert.equal(delivered[0].eventId,delivered[1].eventId);
await tool('account-a','send_mention',{sender:'sender',message_id:'m2',text:'No mentions'});assert.equal(delivered.length,2);await tool('account-a','send_mention',{sender:'sender',message_id:'self',text:'@sender'});assert.equal(delivered.length,2);
sql.prepare('UPDATE accounts SET enabled=0 WHERE user_id=?').run('account-b');assert.equal((await tool('account-a','send_mention',{sender:'sender',message_id:'disabled-receiver',text:'@receiver'})).results[0].status,'inactive');sql.prepare("UPDATE accounts SET enabled=1,status='active' WHERE user_id=?").run('account-b');
failures=2;const retry=await tool('account-a','send_mention',{sender:'sender',message_id:'retry',text:'@receiver test'});assert.equal(retry.results[0].status,'accepted');assert.equal(retry.results[0].attempts,3);assert.equal(new Set(delivered.slice(-3).map(e=>e.eventId)).size,1);
await call('account-b','events/unsubscribe',subscription);const noSub=await tool('account-a','send_mention',{sender:'sender',message_id:'m3',text:'@receiver'});assert.equal(noSub.results[0].status,'not_subscribed');
for(const name of ['read_messages','delivery_status','retry_deliveries','post_message'])assert.ok((await tool('account-a',name,{})).error);
assert.deepEqual((await call(null,'tools/list')).result.tools.map(x=>x.name),['register_dot','get_wake_status','list_dots','list_discords','add_discord','update_discord','delete_discord','set_discord','update_agent','delete_agent','set_webhook','read_discord','edit_discord_message','post_to_discord','send_mention','list_pending_messages','read_pending_message','acknowledge_message']);assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),['account_identities','account_onboarding','accounts','api_tokens','auth_sessions','discords','dots','external_wake_receipts','google_oauth_settings','invitations','oauth_states','receiver_credentials','receiver_lineages','security_audit','security_maintenance','subscriptions','temporary_inbox','wake_limits','wake_tests']);
const account=await worker.fetch(new Request('https://relay.test/api/account',{headers:{'oai-authenticated-user-id':'account-a','oai-authenticated-user-email':'test@example.test'}}),env);assert.equal((await account.json()).email,'t***@e*****.test');const other=(await tool('account-b','add_discord',{name:'Other Discord',channel_url:'https://discord.com/channels/456789012345678901/567890123456789012'})).id;await tool('account-b','set_discord',{dot_id:'receiver',discord_id:other});assert.equal((await tool('account-a','send_mention',{sender:'sender',message_id:'scoped',text:'@receiver'})).results[0].status,'different_discord');assert.ok((await tool('account-a','send_mention',{sender:'sender',message_id:'wrong-server',text:'@receiver',source_url:'https://discord.com/channels/456789012345678901/567890123456789012'})).error);assert.ok((await tool('account-b','set_discord',{dot_id:'sender',discord_id:other})).error);globalThis.fetch=originalFetch;
console.log('PASS: bounded temporary inbox schema; direct signed events; stable receiver deduplication IDs; bounded transient retries; ownership; categories; dotted handles; filtering; unsubscribe; removed history tools. Mock callbacks, no live wakeup claimed.');

const webhook='https://discord.com/api/webhooks/123456789012345678/'+'x'.repeat(60);let posts=0;
globalThis.fetch=async(url,options={})=>{assert.ok(url.startsWith(webhook));if(options.method==='POST'){posts++;assert.deepEqual(JSON.parse(options.body).allowed_mentions,{parse:[]});return Response.json({id:'345678901234567890',channel_id:'234567890123456789'});}return Response.json({guild_id:'123456789012345678',channel_id:'234567890123456789'});};
assert.ok((await tool('account-b','set_webhook',{dot_id:'sender',webhook_url:webhook})).error);
assert.ok((await tool('account-a','set_webhook',{dot_id:'sender',webhook_url:'https://evil.test/webhook'})).error);
assert.equal((await tool('account-a','set_webhook',{dot_id:'sender',webhook_url:webhook})).saved,true);
const listed=await tool('account-a','list_dots');assert.equal(listed.find(d=>d.dot_id==='sender').webhook_configured,1);assert.ok(!JSON.stringify(listed).includes(webhook));
assert.equal((await tool('account-b','post_to_discord',{dot_id:'sender',text:'test'})).sent,true);
assert.equal((await tool('account-a','post_to_discord',{dot_id:'sender',text:'test'})).sent,true);assert.equal(posts,2);
await tool('account-a','set_discord',{dot_id:'sender',discord_id:other});assert.equal(sql.prepare('SELECT webhook_url FROM dots WHERE id=?').get('sender').webhook_url,webhook);
globalThis.fetch=async()=>{throw Error('Network must not be used to save');};assert.equal((await tool('account-a','set_webhook',{dot_id:'sender',webhook_url:webhook})).saved,true);
globalThis.fetch=originalFetch;
console.log('PASS: webhook ownership, URL validation, direct saving without network verification, secret redaction, posting, webhook preservation, and webhook preservation.');

assert.ok((await tool('account-b','update_agent',{dot_id:'sender',handle:'renamed',discord_id:other})).error);
assert.equal((await tool('account-a','update_agent',{dot_id:'sender',handle:'renamed',discord_id:other,agent_type:'agent'})).saved,true);
assert.ok((await tool('account-a','update_agent',{dot_id:'renamed',handle:'receiver',discord_id:other})).error);
sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('delete-test','account-a','renamed','https://chatgpt.com/test','test','2099-01-01');
assert.ok((await tool('account-b','delete_agent',{dot_id:'renamed'})).error);
assert.equal((await tool('account-a','delete_agent',{dot_id:'renamed'})).deleted,true);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE dot=?').get('renamed').n,0);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM dots WHERE id=?').get('renamed').n,0);

console.log('PASS: unified updates, conflicting handles, delete ownership, subscription cleanup, atomic update/delete behavior.');

assert.equal((await tool('account-b','list_dots')).find(d=>d.dot_id==='worker_bot').agent_type,'agent');

async function accountsRequest(owner,method='GET',body){return worker.fetch(new Request('https://relay.test/api/accounts',{method,headers:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner==='account-a'?'test@example.test':'b@example.test','origin':'https://relay.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);}
assert.equal((await accountsRequest('account-b')).status,403);
assert.equal((await (await accountsRequest('account-a')).json()).accounts.length,2);
assert.equal((await accountsRequest('account-a','POST',{account_id:createHash('sha256').update('test@example.test').digest('hex'),enabled:false})).status,400);
assert.equal((await accountsRequest('account-a','POST',{account_id:createHash('sha256').update('b@example.test').digest('hex'),enabled:false})).status,200);
assert.ok((await tool('account-b','list_dots')).error);
assert.equal((await accountsRequest('account-a','POST',{account_id:createHash('sha256').update('b@example.test').digest('hex'),enabled:true})).status,200);
assert.ok(Array.isArray(await tool('account-b','list_dots')));
console.log('PASS: authorized account listing, owner-only toggles, owner lockout protection, disable blocks tools, and reactivation restores access.');

const adminAccounts=await (await accountsRequest('account-a')).json();assert.ok(adminAccounts.accounts.every(a=>a.id&&a.email.includes('@')));assert.ok(adminAccounts.accounts.some(a=>a.email==='test@example.test'));assert.ok(adminAccounts.accounts.some(a=>a.email==='b@example.test'));assert.equal((await accountsRequest('account-b')).status,403);console.log('PASS: owner sees full allowed emails for invitation selection, members cannot enumerate accounts, and toggles use opaque IDs.');

assert.ok((await tool('account-b','update_discord',{discord_id:connectionOne,name:'Wrong',channel_url:'https://discord.com/channels/123456789012345678/234567890123456789'})).error);
assert.equal((await tool('account-a','update_discord',{discord_id:connectionOne,name:'Renamed',channel_url:'https://discord.com/channels/123456789012345678/234567890123456789'})).saved,true);
assert.ok((await tool('account-a','update_discord',{discord_id:connectionOne,name:'Bad',channel_url:'https://evil.test/'})).error);
await tool('account-b','set_discord',{dot_id:'worker_bot',discord_id:connectionOne});
sql.prepare('UPDATE dots SET webhook_url=? WHERE id=?').run('test-secret','worker_bot');
await tool('account-a','update_discord',{discord_id:connectionOne,name:'Moved',channel_url:'https://discord.com/channels/123456789012345678/334567890123456789'});
assert.equal(sql.prepare('SELECT webhook_url FROM dots WHERE id=?').get('worker_bot').webhook_url,'test-secret');
assert.ok((await tool('account-b','delete_discord',{discord_id:connectionOne})).error);
assert.equal((await tool('account-a','delete_discord',{discord_id:connectionOne})).deleted,true);
assert.equal(sql.prepare('SELECT discord_id FROM dots WHERE id=?').get('worker_bot').discord_id,null);
console.log('PASS: Discord update/delete ownership, URL validation, channel-change credential preservation, and retained agent registrations.');

const safeDiscords=await tool('account-a','list_discords');assert.ok(!JSON.stringify(safeDiscords).includes('test_bot_token'));assert.ok(safeDiscords.every(d=>!('channel_id' in d)&&!('guild_id' in d)&&!('channel_url' in d)&&!('bot_token' in d)));console.log('PASS: Discord list never returns channel values or bot tokens.');

assert.equal((await tool('account-b','update_discord',{discord_id:other,bot_token:'replacement_token_1234567890'})).saved,true);assert.equal(sql.prepare('SELECT bot_token FROM discords WHERE id=?').get(other).bot_token,'replacement_token_1234567890');assert.equal((await tool('account-a','update_discord',{discord_id:other,bot_token:'replacement_token_1234567890'})).saved,true,'Admin can update member-owned Discord credential');assert.equal(sql.prepare('SELECT owner FROM discords WHERE id=?').get(other).owner,'account-b','Admin does not take ownership');
