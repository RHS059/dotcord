// Isolated SQLite and synthetic credentials/callbacks; never calls a hosted API.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){return Promise.all(items.map(i=>i.run()));},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args)}}}}};
const token='synthetic_global_wake_fixture_'+ 'x'.repeat(13);assert.equal(token.length,43);
sql.prepare('INSERT INTO api_tokens (id,name,prefix,token_hash,created) VALUES (?,?,?,?,?)').run('fixture','External Agent / Primary',token.slice(0,4),createHash('sha256').update(token).digest('hex'),'2026-01-01');
for(const [email,id,enabled] of [['owner@example.test','owner',1],['other@example.test','other',1],['disabled@example.test','disabled',0]])sql.prepare('INSERT INTO accounts (email,role,enabled,user_id) VALUES (?,?,?,?)').run(email,'member',enabled,id);
const g1='123456789012345678',c1='234567890123456789',g2='345678901234567890',c2='456789012345678901';
for(const [id,guild,channel,owner] of [['one',g1,c1,'other'],['two',g2,c2,'owner']])sql.prepare('INSERT INTO discords (id,owner,name,connection_url,guild_id,channel_id,bot_token) VALUES (?,?,?,?,?,?,?)').run(id,owner,id,'',guild,channel,'synthetic_bot_fixture_12345');
for(const [id,owner,discord] of [['recipient_one','other','one'],['receiver','owner','two'],['registered_sender','owner','two'],['disabled_sender','disabled','two'],['disabled_target','disabled','one'],['unsubscribed','other','one']])sql.prepare('INSERT INTO dots (id,owner,created,agent_type,discord_id) VALUES (?,?,?,?,?)').run(id,owner,'2026-01-01','dot',discord);
const signing='whsec_'+Buffer.alloc(32,4).toString('base64');
for(const [dot,owner] of [['recipient_one','other'],['receiver','owner'],['disabled_target','disabled']])sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub_'+dot,owner,dot,'https://chatgpt.com/mock/'+dot,signing,'2099-01-01');
const env={DB,AUTHORIZED_ACCOUNTS:'[]'};
const events=[];const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.ok(url.startsWith('https://chatgpt.com/mock/'));
 assert.ok(options.headers['webhook-signature']);
 const event=JSON.parse(options.body);events.push(event);
 assert.equal(event.data.discord_id,event.data.dot_id==='receiver'?'two':'one');
 return new Response(null,{status:204});
};
let sequence=0;
async function wake(sender,text,opts={}){
 const body={sender,message_id:'fixture-'+(++sequence),text,...(opts.source_url?{source_url:opts.source_url}:{})};
 const headers={'content-type':'application/json'};
 if(opts.session){headers['oai-authenticated-user-id']=opts.session;headers['oai-authenticated-user-email']=opts.session+'@example.test';headers.origin='https://relay.test';}
 else if(opts.token!==false)headers.authorization='Bearer '+(opts.token||token);
 const path=opts.path||'/api/wake';
 const payload=path==='/mcp'?{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'send_mention',arguments:body}}:path==='/api/tool'?{name:'send_mention',arguments:body}:body;
 const response=await worker.fetch(new Request('https://relay.test'+path,{method:'POST',headers,body:JSON.stringify(payload)}),env);
 const raw=await response.json();const data=path==='/mcp'?JSON.parse(raw.result.content[0].text):raw;
 return {status:response.status,data};
}
try{
 const count=sql.prepare('SELECT COUNT(*) AS n FROM dots').get().n;
 for(const sender of [undefined,'external_agent','registered_sender','disabled_sender','recipient_one','not a valid handle']){
  const result=await wake(sender,'@recipient_one exact global wake regression');
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.results[0].status,'accepted');
  assert.equal(events.at(-1).data.sender,'External Agent / Primary','Saved token name is authoritative, ignoring legacy sender');
 }
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM dots').get().n,count,'Client labels never auto-register');
 assert.equal(sql.prepare("SELECT id FROM dots WHERE id='external_agent'").get(),undefined);
 for(const path of ['/api/tool','/mcp'])assert.equal((await wake('external_agent','@recipient_one fixture',{path})).data.results[0].status,'accepted');
 const cross=await wake('external_agent','@recipient_one @receiver fixture');assert.deepEqual(cross.data.results.map(r=>r.status),['accepted','accepted']);
 let calls=events.length;
 assert.equal((await wake('external_agent','@unknown fixture')).data.results[0].status,'unregistered');
 assert.equal((await wake('external_agent','@unsubscribed fixture')).data.results[0].status,'not_subscribed');
 assert.equal((await wake('external_agent','@disabled_target fixture')).data.results[0].status,'inactive');
 assert.equal((await wake('external_agent','@recipient_one fixture',{token:'x'.repeat(43)})).status,401);
 assert.equal((await wake('external_agent','@recipient_one fixture',{token:false})).status,401);
 assert.equal((await wake('external_agent','@recipient_one fixture',{session:'owner'})).status,403);
 assert.equal((await wake('recipient_one','@receiver fixture',{session:'owner'})).status,403);
 assert.equal((await wake('registered_sender','@recipient_one fixture',{session:'owner'})).data.results[0].status,'different_discord');
 assert.equal(events.length,calls,'Rejected or inactive requests never deliver callbacks');
 const source='https://discord.com/channels/'+g1+'/'+c1+'/567890123456789012';
 assert.equal((await wake('external_agent','@recipient_one fixture',{source_url:source})).data.results[0].status,'accepted');
 calls=events.length;
 assert.equal((await wake('external_agent','@receiver fixture',{source_url:source})).status,400);
 assert.equal((await wake('external_agent','@recipient_one @receiver fixture',{source_url:source})).status,400);
 assert.equal(events.length,calls,'All source-link destination checks finish before any callback');
 assert.equal((await wake('external_agent','@recipient_one fixture',{source_url:'https://evil.test/channels/'+g1+'/'+c1})).status,400);
 console.log('PASS: global saved token name identity, omitted/ignored legacy sender, no auto-registration/account/destination dependency, registered/self/cross-account labels, direct API/MCP parity, intended recipient subscription routing, invalid token rejection, disabled recipient protection, preserved session ownership/channel restrictions, and pre-delivery source-link validation. Synthetic callbacks only.');
}finally{globalThis.fetch=originalFetch;sql.close();}
