import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('client-build/index.html','utf8'),script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
let dom,w;
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(check){for(let i=0;i<200;i++){if(check())return;await pause();}throw Error('Account status UI timeout: '+w.document.body.textContent);}
const button=text=>[...w.document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);
function click(element){assert.ok(element);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));}
function input(selector,value){const element=w.document.querySelector(selector);assert.ok(element);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new w.Event('input',{bubbles:true}));}
function boot({status='signed_up',tab='tokens',owner=false,defer=false,agents=[]}={}){
 dom?.window.close();dom=new JSDOM(html,{url:'https://shared.test/?tab='+tab,runScripts:'outside-only',pretendToBeVisual:true});w=dom.window;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.confirm=()=>true;
 const calls=[],state={status,agents,fail:false,failAccount:false,defer,release:null};
 const accounts=[{id:'owner',email:'owner@example.test',role:'owner',enabled:1,status:'active'},{id:'member',email:'member@example.test',role:'member',enabled:0,status:'signed_up'},{id:'active',email:'active@example.test',role:'member',enabled:1,status:'active'}];
 w.fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({path,method:options.method,body});
  if(path==='/api/account'){
   if(state.defer){state.defer=false;await new Promise(resolve=>state.release=resolve);}
   if(state.status==='inactive')return Response.json({error:'This account is inactive. Contact an administrator.'},{status:401});
   return Response.json({...(state.status==='legacy'?{}:{account_status:state.status}),can_manage_accounts:owner,auth_method:'host',...(state.status==='active'?{profile:{dot_id:null,selection_required:false},wake:{account_binding:'sample-binding',state:'not_subscribed',active_subscriptions:0,account_subscriptions:0,refresh_before:null,subscription_required:true}}:{})});
  }
  if(path==='/api/tool'){
   if(body.name==='list_dots')return Response.json(state.agents);
   if(body.name==='list_discords'){assert.notEqual(state.status,'signed_up');return Response.json([]);}
   if(body.name==='register_dot'){
    assert.deepEqual(Object.keys(body.arguments).sort(),['agent_type','dot_id']);
    if(state.fail)return Response.json({error:'That handle is already registered.'},{status:409});
    state.agents=[{...body.arguments,is_owned:1,can_manage:1}];return Response.json({registered:true});
   }
   if(body.name==='update_agent'){
    assert.deepEqual(Object.keys(body.arguments).sort(),['agent_type','dot_id','handle']);
    assert.equal(body.arguments.dot_id,state.agents[0].dot_id);state.agents=[{dot_id:body.arguments.handle,agent_type:body.arguments.agent_type,is_owned:1,can_manage:1}];return Response.json({saved:true});
   }
   if(body.name==='delete_agent'){assert.deepEqual(body.arguments,{dot_id:state.agents[0].dot_id});state.agents=[];return Response.json({deleted:true});}
   throw Error('Unexpected tool '+body.name);
  }
  if(path==='/api/accounts'){
   if(options.method==='POST'){
    assert.deepEqual(Object.keys(body).sort(),['account_id','status']);assert.notEqual(body.account_id,'owner');
    if(state.failAccount)return Response.json({error:'Account status save failed.'},{status:503});
    const account=accounts.find(account=>account.id===body.account_id);account.status=body.status;account.enabled=body.status==='active'?1:0;
   }
   return Response.json({accounts});
  }
  if(path==='/api/tokens')return Response.json({tokens:[]});
  if(path==='/api/receivers')return Response.json({receivers:[]});
  if(path==='/api/auth/providers')return Response.json({google:false,chatgpt:true});
  if(path==='/api/auth/google-settings')return Response.json({configured:false,source:'none',client_id:'',has_secret:false,redirect_uri:'https://shared.test/auth/google/callback'});
  if(path==='/api/audit')return Response.json({events:[]});
  throw Error('Unexpected '+path);
 };
 w.eval(script);return{calls,state,accounts};
}
// A direct privileged URL must not fetch protected panels before identity is resolved.
let x=boot({defer:true});await until(()=>x.state.release);assert.deepEqual(x.calls.map(call=>call.path),['/api/account']);x.state.release();
await until(()=>w.document.body.textContent.includes('Awaiting admin activation')&&!button('Add Agent').disabled);
assert.equal(w.document.querySelectorAll('nav a').length,1);assert.equal(w.document.querySelector('nav a').getAttribute('aria-label'),'Agents');
assert.equal(w.document.querySelector('[aria-label="Sign-in settings"]'),null);assert.equal(w.document.querySelector('[aria-label="Account wake readiness"]'),null);
assert.deepEqual(x.calls.map(call=>call.path),['/api/account','/api/tool']);assert.equal(x.calls[1].body.name,'list_dots');
// Cancel leaves no registration; submission contains no destination or credentials.
click(button('Add Agent'));await until(()=>w.document.querySelector('#signup-handle'));input('#signup-handle','discarded');await pause();
assert.equal(w.document.querySelector('input[type=password]'),null);assert.equal(w.document.querySelector('[role=combobox]'),null);
click(button('Cancel'));await until(()=>!w.document.querySelector('[role=dialog]'));assert.equal(x.calls.some(call=>call.body?.name==='register_dot'),false);
click(button('Add Agent'));await until(()=>w.document.querySelector('#signup-handle'));assert.equal(w.document.querySelector('#signup-handle').value,'');input('#signup-handle','own_agent');await pause();
x.state.fail=true;click(button('Save Agent'));await until(()=>w.document.body.textContent.includes('That handle is already registered.'));assert.equal(w.document.querySelector('#signup-handle').value,'own_agent');assert.equal(button('Save Agent').disabled,false);
x.state.fail=false;click(button('Save Agent'));click(button('Save Agent'));await until(()=>!w.document.querySelector('[role=dialog]')&&w.document.querySelector('[aria-label="Edit @own_agent"]'));
assert.equal(x.calls.filter(call=>call.body?.name==='register_dot').length,2,'A failed attempt and one successful attempt; double click does not duplicate');assert.equal(button('Add Agent').disabled,true,'Only one agent can be created before activation');
click(w.document.querySelector('[aria-label="Edit @own_agent"]'));await until(()=>w.document.querySelector('#signup-handle'));input('#signup-handle','renamed_agent');click(w.document.querySelector('#signup-agent-type'));await pause();click(button('Save Agent'));await until(()=>w.document.querySelector('[aria-label="Edit @renamed_agent"]'));
assert.equal(x.state.agents[0].agent_type,'agent');assert.equal(x.calls.some(call=>call.body?.name==='list_discords'),false);
click(w.document.querySelector('[aria-label="Delete @renamed_agent"]'));await until(()=>w.document.querySelector('[role=alertdialog]'));click(button('Cancel'));await until(()=>!w.document.querySelector('[role=alertdialog]'));assert.equal(x.state.agents.length,1);
click(w.document.querySelector('[aria-label="Delete @renamed_agent"]'));await until(()=>w.document.querySelector('[role=alertdialog]'));click([...w.document.querySelectorAll('[role=alertdialog] button')].find(el=>el.textContent==='Delete'));await until(()=>x.state.agents.length===0&&!w.document.querySelector('[role=alertdialog]'));assert.equal(button('Add Agent').disabled,false);
assert.equal(x.calls.some(call=>!['/api/account','/api/tool'].includes(call.path)),false,'Pending flow calls only account and own agent APIs');
// Activation unlocks the original URL without requiring a fresh login.
x.state.status='active';click(button('Check activation'));await until(()=>x.calls.some(call=>call.path==='/api/tokens'));assert.equal(w.document.querySelectorAll('nav a').length,4);
// Revocation clears the former account, its agent, and every active-only panel.
x=boot({status:'active',tab:'agents',agents:[{dot_id:'old_agent',agent_type:'dot',is_owned:1,can_manage:1,webhook_configured:0,subscriptions:0,discord_id:''}]});await until(()=>button('@old_agent'));x.state.status='inactive';click(button('Refresh wake status'));await until(()=>w.document.body.textContent.includes('This account is inactive.'));
assert.equal(w.document.querySelectorAll('nav a').length,0);assert.equal(w.document.body.textContent.includes('@old_agent'),false);assert.equal(w.document.querySelector('[aria-label="Account wake readiness"]'),null);assert.equal(button('Add Agent'),undefined);
// Every account gets one accessible three-state group; owners stay locked active.
x=boot({status:'active',tab:'settings',owner:true});await until(()=>w.document.querySelectorAll('[role=radiogroup]').length===3);
for(const group of w.document.querySelectorAll('[role=radiogroup]'))assert.deepEqual([...group.querySelectorAll('input')].map(input=>input.value),['inactive','signed_up','active']);
for(const input of w.document.querySelector('[aria-label="Account status for owner@example.test"]').querySelectorAll('input'))assert.equal(input.disabled,true);
const member=status=>w.document.querySelector('[aria-label="'+status+' account member@example.test"]');assert.equal(member('Signed up').checked,true);
assert.deepEqual([...w.document.querySelector('#invite-account').options].map(option=>option.value),['','owner','active'],'Invitations show active accounts only');
click(member('Active'));await until(()=>member('Active').checked&&!member('Active').disabled);assert.deepEqual(x.calls.find(call=>call.path==='/api/accounts'&&call.method==='POST').body,{account_id:'member',status:'active'});
x.state.failAccount=true;click(member('Inactive'));await until(()=>w.document.body.textContent.includes('Account status save failed.'));assert.equal(member('Active').checked,true);assert.equal(member('Inactive').checked,false,'Rejected autosave retains the persisted status');
x.state.failAccount=false;click(member('Signed up'));await until(()=>member('Signed up').checked&&!member('Signed up').disabled);click(member('Inactive'));await until(()=>member('Inactive').checked&&!member('Inactive').disabled);
assert.equal(x.calls.filter(call=>call.path==='/api/accounts'&&call.method==='POST').length,4);assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
x=boot({status:'legacy',tab:'tokens'});await until(()=>x.calls.some(call=>call.path==='/api/tokens'));assert.equal(w.document.querySelectorAll('nav a').length,4,'Existing account responses without status stay compatible');
dom.window.close();console.log('PASS account status UI: pending-only agent create/edit/delete, conflict and cancel recovery, duplicate-submit guard, activation, revoked-state clearing, protected-route gating, owner-locked three-state radios, autosave failure recovery, active-only invitations and legacy compatibility. API mocked.');
