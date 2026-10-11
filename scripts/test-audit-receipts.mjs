// Independent synthetic fault injection only. Never uses live credentials or network.
import {seedActiveAccounts} from './helpers/accounts.mjs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const target=resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'worker/index.js');
const worker=(await import(pathToFileURL(target))).default;
const fixed=!process.argv.includes('--upstream');
const channel='234567890123456789',guild='123456789012345678',message='434567890123456789';
const hook='https://discord.com/api/webhooks/534567890123456789/'+'x'.repeat(60);
const token='s'.repeat(43);
const tokenHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
const originalFetch=globalThis.fetch;
const report=[];
function fixture(fault){
 const sql=new DatabaseSync(':memory:');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 sql.prepare('INSERT INTO accounts(email,user_id,role,enabled) VALUES (?,?,?,1)').run('owner@example.test','owner','owner');
 sql.prepare('INSERT INTO discords(id,owner,name,connection_url,guild_id,channel_id,bot_token) VALUES (?,?,?,?,?,?,?)').run('destination','owner','Synthetic','',guild,channel,'test_bot_token_1234567890');
 for(const dot of ['sender','receiver','another'])sql.prepare('INSERT INTO dots(id,owner,created,discord_id,webhook_url) VALUES (?,?,?,?,?)').run(dot,'owner',new Date().toISOString(),'destination',hook);
 for(const dot of ['receiver','another'])sql.prepare('INSERT INTO subscriptions(id,owner,dot,url,secret,expires) VALUES (?,?,?,?,?,?)').run('sub_'+dot,'owner',dot,'https://chatgpt.com/mock-'+dot,'whsec_'+Buffer.alloc(32,42).toString('base64'),'2099-01-01');
 sql.prepare('INSERT INTO api_tokens(id,name,prefix,token_hash,created,owner,expires) VALUES (?,?,?,?,?,?,?)').run('synthetic-token','Synthetic wake',token.slice(0,4),tokenHash,new Date().toISOString(),'owner','2099-01-01');
 const attempted=[];
 const DB={async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return {bind(...args){return {first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>{if(q.startsWith('INSERT INTO security_audit')){const event={actor:args[2],action:args[3],outcome:args[4],resource:args[5]};attempted.push(event);if(fault(event))throw Error('Synthetic audit storage unavailable');}return sql.prepare(q).run(...args);}}}}}};
 const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'owner@example.test',role:'owner'},{email:'member@example.test',role:'member'}])};
 seedActiveAccounts(sql,env);
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});if(url.startsWith(hook))return Response.json({id:message,channel_id:channel});if(url.startsWith('https://chatgpt.com/mock-')){const body=JSON.parse(options.body);return body.type==='verification'?Response.json({challenge:body.challenge}):new Response(null,{status:204});}throw Error('Unexpected mocked fetch destination');};
 async function request(path,body,{bearer=false,method='POST'}={}){const headers={'content-type':'application/json',origin:'https://relay.test'};if(bearer)headers.authorization='Bearer '+token;else {headers['oai-authenticated-user-id']='owner';headers['oai-authenticated-user-email']='owner@example.test';}const response=await worker.fetch(new Request('https://relay.test'+path,{method,headers,body:JSON.stringify(body)}),env);return {status:response.status,value:await response.json(),audit_header:response.headers.get('x-dotcord-audit-warning')};}
 return {sql,calls,attempted,request,close:()=>sql.close()};
}
try{
 for(const route of ['/api/tool','/mcp']){
  const f=fixture(e=>e.outcome==='success'&&e.action==='post_to_discord');
  try{
   const args={dot_id:'sender',text:'Synthetic post receipt test'};
   const body=route==='/mcp'?{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'post_to_discord',arguments:args}}:{name:'post_to_discord',arguments:args};
   const r=await f.request(route,body);const value=route==='/mcp'&&r.value.result?JSON.parse(r.value.result.content[0].text):r.value;
   assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'POST');
   if(fixed){assert.equal(r.status,200);assert.equal(value.sent,true);assert.equal(value.message_id,message);assert.equal(value.url,`https://discord.com/channels/${guild}/${channel}/${message}`);assert.ok(value.audit_warning||value.security_audit_warning||value.warning||value.warnings,'Must disclose loss of post-action audit');}
   else {assert.ok(r.status>=400||r.value.error);assert.equal(value.sent,undefined);}
   report.push({scenario:'post-success audit failure '+route,...r,network_requests:f.calls.length});
  }finally{f.close();}
 }
 {
  const f=fixture(e=>e.outcome==='attempt'&&e.action==='post_to_discord');
  try{const r=await f.request('/api/tool',{name:'post_to_discord',arguments:{dot_id:'sender',text:'Synthetic pre-action failure'}});assert.ok(r.status>=400);assert.equal(f.calls.length,0);report.push({scenario:'pre-action audit failure',...r,network_requests:f.calls.length});}finally{f.close();}
 }
 for(const faultPoint of ['recipient','outer']){
  const f=fixture(e=>faultPoint==='recipient'?e.action==='wake'&&e.outcome==='accepted'&&e.resource==='receiver':e.action==='send_mention'&&e.outcome==='success');
  try{const r=await f.request('/api/wake',{message_id:'synthetic-'+faultPoint,recipients:['receiver','another'],text:'Synthetic direct wake batch'},{bearer:true});
   if(fixed){assert.equal(r.status,200);assert.equal(r.value.message_id,'synthetic-'+faultPoint);assert.equal(r.value.results.length,2);assert.equal(r.value.results[0].status,'accepted');assert.ok(r.value.results.every(x=>x.status==='accepted'||x.status==='not_attempted'));assert.equal(r.value.results.filter(x=>x.status==='accepted').length,f.calls.length);assert.ok(JSON.stringify(r.value).includes('audit'),'Must disclose loss of audit for delivery');}
   else {assert.ok(r.status>=400);assert.equal(r.value.results,undefined);assert.equal(f.calls.length,faultPoint==='recipient'?1:2);}
   report.push({scenario:'direct wake '+faultPoint+' audit failure',...r,callbacks:f.calls.length,inbox_rows:f.sql.prepare('SELECT COUNT(*) AS n FROM temporary_inbox').get().n});
  }finally{f.close();}
 }
 {
  const f=fixture(e=>e.action==='send_mention'&&e.outcome==='attempt');
  try{const r=await f.request('/api/wake',{message_id:'pre-wake',recipients:['receiver','another'],text:'Synthetic blocked wake'},{bearer:true});assert.ok(r.status>=400);assert.equal(f.calls.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM temporary_inbox').get().n,0);report.push({scenario:'pre-action wake audit failure',...r,callbacks:f.calls.length});}finally{f.close();}
 }
 if(fixed){
  for(const action of ['token_create','token_revoke','account_update','events/subscribe','events/unsubscribe']){
   const f=fixture(e=>e.action===action&&e.outcome==='attempt');
   try{
    let r;
    if(action==='token_create')r=await f.request('/api/tokens',{name:'Blocked synthetic token'});
    else if(action==='token_revoke')r=await f.request('/api/tokens',{id:'synthetic-token'},{method:'DELETE'});
    else if(action==='account_update'){
     const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('member@example.test'))).toString('hex');
     r=await f.request('/api/accounts',{account_id:digest,enabled:false});
     assert.equal(f.sql.prepare("SELECT enabled FROM accounts WHERE email='member@example.test'").get().enabled,1);
    }else{
     const params={name:'dot.mentioned',arguments:{dot_id:'receiver'},delivery:{mode:'webhook',url:'https://chatgpt.com/mock-receiver',secret:'whsec_'+Buffer.alloc(32,42).toString('base64')}};
     r=await f.request('/mcp',{jsonrpc:'2.0',id:3,method:action,params});
    }
    assert.equal(r.status,503);assert.equal(f.calls.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE dot='receiver'").get().n,1);
    report.push({scenario:action+' pre-action failure',...r,network_requests:f.calls.length});
   }finally{f.close();}
  }
  {
   const f=fixture(e=>e.action==='list_dots'&&e.outcome==='success');
   try{const r=await f.request('/api/tool',{name:'list_dots',arguments:{}});assert.equal(r.status,200);assert.ok(Array.isArray(r.value),'Preserve established array API shape');assert.equal(r.audit_header,'audit_unavailable');report.push({scenario:'array result completion failure',status:r.status,audit_header:r.audit_header,count:r.value.length});}finally{f.close();}
  }
  for(const action of ['token_create','token_revoke','account_update','events/subscribe','events/unsubscribe']){
   const f=fixture(e=>e.action===action&&e.outcome==='success');
   try{
    let r;
    if(action==='token_create'){
     r=await f.request('/api/tokens',{name:'Synthetic new token'});
     assert.equal(r.status,201);assert.match(r.value.secret,/^[A-Za-z0-9_-]{43}$/);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n,2);
     // Never print even synthetic once-shown secrets in the result report.
     r.value={created:true,token_id:r.value.token.id,audit_warning:r.value.audit_warning};
    }else if(action==='token_revoke'){
     r=await f.request('/api/tokens',{id:'synthetic-token'},{method:'DELETE'});
     assert.equal(r.status,200);assert.equal(r.value.deleted,true);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n,0);
    }else if(action==='account_update'){
     const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('member@example.test'))).toString('hex');
     r=await f.request('/api/accounts',{account_id:digest,enabled:false});
     assert.equal(r.status,200);assert.equal(f.sql.prepare("SELECT enabled FROM accounts WHERE email='member@example.test'").get().enabled,0);
    }else{
     const params={name:'dot.mentioned',arguments:{dot_id:'receiver'},delivery:{mode:'webhook',url:'https://chatgpt.com/mock-receiver',secret:'whsec_'+Buffer.alloc(32,42).toString('base64')}};
     r=await f.request('/mcp',{jsonrpc:'2.0',id:2,method:action,params});
     assert.equal(r.status,200);assert.ok(r.value.result);
     assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE dot='receiver'").get().n,action==='events/subscribe'?2:0);
    }
    assert.equal(r.audit_header,'audit_unavailable');assert.equal(r.value.audit_warning,'audit_unavailable');
    report.push({scenario:action+' completion failure',...r});
   }finally{f.close();}
  }
  {
   const f=fixture(e=>e.action==='wake'&&e.outcome==='accepted');
   try{const r=await f.request('/api/tool',{name:'post_to_discord',arguments:{dot_id:'sender',text:'@receiver @another synthetic nested post'}});assert.equal(r.status,200);assert.equal(r.value.sent,true);assert.equal(r.value.message_id,message);assert.equal(r.value.mention_delivery.results.length,2);assert.equal(r.value.audit_warning,'audit_unavailable');assert.equal(f.calls.length,3);report.push({scenario:'nested post-to-wake completion failure',...r,network_requests:f.calls.length});}finally{f.close();}
  }
  {
   const f=fixture(e=>e.action==='wake'&&e.outcome==='rate_limited');
   try{
    f.sql.prepare('INSERT INTO wake_limits(dot,next_allowed) VALUES (?,?)').run('receiver',Date.now()+15000);
    const r=await f.request('/api/wake',{message_id:'mixed-limited',recipients:['receiver','another'],text:'Synthetic rate limited mixed batch'},{bearer:true});
    assert.equal(r.status,200);assert.deepEqual(r.value.results.map(x=>x.status),['rate_limited','accepted']);assert.equal(r.value.audit_warning,'audit_unavailable');assert.equal(f.calls.length,1);report.push({scenario:'rate-limited partial batch audit failure',...r,callbacks:f.calls.length});
    const limited=await f.request('/api/wake',{message_id:'all-limited',recipients:['receiver','another'],text:'Synthetic all limited batch'},{bearer:true});assert.equal(limited.status,429);assert.equal(limited.value.audit_warning,'audit_unavailable');assert.equal(f.calls.length,1);
    const healthy=await f.request('/api/tool',{name:'list_dots',arguments:{}});assert.equal(healthy.status,200);assert.equal(healthy.audit_header,null,'Request-scoped warning never leaks to unrelated calls');assert.ok(Array.isArray(healthy.value));
   }finally{f.close();}
  }
 }
 console.log(JSON.stringify(report,null,2));console.log(fixed?'PASS independent fixed receipt and fail-closed checks':'REPRODUCED upstream lost-receipt bugs; pre-action auditing remains fail-closed');
}finally{globalThis.fetch=originalFetch;}
