import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync('client-build/index.html', 'utf8');
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const fakeSecret = 'a1B2_fake_test_receiver_only_1234567890';
let rows = [{id:'existing',name:'Existing integration',created:1791620000000,expires:'2099-01-01T00:00:00.000Z',recipient:{email:'member@example.test',is_self:true},can_revoke:true}];
let dom, w, creates = 0, deletes = 0, copied = '', failCreate = false, failDelete = false, ownerMode = true, selectedAccount = '';
async function until(fn) {for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Receiver UI condition timed out');}
const btn = text => [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const click = element => {assert.ok(element);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
function input(selector,value) {const element=w.document.querySelector(selector);assert.ok(element);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new w.Event('input',{bubbles:true}));}
async function boot(unauthorized=false) {
 dom?.window.close();dom = new JSDOM(html,{url:'https://relay.test/?tab=settings',runScripts:'outside-only',pretendToBeVisual:true});w=dom.window;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.confirm=()=>true;
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
 w.fetch = async(path,options={})=>{
   if(path==='/api/auth/providers')return Response.json({google:false,chatgpt:true});
   if(path==='/api/account')return Response.json(unauthorized?{error:'Sign in to continue.'}:{can_manage_accounts:ownerMode,auth_method:'google',host_linked:true},{status:unauthorized?401:200});
   if(path==='/api/tool')return Response.json(JSON.parse(options.body).name==='list_dots'?[{dot_id:'sample',is_owned:1,can_manage:1,discord_id:'one',webhook_configured:1},{dot_id:'other',is_owned:0,can_manage:1,discord_id:'one',webhook_configured:1}]:[]);
   if(path==='/api/accounts')return Response.json({accounts:[{id:'target',email:'recipient@example.test',role:'member',enabled:1,receiver_eligible:true},{id:'disabled',email:'disabled@example.test',role:'member',enabled:0,receiver_eligible:false},{id:'new',email:'new@example.test',role:'member',enabled:1,receiver_eligible:false}]});
   assert.equal(path,'/api/receivers');
   assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
   if(unauthorized)return Response.json({error:'Sign in to continue.'},{status:401});
   if(options.method==='POST'){
     creates++;assert.deepEqual(JSON.parse(options.body),{name:'New integration',expires_in_days:30,...(selectedAccount?{account_id:selectedAccount}:{})});
     if(failCreate)return Response.json({error:'Creation rejected.'},{status:400});
     await new Promise(r=>setTimeout(r,30));
     const receiver={id:'new',name:'New integration',created:1791620000000,expires:'2099-01-01T00:00:00.000Z',recipient:{email:selectedAccount?'recipient@example.test':'member@example.test',is_self:!selectedAccount},can_revoke:ownerMode};rows=[receiver,...rows];return Response.json({receiver,secret:fakeSecret,recipient:{email:selectedAccount?'recipient@example.test':'member@example.test',is_self:!selectedAccount}});
   }
   if(options.method==='DELETE'){
     deletes++;assert.deepEqual(JSON.parse(options.body),{id:'new'});
     if(failDelete)return Response.json({error:'Revoke rejected.'},{status:400});
     rows=rows.filter(t=>t.id!=='new');return Response.json({deleted:true});
   }
   return Response.json({receivers:rows.map(row=>({...row,can_revoke:ownerMode}))});
 };
 w.eval(script);await until(()=>w.document.querySelector('h1')&&!w.document.body.textContent.includes('Loading…'));
}
await boot();
assert.ok(w.document.querySelector('[aria-label="Wake receiver credentials"]'));
assert.ok(w.document.body.textContent.includes('Expires'));assert.ok(w.document.body.textContent.includes(new Date('2099-01-01T00:00:00.000Z').toLocaleString()));
assert.ok(w.document.body.textContent.includes('••••••••'));
click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-name'));
assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('Choose the account whose wake subscriptions'));
assert.ok(w.document.querySelector('#receiver-recipient'));assert.equal(w.document.querySelector('#receiver-expiry').value,'30');input('#receiver-name','New integration');await new Promise(r=>setTimeout(r,0));
failCreate=true;click(w.document.querySelector('[role=dialog] button[type=submit]'));await until(()=>w.document.body.textContent.includes('Creation rejected.'));assert.equal(w.document.querySelector('#receiver-name').value,'New integration');
failCreate=false;const submit=w.document.querySelector('[role=dialog] button[type=submit]');click(submit);click(submit);
await until(()=>w.document.querySelector('#new-receiver-secret'));assert.equal(creates,2,'Only one additional successful request despite repeated submit');
assert.equal(w.document.querySelector('#new-receiver-secret').value,fakeSecret);assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('Copy this because it won’t be shown again'));
click([...w.document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Copy'));await until(()=>copied===fakeSecret);
click(btn('Done'));await until(()=>!w.document.querySelector('[role=dialog]'));assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-name'));assert.equal(w.document.querySelector('#receiver-name').value,'');assert.equal(w.document.querySelector('#new-receiver-secret'),null);click(btn('Cancel'));await until(()=>!w.document.querySelector('[role=dialog]'));
click(w.document.querySelector('[aria-label="Revoke receiver New integration"]'));await until(()=>btn('Revoke Credential'));assert.ok(w.document.querySelector('[role=alertdialog]').textContent.includes('stop receiving new deliveries'));click(btn('Cancel'));await until(()=>!w.document.querySelector('[role=alertdialog]'));assert.equal(deletes,0);
click(w.document.querySelector('[aria-label="Revoke receiver New integration"]'));await until(()=>btn('Revoke Credential'));failDelete=true;click(btn('Revoke Credential'));await until(()=>w.document.body.textContent.includes('Revoke rejected.'));assert.ok(w.document.querySelector('[role=alertdialog]'));failDelete=false;click(btn('Revoke Credential'));await until(()=>!w.document.querySelector('[role=alertdialog]'));assert.ok(!w.document.querySelector('[aria-label="Revoke receiver New integration"]'));assert.ok(w.document.querySelector('[aria-label="Revoke receiver Existing integration"]'));
// Navigating Back while the one-time dialog is open must discard the displayed secret.
click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-name'));assert.equal(w.document.querySelector('#receiver-expiry').value,'30');input('#receiver-name','New integration');await new Promise(r=>setTimeout(r,0));click(w.document.querySelector('[role=dialog] button[type=submit]'));await until(()=>w.document.querySelector('#new-receiver-secret'));
w.history.pushState({},'','?tab=agents');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('h1').textContent==='Agents');assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));
w.history.pushState({},'','?tab=settings');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>!!w.document.querySelector('[aria-label="Wake receiver credentials"]'));assert.equal(w.document.querySelector('#new-receiver-secret'),null);
// An outstanding creation response must not restore a secret after its page unmounts.
rows=rows.filter(t=>t.id!=='new');await boot();click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-name'));assert.equal(w.document.querySelector('#receiver-expiry').value,'30');input('#receiver-name','New integration');await new Promise(r=>setTimeout(r,0));click(w.document.querySelector('[role=dialog] button[type=submit]'));
w.history.pushState({},'','?tab=agents');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('h1').textContent==='Agents');await new Promise(r=>setTimeout(r,60));assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));
w.history.pushState({},'','?tab=settings');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('[aria-label="Revoke receiver New integration"]'));assert.equal(w.document.querySelector('#new-receiver-secret'),null);
// The admin sees newly created recipient metadata immediately and after reload, without revoke authority.
rows=rows.filter(t=>t.id!=='new');ownerMode=true;await boot();click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-recipient'));
const selector=w.document.querySelector('#receiver-recipient');assert.equal(selector.value,'');assert.equal(selector.options.length,2);assert.ok(selector.options[0].textContent.includes('Your signed-in account'));
selector.value='target';selectedAccount='target';selector.dispatchEvent(new w.Event('change',{bubbles:true}));input('#receiver-name','New integration');await new Promise(r=>setTimeout(r,0));click(w.document.querySelector('[role=dialog] button[type=submit]'));await until(()=>w.document.querySelector('#new-receiver-secret'));
assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('Recipient: recipient@example.test'));assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('appears in this admin list'));click(btn('Done'));await until(()=>!w.document.querySelector('[role=dialog]'));assert.ok(w.document.querySelector('[aria-label="Revoke receiver New integration"]'));
const receiverSection=()=>w.document.querySelector('[aria-label="Wake receiver credentials"]');
assert.ok(receiverSection().textContent.includes('New integration'));assert.ok(receiverSection().textContent.includes('recipient@example.test'));assert.ok(receiverSection().textContent.includes('This admin list'));
assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));
await boot();assert.ok(receiverSection().textContent.includes('New integration'));assert.ok(receiverSection().textContent.includes('recipient@example.test'));assert.ok(w.document.querySelector('[aria-label="Revoke receiver New integration"]'));
click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-recipient'));assert.equal(w.document.querySelector('#receiver-recipient').value,'');click(btn('Cancel'));selectedAccount='';ownerMode=false;
await boot();assert.equal(w.document.querySelector('[aria-label="Revoke receiver Existing integration"]'),null);assert.equal(w.document.querySelector('[aria-label="Revoke receiver New integration"]'),null);
await boot(true);assert.equal(w.document.querySelector('[aria-label="Wake receiver credentials"]'),null);
dom.window.close();console.log('PASS: receiver credential UI listing, expiry, one-time copy, failed create/revoke retry, duplicate-submit lock, secret disposal on close/navigation and outstanding responses. API mocked.');
