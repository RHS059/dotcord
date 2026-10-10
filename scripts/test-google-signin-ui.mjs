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
  linkFails=false;click(button('Link ChatGPT account'));await until(()=>w.document.body.textContent.includes('ChatGPT account linked.'));assert.equal(button('Link ChatGPT account').disabled,true);
  click(button('Sign out of Google'));await until(()=>w.document.body.textContent.includes('Sign-out unavailable.'));assert.equal(button('Sign out of Google').disabled,false);
  assert.equal(calls.filter(c=>c.path==='/auth/logout').length,1,'Sign-out failure does not retry automatically');
 }
 dom.window.close();
}
console.log('PASS sign-in settings: provider-specific controls, explicit linking, failure recovery, sign-out request. API mocked.');
