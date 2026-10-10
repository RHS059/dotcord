import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync('client-build/index.html', 'utf8');
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const fakeSecret = 'a1B2_fake_test_token_only_1234567890';
let rows = [{id:'existing',name:'Existing integration',prefix:'z9Y8',created:1791620000000,expires:'2099-01-01T00:00:00.000Z',can_revoke:true}];
let dom, w, creates = 0, deletes = 0, copied = '', failCreate = false, failDelete = false, expectedDot = '', adminMode = true;
async function until(fn) {for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Token UI condition timed out');}
const btn = text => [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const click = element => {assert.ok(element);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
function input(selector,value) {const element=w.document.querySelector(selector);assert.ok(element);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new w.Event('input',{bubbles:true}));}
async function boot(unauthorized=false) {
 dom?.window.close();dom = new JSDOM(html,{url:'https://relay.test/?tab=tokens',runScripts:'outside-only',pretendToBeVisual:true});w=dom.window;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.confirm=()=>true;
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
 w.fetch = async(path,options={})=>{
   if(path==='/api/account')return Response.json(unauthorized?{error:'Sign in to continue.'}:{can_manage_accounts:false},{status:unauthorized?401:200});
   if(path==='/api/tool')return Response.json(JSON.parse(options.body).name==='list_dots'?[{dot_id:'sample',is_owned:1,can_manage:1,discord_id:'one',webhook_configured:1},{dot_id:'other',is_owned:0,can_manage:1,discord_id:'one',webhook_configured:1}]:[]);
   assert.equal(path,'/api/tokens');
   assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
   if(unauthorized)return Response.json({error:'Sign in to continue.'},{status:401});
   if(options.method==='POST'){
     creates++;assert.deepEqual(JSON.parse(options.body),{name:'New integration',expires_in_days:30,...(expectedDot?{dot_id:expectedDot}:{})});
     if(failCreate)return Response.json({error:'Creation rejected.'},{status:400});
     await new Promise(r=>setTimeout(r,30));
     const token={dot:expectedDot||null,id:'new',name:'New integration',prefix:fakeSecret.slice(0,4),created:1791620000000,expires:'2099-01-01T00:00:00.000Z',can_revoke:true};rows=[token,...rows];return Response.json({token,secret:fakeSecret});
   }
   if(options.method==='DELETE'){
     deletes++;assert.deepEqual(JSON.parse(options.body),{id:'new'});
     if(failDelete)return Response.json({error:'Revoke rejected.'},{status:400});
     rows=rows.filter(t=>t.id!=='new');return Response.json({deleted:true});
   }
   return Response.json({tokens:rows.map(row=>({...row,can_revoke:adminMode}))});
 };
 w.eval(script);await until(()=>w.document.querySelector('h1')&&!w.document.body.textContent.includes('Loading…'));
}
await boot();
assert.equal(w.document.querySelector('h1').textContent,'Tokens');
assert.ok(w.document.body.textContent.includes('Expires'));assert.ok(w.document.body.textContent.includes(new Date('2099-01-01T00:00:00.000Z').toLocaleString()));
assert.ok(w.document.body.textContent.includes('z9Y8••••'));
click(w.document.querySelector('[aria-label="Copy client example"]'));await until(()=>copied.includes('dotcord_wake.py'));
assert.ok(copied.includes('--probe &&\n'));assert.ok(copied.includes('--recipient recipient'));assert.ok(w.document.querySelector('a[href="/clients/dotcord_wake.py"]'));assert.ok(w.document.body.textContent.includes('Callback acceptance'));assert.ok(!copied.includes('Authorization: Bearer'));assert.ok(!copied.includes('"sender"'));assert.ok(w.document.body.textContent.includes('saved token name identifies the sender'));assert.ok(copied.includes('"message_id":"unique-message-id"'));assert.ok(copied.includes('"recipients":["recipient"]'));assert.ok(copied.includes('"text":"project discussion thread"'));
click(btn('Create Token'));await until(()=>w.document.querySelector('#token-name'));
assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('cannot read messages'));
assert.equal(w.document.querySelector('#token-expiry').value,'30');input('#token-name','New integration');await new Promise(r=>setTimeout(r,0));
failCreate=true;click(w.document.querySelector('[role=dialog] button[type=submit]'));await until(()=>w.document.body.textContent.includes('Creation rejected.'));assert.equal(w.document.querySelector('#token-name').value,'New integration');
failCreate=false;const submit=w.document.querySelector('[role=dialog] button[type=submit]');click(submit);click(submit);
await until(()=>w.document.querySelector('#new-token-secret'));assert.equal(creates,2,'Only one additional successful request despite repeated submit');
assert.equal(w.document.querySelector('#new-token-secret').value,fakeSecret);assert.ok(w.document.querySelector('[role=dialog]').textContent.includes('Copy this because it won’t be shown again'));
click([...w.document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Copy'));await until(()=>copied===fakeSecret);
click(btn('Done'));await until(()=>!w.document.querySelector('[role=dialog]'));assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
click(btn('Create Token'));await until(()=>w.document.querySelector('#token-name'));assert.equal(w.document.querySelector('#token-name').value,'');assert.equal(w.document.querySelector('#new-token-secret'),null);click(btn('Cancel'));await until(()=>!w.document.querySelector('[role=dialog]'));
click(w.document.querySelector('[aria-label="Revoke token New integration"]'));await until(()=>btn('Revoke Token'));assert.ok(w.document.querySelector('[role=alertdialog]').textContent.includes('Other tokens remain active.'));click(btn('Cancel'));await until(()=>!w.document.querySelector('[role=alertdialog]'));assert.equal(deletes,0);
click(w.document.querySelector('[aria-label="Revoke token New integration"]'));await until(()=>btn('Revoke Token'));failDelete=true;click(btn('Revoke Token'));await until(()=>w.document.body.textContent.includes('Revoke rejected.'));assert.ok(w.document.querySelector('[role=alertdialog]'));failDelete=false;click(btn('Revoke Token'));await until(()=>!w.document.querySelector('[role=alertdialog]'));assert.ok(!w.document.querySelector('[aria-label="Revoke token New integration"]'));assert.ok(w.document.querySelector('[aria-label="Revoke token Existing integration"]'));
// Navigating Back while the one-time dialog is open must discard the displayed secret.
click(btn('Create Token'));await until(()=>w.document.querySelector('#token-name'));assert.equal(w.document.querySelector('#token-expiry').value,'30');input('#token-name','New integration');await new Promise(r=>setTimeout(r,0));click(w.document.querySelector('[role=dialog] button[type=submit]'));await until(()=>w.document.querySelector('#new-token-secret'));
w.history.pushState({},'','?tab=agents');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('h1').textContent==='Agents');assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));
w.history.pushState({},'','?tab=tokens');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('h1').textContent==='Tokens');assert.equal(w.document.querySelector('#new-token-secret'),null);
// An outstanding creation response must not restore a secret after its page unmounts.
rows=rows.filter(t=>t.id!=='new');await boot();click(btn('Create Token'));await until(()=>w.document.querySelector('#token-name'));assert.equal(w.document.querySelector('#token-expiry').value,'30');input('#token-name','New integration');await new Promise(r=>setTimeout(r,0));click(w.document.querySelector('[role=dialog] button[type=submit]'));
w.history.pushState({},'','?tab=agents');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('h1').textContent==='Agents');await new Promise(r=>setTimeout(r,60));assert.ok(!w.document.documentElement.outerHTML.includes(fakeSecret));
w.history.pushState({},'','?tab=tokens');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>w.document.querySelector('[aria-label="Revoke token New integration"]'));assert.equal(w.document.querySelector('#new-token-secret'),null);
// Scoped replacements retain the onboarding token's channel boundary; administrators cannot select others' handles.
rows=rows.filter(t=>t.id!=='new');await boot();click(btn('Create Token'));await until(()=>w.document.querySelector('#token-scope'));
assert.deepEqual([...w.document.querySelector('#token-scope').options].map(o=>o.value),['','sample']);assert.equal(w.document.querySelector('#token-scope').value,'');
expectedDot='sample';w.document.querySelector('#token-scope').value='sample';w.document.querySelector('#token-scope').dispatchEvent(new w.Event('change',{bubbles:true}));input('#token-name','New integration');await new Promise(r=>setTimeout(r,0));click(w.document.querySelector('[role=dialog] button[type=submit]'));await until(()=>w.document.querySelector('#new-token-secret'));click(btn('Done'));await until(()=>!w.document.querySelector('[role=dialog]'));assert.ok(w.document.querySelector('table').textContent.includes('@sample · same channel'));assert.ok(w.document.querySelector('table').textContent.includes('All recipients'));expectedDot='';
adminMode=false;await boot();assert.equal(w.document.querySelector('[aria-label^="Revoke token"]'),null);
await boot(true);await until(()=>w.document.querySelector('a[href="/signin-with-chatgpt?return_to=%2F"]'));assert.ok(btn('Create Token').disabled);
dom.window.close();console.log('PASS: token UI listing, first-four masking, create failure/retry, duplicate-submit lock, one-time copy, close/reopen clearing, revoke cancel/failure/retry, other-token preservation, history navigation and in-flight response secret clearing, client download and safe example copy, and unauthenticated sign-in link. API mocked.');
