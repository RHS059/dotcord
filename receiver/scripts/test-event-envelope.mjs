import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../worker/index.js';

const token='dcr_'+'x'.repeat(43);
const env={DOTCORD_ORIGIN:'https://shared.example.invalid',RECEIVER_SUBJECT:'owner',DOTCORD_RECEIVER_TOKEN:token};
const params={name:'dot.mentioned',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/private-callback',secret:'private-signing-secret'},ttlMs:60000,cursor:null};
async function rpc(method,parameters,subject='owner'){
 const response=await worker.fetch(new Request('https://receiver.example.invalid/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':subject},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:parameters})}),env);
 return {status:response.status,body:await response.json()};
}

await test('receiver event envelope compatibility and bounded diagnostics',async t=>{
 const originalFetch=globalThis.fetch,originalInfo=console.info,originalWarn=console.warn;
 const calls=[],logs=[];
 let upstreamResult={result:{id:'sub_example'}};
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(upstreamResult);};
 console.info=console.warn=(...args)=>logs.push(args);
 try{
  await t.test('subscribe and unsubscribe remove only MCP _meta and preserve semantic fields',async()=>{
   for(const method of ['events/subscribe','events/unsubscribe']){
    const response=await rpc(method,{...params,_meta:{'transport/request-id':'private-request-id',nested:{secret:token}}});
    assert.equal(response.status,200);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body),{method:method.slice(7),params});
    assert.deepEqual(JSON.parse(logs.at(-1)[0]),{event:'receiver_event_envelope',has_meta:true,unknown_param_count:0});
   }
   await rpc('events/subscribe',{name:'dot.mentioned',delivery:params.delivery});
   assert.deepEqual(JSON.parse(calls.at(-1).options.body).params,{name:'dot.mentioned',delivery:params.delivery,arguments:{}});
  });
  await t.test('unknown fields, semantic arguments and invalid metadata reject before forwarding',async()=>{
   const count=calls.length;
   for(const method of ['events/subscribe','events/unsubscribe']){
    const unknown=await rpc(method,{...params,_meta:{},'private-unknown-key':token});
    assert.equal(unknown.status,400);
    assert.equal(unknown.body.error.message,'Unsupported receiver event parameters.');
    assert.deepEqual(JSON.parse(logs.at(-1)[0]),{event:'receiver_event_envelope',has_meta:true,unknown_param_count:1});
    for(const argumentsValue of [{dot_id:'other'},null,[]])assert.equal((await rpc(method,{...params,arguments:argumentsValue})).status,400);
    for(const meta of [null,[],token])assert.equal((await rpc(method,{...params,_meta:meta})).status,400);
   }
   assert.equal(calls.length,count);
  });
  await t.test('upstream numeric errors retain sanitization and diagnostics contain no private content',async()=>{
   upstreamResult={error:{code:-32015,message:token+' '+params.delivery.secret+' '+params.delivery.url}};
   const response=await rpc('events/subscribe',{...params,_meta:{secret:token}});
   assert.deepEqual(response.body.error,{code:-32015,message:'Dotcord rejected the receiver request. Check the credential and account settings.'});
   assert.deepEqual(JSON.parse(logs.at(-1)[0]),{event:'receiver_event_upstream_error',upstream_error_code:-32015,has_meta:true,unknown_param_count:0});
   const serialized=JSON.stringify({logs,response});
   for(const value of [token,params.delivery.secret,params.delivery.url,'private-request-id','private-unknown-key'])assert.ok(!serialized.includes(value));
  });
  await t.test('wrong owner cannot forward or produce event diagnostics',async()=>{
   const count=calls.length,logCount=logs.length;
   assert.equal((await rpc('events/subscribe',{...params,_meta:{}},'other')).status,403);
   assert.equal(calls.length,count);assert.equal(logs.length,logCount);
  });
 }finally{globalThis.fetch=originalFetch;console.info=originalInfo;console.warn=originalWarn;}
});
