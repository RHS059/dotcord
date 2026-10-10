// Isolated actual Worker + migrated SQLite. No hosted token, subscription, or wake.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const result=[];for(const i of items)result.push(await i.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return {bind(...args){return {first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify(['owner', 'receiver', 'other', 'disabled'].map(id=>({email:id+'@example.test',role:id==='owner'?'owner':'member'})))};
const token='t'.repeat(43),tokenName='Claude Cloud / Exact Sender';
sql.prepare('INSERT INTO api_tokens (id,name,prefix,token_hash,created) VALUES (?,?,?,?,?)').run('test',tokenName,'tttt',createHash('sha256').update(token).digest('hex'),'2026-01-01');
for(const id of ['owner','receiver','other','disabled'])sql.prepare('INSERT INTO accounts (email,user_id,role,enabled) VALUES (?,?,?,?)').run(id+'@example.test',id,id==='owner'?'owner':'member',id==='disabled'?0:1);
for(const [id,owner,channel] of [['one','owner','234567890123456789'],['two','other','334567890123456789']])sql.prepare('INSERT INTO discords (id,owner,name,connection_url,guild_id,channel_id,bot_token) VALUES (?,?,?,?,?,?,?)').run(id,owner,id,'','123456789012345678',channel,'synthetic_bot_token_123456');
for(const [id,owner,discord] of [['sender','owner','one'],['recipient','receiver','one'],['second','other','two'],['another','receiver','one'],['disabled_dot','disabled','one'],['no_subscription','receiver','one']])sql.prepare('INSERT INTO dots (id,owner,created,agent_type,discord_id) VALUES (?,?,?,?,?)').run(id,owner,'2026-01-01','dot',discord);
sql.exec("UPDATE api_tokens SET expires='2099-01-01T00:00:00.000Z'");
const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
for(const [id,dot,owner] of [['sub_one','recipient','receiver'],['sub_extra','recipient','receiver'],['sub_two','second','other'],['sub_another','another','receiver'],['sub_disabled','disabled_dot','disabled']])sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run(id,owner,dot,'https://chatgpt.com/mock/'+id,secret,'2099-01-01');
const RealDate=Date;let time=RealDate.parse('2026-10-10T15:00:00.000Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};
const originalFetch=globalThis.fetch,originalWarn=console.warn,originalError=console.error;
let callbackStatus=204;const events=[],logs=[];
console.warn=(v)=>logs.push(String(v));console.error=(v)=>logs.push(String(v));
globalThis.fetch=async(url,options)=>{
 assert.ok(url.startsWith('https://chatgpt.com/mock/'));assert.equal(options.redirect,'manual');
 const event=JSON.parse(options.body);assert.ok(options.headers['webhook-signature']);
 const rows=sql.prepare('SELECT * FROM temporary_inbox WHERE dot=? AND payload IS NOT NULL').all(event.data.dot_id);
 assert.ok(rows.some(r=>JSON.parse(r.payload).message_id===event.data.message_id),'Inbox persists before first signed callback');
 events.push(event);return new Response(null,{status:callbackStatus});
};
let sequence=0;
async function call(n,args={},who='receiver',path='/mcp',special={}){
 const headers={'content-type':'application/json',origin:'https://relay.test'};
 if(who==='global')headers.authorization='Bearer '+token;
 else if(who){headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who+'@example.test';}
 Object.assign(headers,special.headers||{});
 const body=path==='/api/wake'?args:path==='/api/tool'?{name:n,arguments:args}:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:n,arguments:args}};
 const response=await worker.fetch(new Request('https://relay.test'+path,{method:'POST',headers,body:JSON.stringify(body)}),special.env||env);
 const raw=await response.json();return {status:response.status,value:raw.result?JSON.parse(raw.result.content[0].text):raw};
}
async function ok(n,args={},who='receiver',path='/mcp',special={}){const r=await call(n,args,who,path,special);assert.ok(!r.value.error,JSON.stringify(r));return r.value;}
async function wake(args={},who='global',special={}){
 // Independent delivery scenarios. Dedicated security tests exercise cooldowns without resets.
 sql.exec('DELETE FROM wake_limits');
return ok('send_mention',{message_id:'fixture-'+(++sequence),text:'only the thread name',recipients:['recipient'],...args},who,'/api/wake',special);}
async function list(dot='recipient',who='receiver',limit=100){return ok('list_pending_messages',{dot_id:dot,limit},who);}
async function read(id,dot='recipient',who='receiver'){return ok('read_pending_message',{dot_id:dot,inbox_id:id},who);}
async function ack(id,dot='recipient',who='receiver'){return ok('acknowledge_message',{dot_id:dot,inbox_id:id},who);}
try{
 const schemas=await (await worker.fetch(new Request('https://relay.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,method:'tools/list'})}),env)).json();
 for(const tool of ['list_pending_messages','read_pending_message','acknowledge_message'])assert.ok(schemas.result.tools.find(t=>t.name===tool));
 assert.ok((await call('list_pending_messages',{dot_id:'recipient'},null)).value.error);
 assert.deepEqual((await list('recipient','owner')).messages,[],'Admin can inspect recipient inbox');
 assert.ok((await call('list_pending_messages',{dot_id:'recipient'},'other')).value.error,'Other members cannot inspect recipient inbox');
 assert.ok((await call('list_pending_messages',{dot_id:'recipient'},'disabled')).value.error);
 assert.ok((await call('list_pending_messages',{dot_id:'recipient',actor:'receiver'},'owner')).value.error);
 assert.ok((await call('list_pending_messages',{dot_id:'recipient',global:true},'owner')).value.error);
 assert.ok((await call('list_pending_messages',{dot_id:'recipient'},'receiver','/api/tool',{headers:{origin:'https://evil.test'}})).value.error);
 for(const recipients of [[],['recipient','recipient'],['Recipient'],['bad..name'],['recipient',null],Array(11).fill('recipient'),'recipient'])assert.ok((await call('send_mention',{message_id:'bad',text:'thread',recipients},'global','/api/wake')).value.error);
 assert.ok((await call('send_mention',{sender:'sender',message_id:'session',text:'thread',recipients:['recipient']},'owner','/api/wake')).value.error,'Session requests cannot use explicit wake-token routing');
 assert.equal((await wake({recipients:['unknown']})).results[0].status,'unregistered');
 assert.equal((await wake({recipients:['no_subscription']})).results[0].status,'not_subscribed');
 assert.equal((await wake({recipients:['disabled_dot']})).results[0].status,'inactive');
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM temporary_inbox').get().n,0);
 const exactText='  project thread / 中文\nkeep this exact  ',exactId='  exact|message-ID  ';
 const sent=await wake({message_id:exactId,text:exactText,sender:'forged',recipients:['recipient','second']});
 assert.deepEqual(sent.results.map(r=>r.status),['accepted','accepted','accepted']);
 const first=(await list()).messages[0],second=(await list('second','other')).messages[0];
 assert.notEqual(first.inbox_id,second.inbox_id);assert.equal(first.message_id,exactId);assert.equal(first.sender,tokenName);
 assert.equal(first.event_ids.length,2);assert.equal('text' in first,false,'List provides metadata, read returns content');
 const original=await read(first.inbox_id);assert.equal(original.text,exactText);assert.equal(original.sender,tokenName);assert.equal(original.message_id,exactId);
 assert.equal(RealDate.parse(original.expires_at)-RealDate.parse(original.created_at),900000);
 assert.equal((await list()).messages.length,1,'Read never acknowledges');
 assert.ok((await call('read_pending_message',{dot_id:'recipient',inbox_id:first.inbox_id},'global')).value.error,'Wake tokens cannot read inboxes');
 assert.equal((await read(first.inbox_id,'recipient','owner')).text,exactText,'Admin reads preserve content and do not acknowledge');
 for(const who of ['other']){
  assert.ok((await call('read_pending_message',{dot_id:'recipient',inbox_id:first.inbox_id},who)).value.error);
  assert.ok((await call('acknowledge_message',{dot_id:'recipient',inbox_id:first.inbox_id},who)).value.error);
 }
 await ack(first.inbox_id,'second','other');assert.equal((await read(first.inbox_id)).text,exactText,'Own-dot ack cannot target another dot copy');
 time+=60000;
 const before=events.length;await wake({message_id:exactId,text:exactText,recipients:['recipient','second']});
 assert.equal((await list()).messages.length,1);assert.equal((await read(first.inbox_id)).expires_at,original.expires_at,'Retries do not extend expiry');
 assert.deepEqual(events.slice(before).map(e=>e.eventId),events.slice(0,3).map(e=>e.eventId));
 const conflictEvents=events.length;
 assert.equal((await wake({message_id:exactId,text:'mutated',recipients:['recipient']})).results[0].status,'message_conflict');
 assert.equal(events.length,conflictEvents);assert.equal((await read(first.inbox_id)).text,exactText);
 await ack(first.inbox_id);await ack(first.inbox_id);
 const tombstone=sql.prepare('SELECT * FROM temporary_inbox WHERE id=?').get(first.inbox_id);
 assert.equal(tombstone.payload,null);assert.equal(tombstone.expires,original.expires_at);
 for(const privateValue of [exactId,exactText,tokenName,...first.event_ids])assert.ok(!JSON.stringify(tombstone).includes(privateValue));
 assert.equal((await list()).messages.length,0);assert.ok((await call('read_pending_message',{dot_id:'recipient',inbox_id:first.inbox_id})).value.error);
 assert.equal((await wake({message_id:exactId,text:exactText,recipients:['recipient']})).results[0].status,'already_acknowledged');assert.equal(events.length,conflictEvents);
 assert.equal((await read(second.inbox_id,'second','other')).text,exactText,'Ack is per recipient');
 const explicit=await wake({text:'Thread title with @second in it',recipients:['recipient']});assert.equal(explicit.results.length,2);assert.ok(explicit.results.every(r=>r.handle==='recipient'),'Explicit recipients supersede text mentions');
 const mention=await wake({text:'@second legacy mention',recipients:undefined});assert.equal(mention.results[0].handle,'second');
 const closeId=(await wake({message_id:'near-expiry'})).results[0].inbox_id;
 const close=await read(closeId);time=RealDate.parse(close.expires_at)-1;assert.equal((await read(closeId)).message_id,'near-expiry');
 time++;sql.exec('DELETE FROM security_maintenance');assert.equal((await list()).messages.length,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM temporary_inbox').get().n,0,'Request cleanup deletes expired active rows');
 assert.ok((await call('read_pending_message',{dot_id:'recipient',inbox_id:closeId})).value.error);
 callbackStatus=503;const failed=await wake({message_id:'failed-callback'});assert.equal(failed.results[0].status,'transient');assert.equal(failed.results[0].attempts,3);assert.equal((await read(failed.results[0].inbox_id)).message_id,'failed-callback');callbackStatus=204;
 // Storage failure must stop callback delivery, leaving the caller a retryable error.
 const broken={...DB,prepare(query){if(query.startsWith('INSERT INTO temporary_inbox'))throw Error('synthetic storage failure');return DB.prepare(query);}};
 const calls=events.length;assert.equal((await wake({message_id:'storage-error'},'global',{env:{...env,DB:broken}})).results[0].status,'inbox_unavailable');assert.equal(events.length,calls);
 // Cap includes hash receipts, never evicts unread content, and still accepts exact retries.
 sql.exec('DELETE FROM temporary_inbox');
 for(let i=0;i<100;i++)await wake({message_id:'bounded-'+i,recipients:['another']});
 const max=(await list('another')).messages;assert.equal(max.length,100);
 const fullCalls=events.length;assert.equal((await wake({message_id:'overflow',recipients:['another']})).results[0].status,'inbox_full');assert.equal(events.length,fullCalls);assert.equal((await list('another')).messages.length,100);
 await wake({message_id:'bounded-0',recipients:['another']});assert.equal((await list('another')).messages.length,100);
 const page=await list('another','receiver',20);assert.equal(page.messages.length,20);assert.equal(page.has_more,true);
 for(const m of page.messages)await ack(m.inbox_id,'another');assert.equal((await list('another')).messages.length,80);
 // Old handles must not leak content to new owners, including before delayed cleanup.
 const old=(await wake({message_id:'ownership-change'})).results[0].inbox_id;
 sql.prepare('UPDATE dots SET owner=? WHERE id=?').run('other','recipient');assert.equal((await list('recipient','other')).messages.length,0);
 assert.ok((await call('read_pending_message',{dot_id:'recipient',inbox_id:old},'other')).value.error);
 sql.prepare('UPDATE dots SET owner=? WHERE id=?').run('receiver','recipient');
 await ok('delete_agent',{dot_id:'recipient'});assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM temporary_inbox WHERE dot=?').get('recipient').n,0);
 // Rename also clears original recipient copies and subscription bindings.
 await ok('update_agent',{dot_id:'another',handle:'renamed',discord_id:'one'});assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM temporary_inbox WHERE dot=?').get('another').n,0);
 for(const privateValue of [token,exactId,exactText,tokenName,secret])assert.ok(!logs.join('\n').includes(privateValue),'No private content or secrets in logs');
 console.log('PASS: temporary inbox store-before-callback, OAuth owner isolation/wake-token rejection, exact sender/body/message IDs, multiple recipients/subscriptions, strict explicit recipient routing, metadata/read separation, no autoack, idempotent content-clearing ack, hash tombstones, conflict protection, stable bounded TTL, lazy expiry purge, callbacks/storage failures, 100-item cap, drain semantics, ownership changes/delete/rename, and secret-free logs. Isolated fixtures only.');
}finally{globalThis.fetch=originalFetch;globalThis.Date=RealDate;console.warn=originalWarn;console.error=originalError;sql.close();}
