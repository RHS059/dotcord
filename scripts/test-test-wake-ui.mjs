import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

// Exercise the built production React UI. Every request is intercepted; this
// suite never registers a subscription, sends a live wake, or posts to Discord.
const html=readFileSync('client-build/index.html','utf8');
const script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
const until=async(check,label='condition')=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Test wake UI timeout: '+label);};
const responseFor=(body,status='accepted',extra={})=>Response.json({
 request_id:body.request_id,message_id:'test_message_'+body.request_id,handle:body.dot_id,status,
 results:[{handle:body.dot_id,status,attempts:status==='accepted'?1:0}],agent_execution_confirmed:false,...extra
});

async function mount({admin=false,profile='own_dot',agents:customAgents,state='ready'}={}){
 const dom=new JSDOM(html,{url:'https://shared.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 const agents=customAgents||[
  {dot_id:'admin_dot',agent_type:'dot',is_owned:0,can_manage:admin?1:0,discord_id:'shared',webhook_configured:1},
  {dot_id:'own_dot',agent_type:'dot',is_owned:1,can_manage:1,discord_id:state==='destination_required'?null:'shared',webhook_configured:1},
  {dot_id:'own_other',agent_type:'dot',is_owned:1,can_manage:1,discord_id:'shared',webhook_configured:0},
  {dot_id:'foreign_dot',agent_type:'dot',is_owned:0,can_manage:0,discord_id:'shared',webhook_configured:1},
  {dot_id:'own_agent',agent_type:'agent',is_owned:1,can_manage:1,discord_id:'shared',webhook_configured:1}
 ];
 let testResponse=body=>responseFor(body);
 w.fetch=async(path,options={})=>{
  calls.push({path,options});
  if(path==='/api/account')return Response.json({can_manage_accounts:admin,profile:{dot_id:profile,selection_required:!profile},wake:{account_binding:'acct_fixture',state,active_subscriptions:state==='ready'?1:0,account_subscriptions:state==='ready'?1:0,refresh_before:state==='ready'?'2099-01-01T00:00:00Z':null,subscription_required:state!=='ready'}});
  if(path==='/api/accounts')return Response.json({accounts:[]});
  if(path==='/api/tool'){
   const data=JSON.parse(options.body);
   assert.ok(['list_dots','list_discords'].includes(data.name),'Test control must not call posting or subscription tools');
   return Response.json(data.name==='list_dots'?agents:[{id:'shared',name:'Test destination',bot_configured:1}]);
  }
  if(path==='/api/test-wake'){
   assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
   assert.equal(options.headers['content-type'],'application/json');
   const body=JSON.parse(options.body);
   assert.deepEqual(Object.keys(body).sort(),['dot_id','request_id']);
   assert.match(body.request_id,/^\d{13}_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
   return await testResponse(body);
  }
  throw Error('Unexpected mocked request '+path);
 };
 w.eval(script);
 const panel=()=>w.document.querySelector('[aria-label="Account wake readiness"]');
 const btn=text=>[...panel().querySelectorAll('button')].find(button=>button.textContent.trim()===text);
 const el=selector=>panel().querySelector(selector);
 const text=()=>panel().textContent;
 const result=()=>el('[aria-label="Test wake result"]');
 const click=element=>{assert.ok(element,'Expected clickable control');element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
 const select=async value=>{const element=el('#test-wake-recipient');element.value=value;element.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();};
 const testCalls=()=>calls.filter(call=>call.path==='/api/test-wake').map(call=>JSON.parse(call.options.body));
 await until(()=>panel()&&el('#test-wake-recipient')&&!w.document.body.textContent.includes('Loading…'),'mount');
 return {w,el,btn,text,result,click,select,testCalls,setResponse:value=>{testResponse=value;},close:()=>{
  assert.equal(w.localStorage.length,0,'No test identifiers or secrets in localStorage');
  assert.equal(w.sessionStorage.length,0,'No test identifiers or secrets in sessionStorage');
  assert.equal(calls.some(call=>/subscribe|discord\.com/.test(call.path)),false);
  dom.window.close();
 }};
}

// Available targets are owned Dot handles or administrator-manageable Dot
// handles, with the current account profile selected even if it is not first.
for(const admin of [false,true]){
 const ui=await mount({admin});
 assert.deepEqual([...ui.el('#test-wake-recipient').options].map(option=>option.value),admin?['','admin_dot','own_dot','own_other']:['','own_dot','own_other']);
 assert.equal(ui.el('#test-wake-recipient').value,'own_dot');
 assert.match(ui.text(),/real test notification.*saved receiving subscription without posting to Discord/);
 assert.match(ui.text(),/does not create or renew a subscription/);
 assert.equal(ui.testCalls().length,0,'Mounting never sends a wake');
 ui.close();
}
{
 const ui=await mount({admin:true,profile:null});
 assert.equal(ui.el('#test-wake-recipient').value,'');assert.ok(ui.btn('Test wake').disabled);
 await ui.select('admin_dot');assert.equal(ui.btn('Test wake').disabled,false);
 ui.click(ui.btn('Test wake'));await until(()=>ui.result()?.textContent.includes('accepted by the receiving callback'));
 assert.equal(ui.testCalls()[0].dot_id,'admin_dot','An admin without a primary profile can test a managed Dot');
 ui.close();
}
{
 const ui=await mount({profile:null,agents:[{dot_id:'external_agent',agent_type:'agent',is_owned:1,can_manage:1,webhook_configured:1}]});
 assert.ok(ui.el('#test-wake-recipient').disabled);assert.ok(ui.btn('Test wake').disabled);
 assert.match(ui.text(),/Add your Dot handle/);assert.equal(ui.testCalls().length,0);ui.close();
}

// Same-render duplicate clicks are ref-locked. Tab navigation keeps the pending
// request mounted, and a completed result allows an explicit new test.
{
 const ui=await mount();let resolve;
 ui.setResponse(body=>new Promise(done=>{resolve=()=>done(responseFor(body,'accepted',{results:[{handle:body.dot_id,status:'accepted',attempts:1,inbox_id:'inbox_fixture',inbox_expires_at:'2099-01-01T00:00:00Z'}]}));}));
 const button=ui.btn('Test wake');ui.click(button);ui.click(button);
 assert.equal(ui.testCalls().length,1,'Synchronous clicks must produce one request');
 await until(()=>ui.btn('Checking test…'));assert.ok(ui.btn('Checking test…').disabled);assert.ok(ui.el('#test-wake-recipient').disabled);
 const firstId=ui.testCalls()[0].request_id;
 ui.click([...ui.w.document.querySelectorAll('nav a')].find(a=>a.textContent==='Discord'));
 await until(()=>ui.w.document.querySelector('h1')?.textContent==='Discord');
 ui.click([...ui.w.document.querySelectorAll('nav a')].find(a=>a.textContent==='Agents'));
 await until(()=>ui.w.document.querySelector('h1')?.textContent==='Agents');
 assert.ok(ui.btn('Checking test…').disabled,'Navigating tabs preserves pending guard');
 ui.click(ui.btn('Checking test…'));assert.equal(ui.testCalls().length,1);
 const unload=new ui.w.Event('beforeunload',{cancelable:true});ui.w.dispatchEvent(unload);assert.ok(unload.defaultPrevented);
 resolve();await until(()=>ui.btn('Test wake')&&!ui.btn('Test wake').disabled);
 assert.match(ui.result().textContent,/Test notification accepted by the receiving callback/);
 assert.match(ui.result().textContent,/Agent execution is not confirmed/);
 assert.match(ui.result().textContent,/Inbox ID: inbox_fixture/);
 assert.ok(ui.result().textContent.includes('Message ID: test_message_'+firstId));
 assert.ok(ui.result().textContent.includes('Request ID: '+firstId));
 assert.equal(ui.testCalls().length,1,'No automatic retry after acceptance');
 const after=new ui.w.Event('beforeunload',{cancelable:true});ui.w.dispatchEvent(after);assert.equal(after.defaultPrevented,false);
 await ui.select('own_other');assert.equal(ui.result(),null,'Recipient switch does not show the previous recipient’s outcome');
 assert.equal(ui.btn('Test wake').disabled,false,'Discord posting webhook is not required for a wake test');
 await ui.select('own_dot');assert.ok(ui.result().textContent.includes(firstId));
 ui.setResponse(body=>responseFor(body));ui.click(ui.btn('Test wake'));
 await until(()=>ui.testCalls().length===2&&ui.btn('Test wake'));
 assert.notEqual(ui.testCalls()[1].request_id,firstId,'Explicit completed-state test uses a new ID');ui.close();
}

// Setup failures remain actionable without manufacturing platform subscriptions.
for(const status of ['not_subscribed','destination_required','rate_limited']){
 const ui=await mount({state:status});ui.setResponse(body=>responseFor(body,status,{results:[{handle:body.dot_id,status,attempts:0,...(status==='rate_limited'?{retry_after_seconds:15}:{})}]}));
 ui.click(ui.btn('Test wake'));await until(()=>ui.result()?.textContent.includes(status));
 assert.ok(!ui.btn('Test wake').disabled);assert.equal(ui.testCalls().length,1);
 if(status==='not_subscribed')assert.match(ui.result().textContent,/Connect or renew/);
 if(status==='destination_required')assert.match(ui.result().textContent,/Choose a saved Discord destination/);
 if(status==='rate_limited')assert.match(ui.result().textContent,/Wait at least 15 seconds/);
 ui.close();
}

// Partial and terminal failures include individual callback and inbox guidance.
{
 const ui=await mount();
 ui.setResponse(body=>responseFor(body,'partial',{audit_warning:'audit_unavailable',receipt_warning:'receipt_unavailable',results:[{handle:body.dot_id,status:'accepted',attempts:1},{handle:body.dot_id,status:'gone',attempts:1},{handle:body.dot_id,status:'transient',attempts:3}]}));
 ui.click(ui.btn('Test wake'));await until(()=>ui.result()?.textContent.includes('Some receiving callbacks'));
 assert.match(ui.result().textContent,/Reconnect or renew/);assert.match(ui.result().textContent,/3 callback attempts/);
 assert.match(ui.result().textContent,/Do not repeat this test just for the failed callbacks/);
 assert.match(ui.result().textContent,/audit record could not be completed/);
 assert.match(ui.result().textContent,/test result could not be fully saved/);
 assert.equal(ui.testCalls().length,1);assert.ok(!ui.btn('Test wake').disabled);ui.close();
}
for(const [status,guidance] of [['oversized','payload size'],['rejected','Verify the receiving connection'],['inactive','Check account access'],['inbox_full','Read and acknowledge'],['inbox_unavailable','Check the service'],['already_acknowledged','already acknowledged'],['message_conflict','Message ID conflict']]){
 const ui=await mount();ui.setResponse(body=>responseFor(body,'failed',{results:[{handle:body.dot_id,status,attempts:0}]}));
 ui.click(ui.btn('Test wake'));await until(()=>ui.result()?.textContent.includes(guidance));
 assert.match(ui.result().textContent,/Agent execution is not confirmed/);assert.ok(!ui.btn('Test wake').disabled);ui.close();
}

// Network loss, 503, and in-progress replays retain the same ID. Switching away
// and back must not discard an unresolved attempt or display it for another Dot.
{
 const ui=await mount();let step=0;
 ui.setResponse(body=>{
  step++;
  if(step===1)throw Error('Network lost');
  if(step===2)return Response.json({error:'Service temporarily unavailable'},{status:503});
  if(step===3)return responseFor(body,'in_progress',{results:[],replayed:true});
  return responseFor(body,'accepted',{replayed:true});
 });
 ui.click(ui.btn('Test wake'));await until(()=>ui.btn('Check test result'));
 const original=ui.testCalls()[0].request_id;assert.match(ui.result().textContent,/test result is unknown/);
 assert.ok(!ui.btn('Check test result').disabled);assert.equal(ui.testCalls().length,1);
 ui.click(ui.btn('Check test result'));await until(()=>ui.result()?.textContent.includes('Service temporarily unavailable'));
 assert.ok(!ui.btn('Check test result').disabled);assert.equal(ui.testCalls()[1].request_id,original);
 await ui.select('own_other');assert.equal(ui.result(),null);assert.ok(ui.btn('Test wake'));
 await ui.select('own_dot');assert.ok(ui.btn('Check test result'));assert.ok(ui.result().textContent.includes(original));
 ui.click(ui.btn('Check test result'));await until(()=>ui.result()?.textContent.includes('This test is still in progress')&&!ui.btn('Checking test…'));
 assert.equal(ui.testCalls()[2].request_id,original);assert.ok(ui.btn('Check test result'));
 ui.click(ui.btn('Check test result'));await until(()=>ui.result()?.textContent.includes('Test notification accepted'));
 assert.equal(ui.testCalls()[3].request_id,original);assert.match(ui.result().textContent,/same test request/);
 assert.ok(ui.btn('Test wake'));ui.close();
}

// Malformed replies, mismatched correlation IDs and later auth failures cannot
// accidentally convert an uncertain delivery into an automatic new delivery.
for(const invalid of ['json','request','recipient']){
 const ui=await mount();ui.setResponse(body=>invalid==='json'?new Response('not JSON'):responseFor(body,'accepted',invalid==='request'?{request_id:'another_request'}:{handle:'foreign_dot'}));
 ui.click(ui.btn('Test wake'));await until(()=>ui.btn('Check test result'));
 const original=ui.testCalls()[0].request_id;
 ui.setResponse(()=>Response.json({error:'Sign in to continue.'},{status:401}));
 ui.click(ui.btn('Check test result'));await until(()=>ui.result()?.textContent.includes('Sign in to continue.'));
 assert.ok(ui.btn('Check test result'));assert.equal(ui.testCalls()[1].request_id,original);
 assert.match(ui.result().textContent,/test result is unknown/);ui.close();
}
{
 const ui=await mount();ui.setResponse(()=>Response.json({error:'Choose an active, authorized Dot handle.'},{status:403}));
 ui.click(ui.btn('Test wake'));await until(()=>ui.result()?.textContent.includes('Choose an active, authorized'));
 assert.ok(!ui.btn('Test wake').disabled);assert.equal(ui.btn('Check test result'),undefined);ui.close();
}

// A separate, deliberate new-test control warns about possible prior delivery.
// Merely opening/canceling that confirmation cannot cause a notification.
{
 const ui=await mount();ui.setResponse(()=>{throw Error('Network lost');});
 ui.click(ui.btn('Test wake'));await until(()=>ui.btn('Check test result'));
 const original=ui.testCalls()[0].request_id;
 ui.click(ui.btn('Start a new test'));await until(()=>ui.btn('Send another test'));
 assert.match(ui.text(),/earlier notification may already have been delivered/);
 assert.equal(ui.testCalls().length,1);
 ui.click(ui.btn('Cancel new test'));await until(()=>!ui.btn('Send another test'));assert.equal(ui.testCalls().length,1);
 ui.click(ui.btn('Start a new test'));await until(()=>ui.btn('Send another test'));
 ui.setResponse(body=>responseFor(body));ui.click(ui.btn('Send another test'));
 await until(()=>ui.testCalls().length===2&&ui.btn('Test wake'));
 assert.notEqual(ui.testCalls()[1].request_id,original);assert.equal(ui.btn('Send another test'),undefined);ui.close();
}
console.log('PASS Test wake UI: eligible own/admin targets, profile default, missing setup, ref-locked double clicks, tab persistence, accepted/partial/failure guidance, inbox and audit receipts, stable request-ID result checks, in-progress and malformed replies, recipient isolation, explicit uncertain new-test confirmation, no persistent browser storage. All network mocked; no live wake or Discord post.');
