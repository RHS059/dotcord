// Isolated SQLite and mocked callbacks only; never creates hosted tokens or sends live wakes.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){return Promise.all(items.map(i=>i.run()));},prepare(q){return {bind(...args){return {first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>sql.prepare(q).run(...args)}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'owner@example.test',role:'owner'},{email:'member@example.test',role:'member'}])};
async function req(path,body,opts={}){
 const headers={'content-type':'application/json'};
 if(opts.session){headers['oai-authenticated-user-id']=opts.session;headers['oai-authenticated-user-email']=opts.session+'@example.test';headers.origin=opts.origin||'https://relay.test';}
 if(opts.token)headers.authorization='Bearer '+opts.token;
 const r=await worker.fetch(new Request('https://relay.test'+path,{method:opts.method||(body?'POST':'GET'),headers,...(body?{body:JSON.stringify(body)}:{})}),env);
 return {status:r.status,data:await r.json()};
}
const call=(name,args,opts)=>req('/api/tool',{name,arguments:args},opts);
for(const payload of ['null','[]','42','"text"']){
 const malformed=await worker.fetch(new Request('https://relay.test/api/wake',{method:'POST',body:payload}),env);
 assert.equal(malformed.status,400);
}
assert.equal((await req('/api/tokens')).status,401);
assert.ok((await req('/api/tokens',{name:'Bad'},{session:'outsider'})).data.error);
assert.equal((await req('/api/tokens',{name:'CSRF'},{session:'owner',origin:'https://evil.test'})).status,403);
const created=await req('/api/tokens',{name:'Automation'},{session:'owner'});assert.equal(created.status,201);const {secret,token}=created.data;
assert.match(secret,/^[A-Za-z0-9_-]{43}$/);assert.equal(token.prefix,secret.slice(0,4));
const stored=sql.prepare('SELECT * FROM api_tokens').get();assert.equal(stored.token_hash.length,64);assert.ok(!JSON.stringify(stored).includes(secret));assert.equal(stored.owner,undefined);
const listed=await req('/api/tokens',null,{token:secret});assert.equal(listed.data.tokens[0].prefix.length,4);assert.ok(!JSON.stringify(listed).includes(secret));assert.ok(!JSON.stringify(listed).includes(stored.token_hash));
const second=await req('/api/tokens',{name:'Independent'},{token:secret});assert.equal(second.status,201);assert.notEqual(second.data.secret,secret);
const opts={session:'member'}, global={token:secret};
const destination=(await call('add_discord',{name:'Member channel',channel_url:'https://discord.com/channels/123456789012345678/234567890123456789',bot_token:'test_bot_token_1234567890'},opts)).data;
await call('register_dot',{dot_id:'sender',discord_id:destination.id},opts);
await call('register_dot',{dot_id:'receiver',discord_id:destination.id},{session:'owner'});
assert.ok((await call('update_discord',{discord_id:destination.id,name:'Nope'},{session:'owner'})).data.error);
assert.equal((await call('update_discord',{discord_id:destination.id,name:'Global update'},global)).data.saved,true);
assert.equal((await call('update_agent',{dot_id:'sender',handle:'sender',discord_id:destination.id},global)).data.saved,true);
assert.equal(sql.prepare("SELECT owner FROM dots WHERE id='sender'").get().owner,'member');
assert.equal((await call('list_dots',{},global)).data.every(d=>d.can_manage===1),true);
assert.ok((await call('send_mention',{sender:'sender',message_id:'msg',text:'@receiver test'},{session:'owner'})).data.error);
sql.prepare('INSERT INTO subscriptions (id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub','owner','receiver','https://chatgpt.com/mock','whsec_'+Buffer.alloc(32,1).toString('base64'),'2099-01-01');
let calls=0;const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://chatgpt.com/mock');calls++;const event=JSON.parse(options.body);assert.equal(event.data.dot_id,'receiver');assert.ok(options.headers['webhook-signature']);return new Response(null,{status:204});};
try{
 const wake=await req('/api/wake',{sender:'sender',message_id:'unique-id',text:'@receiver wake up'},global);assert.equal(wake.status,200);assert.equal(wake.data.results[0].status,'accepted');assert.equal(calls,1);
 assert.equal((await req('/api/wake',{sender:'sender',message_id:'bad',text:'@receiver'}, {token:'x'.repeat(43)})).status,401);assert.equal(calls,1);
 assert.equal((await req('/api/wake',{sender:'sender',message_id:'none',text:'@receiver'})).status,401);
 // Creator disablement does not scope independent global credentials to the account.
 sql.prepare("UPDATE accounts SET enabled=0 WHERE user_id='owner'").run();
 assert.equal((await call('list_dots',{},global)).status,200);
 assert.equal((await req('/api/tokens',{id:token.id},{token:second.data.secret,method:'DELETE'})).status,200);
 for(const path of ['/api/tokens','/api/accounts'])assert.equal((await req(path,null,global)).status===401||(await req(path,null,global)).status===403,true);
 assert.equal((await req('/api/wake',{sender:'sender',message_id:'revoked',text:'@receiver'},global)).status,401);assert.equal(calls,1);
 assert.equal((await call('list_dots',{}, {token:second.data.secret})).status,200,'Other independently minted tokens survive revocation');
 assert.equal((await req('/api/tokens',null,{session:'owner'})).status,401);
 assert.ok((await call('list_dots',{}, {session:'member',token:'x'.repeat(43)})).data.error,'Bad bearer never falls back to session');
 console.log('PASS global tokens: 256-bit randomness, hash-only storage, prefix-only listing, create once, global cross-account management and signed wake, no session fallback, CSRF, creator independence, immediate revocation, independent tokens retained. Isolated fixtures only.');
}finally{globalThis.fetch=original;sql.close();}
