import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('client-build/index.html','utf8'),script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const until=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wake readiness UI timed out');};
for(const scenario of ['missing','ready','expired','destination','select']){
 const dom=new JSDOM(html,{url:'https://shared.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 let selected=scenario!=='select',fail=true;
 const account=()=>({profile:{dot_id:selected?'agent_one':null,selection_required:!selected},wake:{account_binding:'acct_example',state:!selected?'selection_required':scenario==='missing'?'not_subscribed':scenario==='destination'?'destination_required':'ready',active_subscriptions:scenario==='missing'?0:1,account_subscriptions:scenario==='missing'?0:1,refresh_before:scenario==='missing'?null:scenario==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z'}});
 w.fetch=async(path,options={})=>{
  calls.push({path,options});
  if(path==='/api/account'){
   if(options.method==='POST'){
    assert.deepEqual(JSON.parse(options.body),{dot_id:'agent_one'});
    if(fail)return Response.json({error:'Unable to save account handle.'},{status:503});
    selected=true;
   }
   return Response.json(account());
  }
  if(path==='/api/tool')return Response.json(JSON.parse(options.body).name==='list_dots'?[{dot_id:'agent_one',agent_type:'dot',is_owned:1,webhook_configured:1,can_manage:1,subscriptions:0},{dot_id:'someone_else',agent_type:'dot',is_owned:0,can_manage:0}]:[]);
  throw Error('Unexpected request '+path);
 };
 w.eval(script);await until(()=>w.document.querySelector('[aria-label="Account wake readiness"]'));
 const panel=()=>w.document.querySelector('[aria-label="Account wake readiness"]'),text=()=>panel().textContent;
 assert.ok(text().includes('acct_example'));assert.ok(text().includes('get_wake_status'));assert.ok(text().includes('{"account_binding":"acct_example"}')); 
 if(scenario==='destination')assert.ok(text().includes('choose a Discord destination for this account'));
 if(scenario==='ready')assert.ok(text().includes('Wake ready — active receiving subscription'));
 if(scenario==='missing'||scenario==='expired'){assert.ok(text().includes('Action needed'));assert.ok(!text().includes('Wake ready'));assert.ok(text().includes('saved for posting'),'Saved webhook must not imply readiness');}
 if(scenario==='select'){
  const input=w.document.querySelector('#account-handle');assert.deepEqual([...input.options].map(o=>o.value),['','agent_one'],'Only own Dot profile candidates are shown');
  input.value='agent_one';input.dispatchEvent(new w.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));
  panel().querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>text().includes('Unable to save account handle.'));
  assert.equal(calls.filter(c=>c.options.method==='POST'&&c.path==='/api/account').length,1,'Failed save does not auto retry');
  assert.ok(w.document.querySelector('#account-handle'));
  fail=false;panel().querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#account-handle'));
  assert.ok(text().includes('@agent_one'));
 }
 assert.equal(calls.some(c=>c.path.includes('subscribe')),false,'Browser must not claim to create platform subscriptions');
 assert.equal(w.localStorage.length,0);dom.window.close();
}
console.log('PASS account wake readiness UI: saved webhook versus readiness, expiration, bound account identifier, owned profile choice, failed save recovery. API mocked.');
