// Real Worker + SQLite. All Discord/callback traffic mocked; no live posts.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){const results=[];for(const i of items)results.push(await i.run());return results;},prepare(q){return {bind(...args){return {first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>sql.prepare(q).run(...args)}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'owner@example.test',role:'owner'},{email:'member@example.test',role:'member'}])};
async function request(name,args={},options={}){
 const {id='owner',email=id+'@example.test',origin='https://relay.test',mcp=false}=options;
 const headers={'content-type':'application/json',origin};if(id){headers['oai-authenticated-user-id']=id;headers['oai-authenticated-user-email']=email;}
 const body=mcp?{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}:{name,arguments:args};
 const response=await worker.fetch(new Request('https://relay.test'+(mcp?'/mcp':'/api/tool'),{method:'POST',headers,body:JSON.stringify(body)}),env);
 const data=await response.json();return mcp&&data.result?JSON.parse(data.result.content[0].text):data;
}
const guild='123456789012345678',channel='234567890123456789',thread='334567890123456789';
const hook='https://discord.com/api/webhooks/434567890123456789/'+'x'.repeat(60);
const destination=await request('add_discord',{name:'Team',channel_url:`https://discord.com/channels/${guild}/${channel}`,bot_token:'test_bot_token_1234567890'});
await request('register_dot',{dot_id:'selected_agent',discord_id:destination.id,webhook_url:hook});
await request('register_dot',{dot_id:'receiver',discord_id:destination.id},{id:'member'});
sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub','member','receiver','https://chatgpt.com/mock','whsec_'+Buffer.alloc(32,1).toString('base64'),'2099-01-01');
const snapshot=()=>JSON.stringify(['dots','discords','subscriptions'].map(t=>sql.prepare('SELECT * FROM '+t).all()));const before=snapshot();
let posts=0,callbacks=0;const original=globalThis.fetch;
try{
 globalThis.fetch=async(url,options={})=>{
  if(url==='https://discord.com/api/v10/channels/'+thread)return Response.json({id:thread,guild_id:guild,parent_id:channel,type:11});
  if(url==='https://chatgpt.com/mock'){callbacks++;const event=JSON.parse(options.body);assert.equal(event.data.sender,'selected_agent');return new Response(null,{status:204});}
  assert.ok(url.startsWith(hook+'?wait=true'));posts++;assert.equal(JSON.parse(options.body).content,'@receiver hello');
  return Response.json({id:String(534567890123456789n+BigInt(posts)),channel_id:url.includes('thread_id=')?thread:channel});
 };
 for(const mcp of [false,true]){
  const result=await request('post_to_discord',{dot_id:'selected_agent',text:'@receiver hello',...(mcp?{thread_id:thread}:{})},{id:'member',mcp});
  assert.equal(result.sent,true);assert.equal(result.mention_delivery.results[0].status,'accepted');assert.ok(!JSON.stringify(result).includes(hook));
 }
 assert.equal(posts,2);assert.equal(callbacks,2);assert.equal(snapshot(),before,'Posting does not transfer ownership, alter configuration or subscriptions');
 for(const options of [{id:null},{id:'outsider'},{id:'changed',email:'member@example.test'},{id:'member',origin:'https://other.test'}])assert.ok((await request('post_to_discord',{dot_id:'selected_agent',text:'@receiver hello'},options)).error);
 sql.prepare('UPDATE accounts SET enabled=0 WHERE user_id=?').run('member');
 assert.ok((await request('post_to_discord',{dot_id:'selected_agent',text:'@receiver hello'},{id:'member'})).error);
 sql.prepare('UPDATE accounts SET enabled=1 WHERE user_id=?').run('member');
 assert.ok((await request('post_to_discord',{dot_id:'missing',text:'@receiver hello'},{id:'member'})).error);
 const changes=[['set_webhook',{dot_id:'selected_agent',webhook_url:hook}],['set_discord',{dot_id:'selected_agent',discord_id:destination.id}],['update_agent',{dot_id:'selected_agent',handle:'changed',discord_id:destination.id}],['delete_agent',{dot_id:'selected_agent'}],['update_discord',{discord_id:destination.id,name:'Changed'}],['delete_discord',{discord_id:destination.id}],['read_discord',{dot_id:'selected_agent'}],['send_mention',{sender:'selected_agent',message_id:'forged',text:'@receiver hello'}],['send_mention',{sender:'selected_agent',message_id:'forged',text:'@receiver hello',verifiedSource:{agent:{id:'selected_agent'}}}]];
 for(const [name,args] of changes)assert.ok((await request(name,args,{id:'member'})).error,name+' must retain previous permissions');
 assert.equal(posts,2,'Rejected requests never post');assert.equal(callbacks,2);assert.equal(snapshot(),before);
 console.log('PASS: browser/MCP authorized cross-account sends use selected saved webhook and confirmed-post mentions; thread verified; login, allowlist, identity, enabled-account and same-origin guards retained; management/read/direct-mention permissions unchanged; no owner/subscription/config changes or credential leak. Network mocked.');
}finally{globalThis.fetch=original;sql.close();}
