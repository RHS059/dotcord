import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync('client-build/index.html', 'utf8');
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const fakeSecret = 'a1B2_fake_test_receiver_only_1234567890';
let rows = [{id:'existing',name:'Existing integration',created:1791620000000,expires:'2099-01-01T00:00:00.000Z'}];
let dom, w, creates = 0, deletes = 0, copied = '', failCreate = false, failDelete = false;
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
   if(path==='/api/account')return Response.json(unauthorized?{error:'Sign in to continue.'}:{can_manage_accounts:false,auth_method:'google',host_linked:true},{status:unauthorized?401:200});
   if(path==='/api/tool')return Response.json(JSON.parse(options.body).name==='list_dots'?[{dot_id:'sample',is_owned:1,can_manage:1,discord_id:'one',webhook_configured:1},{dot_id:'other',is_owned:0,can_manage:1,discord_id:'one',webhook_configured:1}]:[]);
   assert.equal(path,'/api/receivers');
   assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
   if(unauthorized)return Response.json({error:'Sign in to continue.'},{status:401});
   if(options.method==='POST'){
     creates++;assert.deepEqual(JSON.parse(options.body),{name:'New integration',expires_in_days:30});
     if(failCreate)return Response.json({error:'Creation rejected.'},{status:400});
     await new Promise(r=>setTimeout(r,30));
     const receiver={id:'new',name:'New integration',created:1791620000000,expires:'2099-01-01T00:00:00.000Z'};rows=[receiver,...rows];return Response.json({receiver,secret:fakeSecret});
   }
   if(options.method==='DELETE'){
     deletes++;assert.deepEqual(JSON.parse(options.body),{id:'new'});
     if(failDelete)return Response.json({error:'Revoke rejected.'},{status:400});
     rows=rows.filter(t=>t.id!=='new');return Response.json({deleted:true});
   }
   return Response.json({receivers:rows});
 };
 w.eval(script);await until(()=>w.document.querySelector('h1')&&!w.document.body.textContent.includes('Loading…'));
}
await boot();
assert.ok(w.document.querySelector('[aria-label="Wake receiver credentials"]'));
assert.ok(w.document.body.textContent.includes('Expires'));assert.ok(w.document.body.textContent.includes(new Date('2099-01-01T00:00:00.000Z').toLocaleString()));
assert.ok(w.document.body.textContent.includes('••••••••'));
click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-name'));
assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('manage wake subscriptions for your account'));
assert.equal(w.document.querySelector('#receiver-expiry').value,'30');input('#receiver-name','New integration');await new Promise(r=>setTimeout(r,0));
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
await boot(true);assert.equal(w.document.querySelector('[aria-label="Wake receiver credentials"]'),null);
dom.window.close();console.log('PASS: receiver credential UI listing, expiry, one-time copy, failed create/revoke retry, duplicate-submit lock, secret disposal on close/navigation and outstanding responses. API mocked.');
