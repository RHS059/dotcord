import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('client-build/index.html','utf8'),script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const until=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('Sign-in UI timed out');};
for(const available of [true,false,'error']){
 const dom=new JSDOM(html,{url:'https://shared.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let providerCalls=0;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 w.fetch=async path=>{
  if(path==='/api/auth/providers'){providerCalls++;if(available==='error')throw Error('Offline');return Response.json({google:available,chatgpt:true});}
  return Response.json({error:'Sign in to Dotcord to continue.'},{status:401});
 };
 w.eval(script);await until(()=>providerCalls>0&&w.document.querySelector('a[href^="/signin-with-chatgpt"]'));await new Promise(r=>setTimeout(r,20));
 const google=w.document.querySelector('a[href="/auth/google/start"]');assert.equal(!!google,available===true,'Only offer Google when server configuration enables it');
 if(google){assert.equal(google.textContent,'Continue with Google');assert.equal(google.target,'_top');}
 const chatgpt=w.document.querySelector('a[href^="/signin-with-chatgpt"]');assert.equal(chatgpt.getAttribute('href'),'/signin-with-chatgpt?return_to=%2F');assert.equal(chatgpt.target,'_top');
 assert.ok([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Clear Google sign-in'),'Expired session recovery remains available when Google is unconfigured');
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);dom.window.close();
}
console.log('PASS Google sign-in UI: configured provider link, unavailable/network-error fallback, retained ChatGPT access. API mocked.');
for(const authMethod of ['google','host']){
 const dom=new JSDOM(html,{url:'https://shared.test/?tab=settings',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];let linkFails=true;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 w.fetch=async(path,options={})=>{
  calls.push({path,options});
  if(path==='/api/auth/providers')return Response.json({google:true,chatgpt:true});
  if(path==='/api/account')return Response.json({can_manage_accounts:false,auth_method:authMethod});
  if(path==='/api/tool')return Response.json([]);
  if(path==='/api/auth/link-host'){assert.equal(options.method,'POST');assert.equal(options.body,'{}');return Response.json(linkFails?{error:'Sign in with the same email first.'}:{linked:true},{status:linkFails?403:200});}
  if(path==='/auth/logout'){assert.equal(options.method,'POST');return Response.json({error:'Sign-out unavailable.'},{status:503});}
  throw Error('Unexpected '+path);
 };
 const button=t=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),click=b=>{assert.ok(b);b.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
 w.eval(script);await until(()=>w.document.querySelector('[aria-label="Sign-in settings"]'));
 if(authMethod==='host'){
  await until(()=>w.document.querySelector('a[href="/auth/google/start"]'));
  assert.equal(button('Link ChatGPT account'),undefined);assert.equal(button('Sign out of Google'),undefined);
 }else{
  assert.ok(w.document.querySelector('a[href="/signin-with-chatgpt?return_to=%2F%3Ftab%3Dsettings"]'));
  click(button('Link ChatGPT account'));await until(()=>w.document.body.textContent.includes('Sign in with the same email first.'));
  assert.equal(calls.filter(c=>c.path==='/api/auth/link-host').length,1,'Link failure does not retry automatically');
  linkFails=false;click(button('Link ChatGPT account'));await until(()=>w.document.body.textContent.includes('ChatGPT account linked.'));assert.equal(button('Link ChatGPT account'),undefined);
  click(button('Sign out of Google'));await until(()=>w.document.body.textContent.includes('Sign-out unavailable.'));assert.equal(button('Sign out of Google').disabled,false);
  assert.equal(calls.filter(c=>c.path==='/auth/logout').length,1,'Sign-out failure does not retry automatically');
 }
 dom.window.close();
}
console.log('PASS sign-in settings: provider-specific controls, explicit linking, failure recovery, sign-out request. API mocked.');

for(const owner of [false,true]){
 const dom=new JSDOM(html,{url:'https://shared.test/?tab=settings',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];let saved=false,fail=false;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 const configuration=()=>({configured:saved,source:saved?'database':'none',client_id:saved?'client.apps.googleusercontent.com':'',has_secret:saved,redirect_uri:'https://shared.test/auth/google/callback'});
 w.fetch=async(path,options={})=>{
  calls.push({path,options});
  if(path==='/api/account')return Response.json({can_manage_accounts:owner,auth_method:owner?'host':'google',host_linked:true});
  if(path==='/api/tool')return Response.json([]);
  if(path==='/api/accounts')return Response.json({accounts:[]});
  if(path==='/api/auth/providers')return Response.json({google:saved,chatgpt:true});
  if(path==='/api/auth/google-settings'){
   assert.ok(owner,'Members must not request provider settings');
   if(options.method==='POST'){
    const body=JSON.parse(options.body);assert.equal(body.client_id,'client.apps.googleusercontent.com');
    if(fail)return Response.json({error:'Unable to save settings.'},{status:503});
    assert.equal(body.client_secret,saved?'':'synthetic-secret');saved=true;
   }
   return Response.json(configuration());
  }
  if(path==='/api/audit')return Response.json({events:[]});
  if(path==='/api/invitations')return Response.json({invitations:[]});
  if(path==='/api/tokens')return Response.json({tokens:[]});
  return Response.json([]);
 };
 const button=t=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
 w.eval(script);await until(()=>w.document.querySelector('[aria-label="Sign-in settings"]'));
 assert.equal(button('Link ChatGPT account'),undefined,'Already linked identities do not prompt again');
 if(owner){
  await until(()=>w.document.querySelector('input[name="google-client-id"]'));
  const input=name=>w.document.querySelector('input[name="'+name+'"]');
  const change=(name,value)=>{const el=input(name);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  assert.ok(w.document.body.textContent.includes('https://shared.test/auth/google/callback'));
  assert.equal(input('google-client-secret').type,'password');
  change('google-client-id','client.apps.googleusercontent.com');change('google-client-secret','synthetic-secret');
  w.document.querySelector('[aria-label="Google sign-in setup"] form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>w.document.body.textContent.includes('Google credentials saved.'));
  assert.equal(input('google-client-secret').value,'');
  assert.equal(w.document.body.textContent.includes('synthetic-secret'),false);
  w.document.querySelector('[aria-label="Google sign-in setup"] form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>calls.filter(c=>c.path==='/api/auth/google-settings'&&c.options.method==='POST').length===2&&!button('Save Google sign-in').disabled);
  await new Promise(r=>setTimeout(r,30));fail=true;change('google-client-secret','failed-secret');
  await new Promise(r=>setTimeout(r,10));
  w.document.querySelector('[aria-label="Google sign-in setup"] form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>w.document.body.textContent.includes('Unable to save settings.'));
  assert.equal(input('google-client-secret').value,'','Failed submission clears secret too');
 }else{
  assert.equal(w.document.querySelector('[aria-label="Google sign-in setup"]'),null);
  assert.equal(calls.some(c=>c.path==='/api/auth/google-settings'),false);
 }
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);dom.window.close();
}
console.log('PASS Google setup UI: owner-only panel, masked write-only secret, secret clearing on success/failure, blank retention, no browser storage, linked-account controls. API mocked.');
