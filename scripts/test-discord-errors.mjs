import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args)}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'owner@example.test',role:'owner'}])};
async function tool(name,args={}){
 // Independent cases; rate limiting has its own concurrency and boundary tests.
 sql.exec('DELETE FROM wake_limits');

  const response=await worker.fetch(new Request('https://relay.test/api/tool',{method:'POST',headers:{origin:'https://relay.test','content-type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({name,arguments:args})}),env);
  return {status:response.status,...await response.json()};
}
const guild='123456789012345678',channel='234567890123456789',otherChannel='334567890123456789',messageId='434567890123456789';
const bot='test_bot_token_1234567890',hook='https://discord.com/api/webhooks/534567890123456789/'+'x'.repeat(60);
const first=await tool('add_discord',{name:'First',channel_url:`https://discord.com/channels/${guild}/${channel}`,bot_token:bot});
const second=await tool('add_discord',{name:'Second',channel_url:`https://discord.com/channels/${guild}/${otherChannel}`,bot_token:bot});
await tool('register_dot',{dot_id:'sender',discord_id:first.id,webhook_url:hook});
await tool('register_dot',{dot_id:'receiver',discord_id:first.id});
sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub_test','owner','receiver','https://chatgpt.com/test','whsec_'+Buffer.alloc(32,42).toString('base64'),'2099-01-01');

const originalFetch=globalThis.fetch;
let calls=0,callbacks=0;
try{
  globalThis.fetch=async()=>{calls++;throw Error('Unexpected network request');};
  for(const value of ['', ' ', 'x'.repeat(2001),null,123]){
    const result=await tool('post_to_discord',{dot_id:'sender',text:value});
    assert.equal(result.status,400);assert.match(result.error,/Invalid or oversized text/);assert.ok(!result.error.includes('uncertain'));
  }
  for(const limit of [0,101,1.5,'5'])assert.match((await tool('read_discord',{dot_id:'sender',limit})).error,/Limit must/);
  assert.equal(calls,0,'Invalid local inputs must not contact Discord');

  for(const response of [new Response('not-json'),Response.json({id:messageId}),Response.json({id:'bad',channel_id:channel}),Response.json({id:messageId,channel_id:123}),new Response(null,{status:204})]){
    globalThis.fetch=async()=>{calls++;return response;};
    const result=await tool('post_to_discord',{dot_id:'sender',text:'@receiver uncertain body'});
    assert.equal(result.status,400);assert.match(result.error,/uncertain/);assert.match(result.error,/before retrying/);
  }
  assert.equal(calls,5,'Each uncertain post must make only one network request');
  globalThis.fetch=async()=>{calls++;throw Error('Timed out');};
  assert.match((await tool('post_to_discord',{dot_id:'sender',text:'@receiver timed out'})).error,/uncertain/);
  assert.equal(calls,6);
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:429});};
  assert.match((await tool('post_to_discord',{dot_id:'sender',text:'rate limited'})).error,/HTTP 429/);
  assert.equal(calls,7);

  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('https://chatgpt.com/')){callbacks++;return new Response(null,{status:204});}
    assert.equal(url,hook+'?wait=true');assert.equal(options.method,'POST');
    return Response.json({id:messageId,channel_id:otherChannel});
  };
  const mismatch=await tool('post_to_discord',{dot_id:'sender',text:'@receiver not in your channel'});
  assert.equal(mismatch.sent,true);assert.equal(mismatch.channel_id,otherChannel);assert.equal(mismatch.message_id,messageId);
  assert.equal(mismatch.url,undefined,'Do not invent a guild URL for a different channel');
  assert.match(mismatch.mention_delivery.error,/different Discord channel/);assert.equal(callbacks,0);
  globalThis.fetch=async()=>Response.json({id:otherChannel,guild_id:guild,parent_id:channel,type:0});
  assert.match((await tool('send_mention',{sender:'sender',message_id:'other-channel',text:'@receiver wrong source',source_url:`https://discord.com/channels/${guild}/${otherChannel}/${messageId}`})).error,/selected Discord channel/);
  assert.match((await tool('send_mention',{sender:'sender',message_id:'bad-link',text:'@receiver',source_url:'not a link'})).error,/valid Discord source link/);
  assert.equal(callbacks,0);

  for(const response of [new Response('not-json'),Response.json({error:'unexpected'}),Response.json([null]),Response.json([{id:'bad',content:'x'}]),Response.json([{id:messageId,content:'x',channel_id:otherChannel}])]){
    globalThis.fetch=async()=>response;
    assert.match((await tool('read_discord',{dot_id:'sender'})).error,/invalid message response/);
  }
  globalThis.fetch=async()=>new Response(null,{status:403});
  assert.match((await tool('read_discord',{dot_id:'sender'})).error,/HTTP 403/);
  globalThis.fetch=async()=>{throw Error('Timed out');};
  assert.match((await tool('read_discord',{dot_id:'sender'})).error,/could not be reached/);

  globalThis.fetch=async()=>{throw Error('Saving must not contact Discord');};
  assert.equal((await tool('register_dot',{dot_id:'sender',discord_id:second.id})).registered,true);
  const saved=sql.prepare('SELECT discord_id,webhook_url FROM dots WHERE id=?').get('sender');
  assert.equal(saved.discord_id,second.id);assert.equal(saved.webhook_url,hook);
  assert.match((await tool('register_dot',{dot_id:'sender',discord_id:first.id,agent_type:'agent'})).error,/other category/);
  assert.equal(sql.prepare('SELECT discord_id FROM dots WHERE id=?').get('sender').discord_id,second.id);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,1);
  assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name),['account_identities','account_onboarding','accounts','api_tokens','auth_sessions','discords','dots','google_oauth_settings','invitations','oauth_states','security_audit','security_maintenance','subscriptions','temporary_inbox','wake_limits']);
  for(const table of ['account_identities','account_onboarding','accounts','api_tokens','auth_sessions','discords','dots','google_oauth_settings','invitations','oauth_states','security_audit','security_maintenance','subscriptions','temporary_inbox','wake_limits']){
    const data=JSON.stringify(sql.prepare('SELECT * FROM '+table).all());
    for(const ephemeral of ['uncertain body','timed out','not in your channel','wrong source'])assert.ok(!data.includes(ephemeral));
  }
}finally{globalThis.fetch=originalFetch;sql.close();}
console.log('PASS: Discord validation, uncertain-response safety, no post retries, channel-scoped mention delivery, repeated-registration updates, credential preservation, and temporary recipient inbox. Network mocked.');
