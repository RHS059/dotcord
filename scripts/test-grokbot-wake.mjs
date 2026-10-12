import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(query){return{bind(...args){return{first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'alpha@example.test',role:'owner'}])};
for(const id of ['alpha','beta'])sql.prepare("INSERT INTO accounts(email,user_id,role,enabled,status) VALUES (?,?,'member',1,'active')").run(id+'@example.test',id);
sql.prepare('INSERT INTO discords(id,owner,name,connection_url,guild_id,channel_id) VALUES (?,?,?,?,?,?)').run('shared','alpha','Shared','','123456789012345678','234567890123456789');
async function request(path,method='GET',body,who='alpha',origin='https://relay.test'){
 const r=await worker.fetch(new Request('https://relay.test'+path,{method,headers:{'content-type':'application/json',origin,'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'},...(body?{body:JSON.stringify(body)}:{})}),env);return{status:r.status,data:await r.json()};
}
async function tool(name,args,who='alpha'){const r=await request('/api/tool','POST',{name,arguments:args},who);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
const calls=[];let responseStatus=204,fail=false;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});if(fail)throw Error('secret must not leak');return new Response(null,{status:responseStatus});};
const creds={name:'Grok wake',dot_id:'grok_agent',webhook_url:'https://grok.example.com/hooks/private',auth_token:'private-auth-token',auth_header:'X-Grok-Secret',source:'Dotcord',expires_in_days:30};
let seq=0;
async function wake(messageId='grok-'+(++seq),text='@grok_agent hello "quoted"\nline'){sql.exec('DELETE FROM wake_limits');return tool('send_mention',{sender:'sender',message_id:messageId,text},'beta');}
try{
 await tool('register_dot',{dot_id:'sender',discord_id:'shared'},'beta');
 await tool('register_dot',{dot_id:'grok_agent',discord_id:'shared',wake_provider:'grokbot',agent_type:'agent'});
 const agents=await tool('list_dots',{});assert.equal(agents.find(a=>a.dot_id==='sender').wake_provider,'dot');
 assert.equal((await request('/api/receivers','POST',{...creds,provider:'dot'})).status,400,'No independent provider override');
 assert.equal((await request('/api/receivers','POST',creds,'beta')).status,403);
 assert.equal((await request('/api/receivers','POST',creds,'alpha','https://other.test')).status,403);
 for(const webhook_url of ['http://grok.example.com/','https://127.0.0.1/','https://[::1]/','https://user:pass@grok.example.com/'])assert.equal((await request('/api/receivers','POST',{...creds,webhook_url})).status,400);
 for(const auth_header of ['Content-Type','Host','X-Test\r\nInjected','Cookie'])assert.equal((await request('/api/receivers','POST',{...creds,auth_header})).status,400);
 let created=await request('/api/receivers','POST',creds);assert.equal(created.status,201,JSON.stringify(created));const id=created.data.receiver.id;
 assert.equal(created.data.secret,undefined);assert.equal(calls.length,0,'Saving never contacts webhook');
 assert.equal((await request('/api/receivers','POST',creds)).status,400,'Duplicate recipient rejected');
 const listed=(await request('/api/receivers')).data;assert.equal(listed.receivers[0].provider,'grokbot');assert.equal(listed.receivers[0].source,'Dotcord');
 for(const secret of [creds.webhook_url,creds.auth_token])assert.equal(JSON.stringify([created.data,listed,agents]).includes(secret),false);
 assert.equal((await request('/api/receivers','PATCH',{id,name:'stolen'},'beta')).status,403);
 let edit=await request('/api/receivers','PATCH',{id,name:'Updated',source:'Updated source',webhook_url:'',auth_token:''});assert.equal(edit.status,200,JSON.stringify(edit));
 let result=await wake('dedup');assert.equal(result.results[0].status,'accepted',JSON.stringify(result));assert.equal(calls.length,1);
 assert.equal(calls[0].url,creds.webhook_url);assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.headers['X-Grok-Secret'],creds.auth_token);assert.deepEqual(calls[0].body,{message:'@grok_agent hello "quoted"\nline',source:'Updated source'});
 result=await wake('dedup');assert.equal(calls.length,1);assert.equal(result.results[0].replayed,true);
 assert.equal((await wake('dedup','@grok_agent changed')).results[0].status,'message_conflict');assert.equal(calls.length,1);
 const reqId=Date.now()+'_'+crypto.randomUUID();sql.exec('DELETE FROM wake_limits');const test=await request('/api/test-wake','POST',{dot_id:'grok_agent',request_id:reqId});assert.equal(test.status,200,JSON.stringify(test));assert.equal(test.data.status,'accepted');assert.equal(calls.length,2);
 await request('/api/test-wake','POST',{dot_id:'grok_agent',request_id:reqId});assert.equal(calls.length,2);
 responseStatus=302;assert.equal((await wake()).results[0].status,'rejected');assert.equal(calls.length,3);
 fail=true;assert.equal((await wake('uncertain')).results[0].status,'unknown');assert.equal(calls.length,4);await wake('uncertain');assert.equal(calls.length,4,'No automatic repeat on uncertain result');fail=false;responseStatus=204;
 await tool('update_agent',{dot_id:'grok_agent',handle:'renamed_grok',discord_id:'shared',wake_provider:'grokbot'});assert.equal((await request('/api/receivers')).data.receivers[0].dot_id,'renamed_grok');
 sql.prepare('UPDATE receiver_credentials SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',id);await wake('expired','@renamed_grok expire');assert.equal(calls.length,4);
 await tool('delete_agent',{dot_id:'renamed_grok'});assert.equal(sql.prepare('SELECT id FROM receiver_credentials WHERE id=?').get(id),undefined);
 // Dot and Claude inherit native receiver behavior; existing native credentials remain valid.
 await tool('register_dot',{dot_id:'native_agent',discord_id:'shared'});const native=await request('/api/receivers','POST',{name:'Native',dot_id:'native_agent'});assert.match(native.data.secret,/^dcr_/);
 await tool('update_agent',{dot_id:'native_agent',handle:'native_agent',discord_id:'shared',wake_provider:'claude'});
 assert.equal((await request('/api/receivers')).data.receivers.find(r=>r.id===native.data.receiver.id).provider,'claude');

 const native2=await request('/api/receivers','POST',{name:'Native 2',dot_id:'native_agent'});assert.equal(native2.status,201);
 await tool('update_agent',{dot_id:'native_agent',handle:'native_agent',discord_id:'shared',wake_provider:'grokbot',agent_type:'agent'});
 const converted=await request('/api/receivers','PATCH',{id:native.data.receiver.id,webhook_url:creds.webhook_url,auth_token:creds.auth_token,auth_header:creds.auth_header,source:'converted'});assert.equal(converted.status,200,JSON.stringify(converted));
 assert.equal((await request('/api/receivers','PATCH',{id:native2.data.receiver.id,webhook_url:creds.webhook_url,auth_token:creds.auth_token,source:'duplicate'})).status,400);
 assert.equal((await request('/api/account','POST',{dot_id:'native_agent'})).status,400,'Grokbot is not a native account profile');
 const before=calls.length;await wake('converted','@native_agent works');assert.equal(calls.length,before+1);assert.deepEqual(calls.at(-1).body,{message:'@native_agent works',source:'converted'});
 const audit=sql.prepare('SELECT * FROM security_audit').all();assert.equal(JSON.stringify(audit).includes(creds.auth_token),false);
 console.log('PASS Grokbot: inherited agent type, native defaults, secret-safe create/edit/list, exact POST body/header, permissions/CSRF, validation, mention routing, stable duplicate suppression, test wake, redirects/timeouts without retries, expiry, rename/delete and Claude fallback. Network mocked.');
}finally{globalThis.fetch=originalFetch;sql.close();}
