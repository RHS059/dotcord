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
const guild='123456789012345678',channel='234567890123456789',thread='334567890123456789',messageId='434567890123456789';
const bot='test_bot_token_1234567890',hook='https://discord.com/api/webhooks/534567890123456789/'+'x'.repeat(60);
const destination=await tool('add_discord',{name:'Parent',channel_url:`https://discord.com/channels/${guild}/${channel}`,bot_token:bot});
await tool('register_dot',{dot_id:'sender',discord_id:destination.id,webhook_url:hook});
await tool('register_dot',{dot_id:'receiver',discord_id:destination.id});
sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub_test','owner','receiver','https://chatgpt.com/test','whsec_'+Buffer.alloc(32,42).toString('base64'),'2099-01-01');
const originalFetch=globalThis.fetch;
let requests=[],events=[];
const metadata={id:thread,guild_id:guild,parent_id:channel,type:11};
const message={id:messageId,channel_id:thread,content:'@receiver in the thread',author:{username:'sender'},attachments:[]};
try{
  globalThis.fetch=async(url,options)=>{
    requests.push(url);assert.equal(options.redirect,'manual');
    if(url.startsWith('https://chatgpt.com/')){events.push(JSON.parse(options.body));return new Response(null,{status:204});}
    if(url===hook+'?wait=true&thread_id='+thread){assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).content,message.content);return Response.json(message);}
    assert.equal(options.headers.Authorization,'Bot '+bot);
    if(url===`https://discord.com/api/v10/channels/${thread}`)return Response.json(metadata);
    assert.equal(url,`https://discord.com/api/v10/channels/${thread}/messages?limit=5`);return Response.json([message]);
  };
  const posted=await tool('post_to_discord',{dot_id:'sender',text:message.content,thread_id:thread});
  assert.equal(posted.sent,true);assert.equal(posted.mention_delivery.results[0].status,'accepted');
  assert.equal(posted.url,`https://discord.com/channels/${guild}/${thread}/${messageId}`);
  assert.equal(events[0].data.source_url,posted.url);assert.equal(events[0].data.channel_url,`https://discord.com/channels/${guild}/${channel}`);
  assert.deepEqual(requests,[`https://discord.com/api/v10/channels/${thread}`,hook+'?wait=true&thread_id='+thread,'https://chatgpt.com/test'],'The proven thread source must not cause a second metadata lookup');
  requests=[];
  const read=await tool('read_discord',{dot_id:'sender',limit:5,thread_id:thread});
  assert.equal(read.messages[0].text,message.content);assert.equal(read.messages[0].url,posted.url);
  assert.deepEqual(requests,[`https://discord.com/api/v10/channels/${thread}`,`https://discord.com/api/v10/channels/${thread}/messages?limit=5`]);
  requests=[];
  const manual=await tool('send_mention',{sender:'sender',message_id:'manual-thread',text:'@receiver manual mention',source_url:posted.url});
  assert.equal(manual.results[0].status,'accepted');assert.deepEqual(requests,[`https://discord.com/api/v10/channels/${thread}`,'https://chatgpt.com/test']);

  let calls=0,posts=0;
  globalThis.fetch=async()=>{calls++;throw Error('Invalid thread IDs must not contact Discord');};
  for(const thread_id of ['',null,123,'bad/../id'])for(const name of ['read_discord','post_to_discord'])assert.match((await tool(name,{dot_id:'sender',...(name==='post_to_discord'?{text:'test'}:{}),thread_id})).error,/valid Discord thread ID/);
  assert.equal(calls,0);
  for(const bad of [{...metadata,parent_id:'634567890123456789'},{...metadata,guild_id:'634567890123456789'},{...metadata,type:0},{...metadata,id:'634567890123456789'}]){
    globalThis.fetch=async(url,options)=>{if(options.method==='POST')posts++;return Response.json(bad);};
    for(const name of ['read_discord','post_to_discord'])assert.match((await tool(name,{dot_id:'sender',...(name==='post_to_discord'?{text:'test'}:{}),thread_id:thread})).error,/selected Discord channel and server/);
  }
  assert.equal(posts,0,'Unrelated or non-thread channels must fail before posting');
  for(const response of [new Response('not-json'),new Response(null,{status:403})]){
    globalThis.fetch=async()=>response;
    assert.match((await tool('post_to_discord',{dot_id:'sender',text:'test',thread_id:thread})).error,/thread (response|verification)/);
  }
  globalThis.fetch=async()=>{throw Error('offline');};
  assert.match((await tool('post_to_discord',{dot_id:'sender',text:'test',thread_id:thread})).error,/thread could not be verified/);
  sql.prepare('UPDATE discords SET bot_token=NULL WHERE id=?').run(destination.id);
  assert.match((await tool('post_to_discord',{dot_id:'sender',text:'test',thread_id:thread})).error,/bot token to verify/);
  sql.prepare('UPDATE discords SET bot_token=? WHERE id=?').run(bot,destination.id);

  events=[];
  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('https://chatgpt.com/')){events.push(JSON.parse(options.body));return new Response(null,{status:204});}
    if(options.method==='POST')return Response.json({...message,channel_id:channel});
    return Response.json(metadata);
  };
  const mismatch=await tool('post_to_discord',{dot_id:'sender',text:'@receiver wrong target',thread_id:thread});
  assert.equal(mismatch.sent,true);assert.match(mismatch.mention_delivery.error,/different Discord channel/);assert.equal(events.length,0);
  assert.match((await tool('send_mention',{sender:'sender',message_id:'bypass',text:'@receiver',source_url:`https://discord.com/channels/${guild}/${thread}/${messageId}`,verifiedSource:metadata})).error,/Unexpected argument/);

  // A destination already saved as this thread needs no parent lookup, but the
  // explicit thread_id still must be appended to Discord's webhook execution.
  await tool('update_discord',{discord_id:destination.id,channel_url:`https://discord.com/channels/${guild}/${thread}`});
  requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push(url);
    if(url===hook+'?wait=true&thread_id='+thread)return Response.json(message);
    assert.equal(url,`https://discord.com/api/v10/channels/${thread}/messages?limit=5`);assert.equal(options.headers.Authorization,'Bot '+bot);return Response.json([message]);
  };
  assert.equal((await tool('post_to_discord',{dot_id:'sender',text:'no mention',thread_id:thread})).sent,true);
  assert.equal((await tool('read_discord',{dot_id:'sender',limit:5,thread_id:thread})).messages.length,1);
  assert.deepEqual(requests,[hook+'?wait=true&thread_id='+thread,`https://discord.com/api/v10/channels/${thread}/messages?limit=5`]);
  assert.equal(sql.prepare('SELECT webhook_url FROM dots WHERE id=?').get('sender').webhook_url,hook);
  assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name),['account_identities','account_onboarding','accounts','api_tokens','auth_sessions','discords','dots','google_oauth_settings','invitations','oauth_states','receiver_credentials','security_audit','security_maintenance','subscriptions','temporary_inbox','wake_limits']);
}finally{globalThis.fetch=originalFetch;sql.close();}
console.log('PASS: verified thread reads/posts, explicit webhook thread targeting, same-channel subscription scope, private source proof, unrelated-thread rejection, saved-thread targets, and temporary recipient inbox. Network mocked.');
