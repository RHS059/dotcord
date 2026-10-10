import assert from 'node:assert/strict';
import worker from '../receiver/worker/index.js';
const env={RECEIVER_SUBJECT:'receiver-subject',DOTCORD_ORIGIN:'https://shared.example.invalid',DOTCORD_RECEIVER_TOKEN:'dcr_'+'s'.repeat(43),DOTCORD_SITES_TOKEN:'synthetic-host-token'};
const original=globalThis.fetch;let calls=[];
function mock(body={result:{state:'ready',account_binding:'acct_synthetic'}}){globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(body);};}
async function call(method,params={},subject='receiver-subject',override={}){
 const headers={'content-type':'application/json',cookie:'must-not-forward','oai-authenticated-user-email':'must-not-forward'};if(subject)headers['oai-authenticated-user-id']=subject;
 const request=new Request('https://receiver.example.invalid/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const response=await worker.fetch(request,{...env,...override});return {status:response.status,body:await response.json()};
}
try{
 mock();assert.equal((await call('events/list',{},null)).body.result.events[0].inputSchema.additionalProperties,false);assert.equal(calls.length,0);
 assert.equal((await call('tools/call',{name:'get_receiver_status'},'other-subject')).status,403);
 assert.equal((await call('tools/call',{name:'get_receiver_status'},null)).status,401);
 assert.equal((await call('tools/call',{name:'get_receiver_status'},'receiver-subject',{RECEIVER_SUBJECT:''})).status,503);assert.equal(calls.length,0);
 const status=await call('tools/call',{name:'get_receiver_status',arguments:{}});assert.equal(status.body.result.structuredContent.state,'ready');
 assert.equal(calls[0].url,env.DOTCORD_ORIGIN+'/api/receiver');assert.equal(calls[0].options.redirect,'manual');
 assert.deepEqual(calls[0].options.headers,{'content-type':'application/json',authorization:'Bearer '+env.DOTCORD_RECEIVER_TOKEN,'OAI-Sites-Authorization':'Bearer synthetic-host-token'});
 assert.deepEqual(JSON.parse(calls[0].options.body),{method:'status',params:{}});
 const params={name:'dot.mentioned',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/synthetic',secret:'synthetic'},ttlMs:60000};
 mock({result:{id:'sub_synthetic',refreshBefore:'2099-01-01'}});
 assert.equal((await call('events/subscribe',params)).body.result.id,'sub_synthetic');assert.deepEqual(JSON.parse(calls.at(-1).options.body),{method:'subscribe',params});
 const before=calls.length;assert.equal((await call('events/subscribe',{...params,arguments:{dot_id:'other'}})).status,400);assert.equal(calls.length,before);
 assert.equal((await call('events/unsubscribe',{name:'dot.mentioned',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/synthetic'}})).status,200);
 mock({error:{code:-32016,message:'Wrong receiver account.',data:{reason:'wrong_connected_account'}}});
 assert.deepEqual((await call('events/subscribe',params)).body.error,{code:-32016,message:'Wrong receiver account.',data:{reason:'wrong_connected_account'}});
 const beforeInvalid=calls.length;for(const origin of ['http://shared.example.invalid','https://shared.example.invalid/','https://shared.example.invalid/path','https://user@shared.example.invalid'])assert.equal((await call('tools/call',{name:'get_receiver_status'},'receiver-subject',{DOTCORD_ORIGIN:origin})).status,503);assert.equal(calls.length,beforeInvalid);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}});assert.equal((await call('tools/call',{name:'get_receiver_status'})).status,502);
 globalThis.fetch=async()=>{throw new TypeError('redirect '+env.DOTCORD_RECEIVER_TOKEN);};const failed=await call('tools/call',{name:'get_receiver_status'});assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed).includes(env.DOTCORD_RECEIVER_TOKEN));
 const identity=await worker.fetch(new Request('https://receiver.example.invalid/api/identity',{headers:{'oai-authenticated-user-id':'new-own-subject'}}),env);assert.deepEqual(await identity.json(),{subject:'new-own-subject',pinned:false});
 assert.equal((await worker.fetch(new Request('https://receiver.example.invalid/api/identity'),env)).status,401);
 const hostile=new Request('https://receiver.example.invalid/mcp',{method:'POST',headers:{'content-type':'application/json',origin:'https://hostile.invalid'},body:'{}'});assert.equal((await worker.fetch(hostile,env)).status,403);
 const large=new Request('https://receiver.example.invalid/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({padding:'x'.repeat(20001)})});assert.equal((await worker.fetch(large,env)).status,413);
 console.log('receiver companion: identity isolation, forwarding, empty filters, errors and input bounds passed');
}finally{globalThis.fetch=original;}
