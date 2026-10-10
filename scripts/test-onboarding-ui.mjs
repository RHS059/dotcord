import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('client-build/index.html','utf8'),script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const invite='i'.repeat(43),wake='w'.repeat(43);
const until=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('Onboarding UI timed out');};
let dom;
function boot({signedIn=false,owner=false,fail=false,stored=false,conflict=false}={}){
 dom?.window.close();dom=new JSDOM(html,{url:'https://shared.test/'+(owner?'?tab=settings':stored?'':'#invite='+invite),runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 if(stored)w.sessionStorage.setItem('dotcord.pending-invitation',invite);
 const calls=[];
 w.fetch=async(path,options={})=>{
  calls.push({path,body:options.body?JSON.parse(options.body):null,method:options.method});
  if(path==='/api/auth/providers')return Response.json({google:true,chatgpt:true});
  if(path==='/api/account')return Response.json(signedIn?{can_manage_accounts:owner}:{error:'Sign in to continue.'},{status:signedIn?200:401});
  if(path==='/api/accounts')return Response.json({accounts:[{id:'account',email:'aella@example.test',enabled:1,role:'member'}]});
  if(path==='/api/tool'){const name=JSON.parse(options.body).name;return Response.json(name==='list_discords'?[{id:'shared',name:'Team',can_manage:1}]:[]);}
  if(path==='/api/onboarding'){
   assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.invite,invite);
   if(body.action==='preview')return Response.json(fail?{error:'Invitation belongs to another account.'}:{discord:{id:'shared',name:'Team'},suggested_handle:''},{status:fail?403:200});
   assert.deepEqual(body,{invite,action:'accept',dot_id:'chosen_name'});
   if(conflict)return Response.json({error:'That handle is already registered.'},{status:409});
   return Response.json(fail?{error:'Invitation belongs to another account.'}:{registered:true,dot_id:'chosen_name',secret:wake,token:{expires:'2099-01-01T00:00:00.000Z'},subscription_required:true},{status:fail?403:201});
  }
  if(path==='/api/invitations'){
   if(options.method==='POST'){assert.deepEqual(JSON.parse(options.body),{account_id:'account',discord_id:'shared'});return Response.json({url:'https://shared.test/#invite='+invite},{status:201});}
   if(options.method==='DELETE')return Response.json({revoked:true});
   return Response.json({invitations:[{id:'new-invite',email:'a***@e*****.test',dot:null,status:'pending',expires:'2099-01-01'}]});
  }
  throw Error('Unexpected '+path);
 };
 w.eval(script);return{w,calls};
}
const button=(w,t)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
const click=(w,b)=>{assert.ok(b);b.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
let x=boot();await until(()=>x.w.document.body.textContent.includes('Sign in with the account'));
assert.equal(x.w.location.hash,'');assert.equal(x.w.sessionStorage.getItem('dotcord.pending-invitation'),invite);assert.equal(x.calls.filter(c=>c.path==='/api/onboarding').length,0,'No redemption before sign-in');
x=boot({signedIn:true,stored:true});await until(()=>x.w.document.querySelector('#onboarding-handle'));
assert.equal(x.calls.filter(c=>c.path==='/api/onboarding'&&c.body.action==='accept').length,0,'Preview must not redeem invitation');
const handle=x.w.document.querySelector('#onboarding-handle');Object.getOwnPropertyDescriptor(x.w.HTMLInputElement.prototype,'value').set.call(handle,'chosen_name');handle.dispatchEvent(new x.w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));
click(x.w,button(x.w,'Join Dotcord'));await until(()=>x.w.document.querySelector('#onboarding-token'));
assert.equal(x.calls.filter(c=>c.path==='/api/onboarding'&&c.body.action==='accept').length,1);assert.equal(x.w.sessionStorage.length,0);assert.equal(x.w.localStorage.length,0);assert.equal(x.w.document.querySelector('#onboarding-token').value,wake);assert.ok(x.w.document.body.textContent.includes('subscribe to'));
click(x.w,button(x.w,'I saved my token'));await until(()=>!x.w.document.querySelector('#onboarding-token'));assert.equal(x.w.document.documentElement.outerHTML.includes(wake),false);
x=boot({signedIn:true,conflict:true});await until(()=>x.w.document.querySelector('#onboarding-handle'));
const conflicting=x.w.document.querySelector('#onboarding-handle');Object.getOwnPropertyDescriptor(x.w.HTMLInputElement.prototype,'value').set.call(conflicting,'chosen_name');conflicting.dispatchEvent(new x.w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));
click(x.w,button(x.w,'Join Dotcord'));await until(()=>x.w.document.body.textContent.includes('That handle is already registered.'));
assert.equal(x.w.document.querySelector('#onboarding-handle').value,'chosen_name');assert.equal(x.w.sessionStorage.getItem('dotcord.pending-invitation'),invite);assert.equal(x.w.document.querySelector('#onboarding-token'),null);assert.equal(button(x.w,'Join Dotcord').disabled,false);
x=boot({signedIn:true,fail:true});await until(()=>x.w.document.body.textContent.includes('Invitation belongs to another account.'));assert.equal(x.w.document.querySelector('#onboarding-token'),null);assert.equal(x.w.sessionStorage.getItem('dotcord.pending-invitation'),invite);
click(x.w,button(x.w,'Dismiss invitation'));await until(()=>x.w.sessionStorage.length===0);
x=boot({signedIn:true,owner:true});await until(()=>x.w.document.querySelector('#invite-account'));
for(const [id,value] of [['invite-account','account'],['invite-discord','shared']]){const el=x.w.document.getElementById(id);el.value=value;el.dispatchEvent(new x.w.Event('change',{bubbles:true}));}
assert.equal(x.w.document.getElementById('invite-handle'),null,'Recipient chooses handle, not administrator');await new Promise(r=>setTimeout(r,0));
click(x.w,button(x.w,'Create invitation'));await until(()=>x.w.document.querySelector('#invite-link'));
assert.equal(x.w.document.querySelector('#invite-link').value,'https://shared.test/#invite='+invite);assert.equal(x.w.localStorage.length,0);assert.equal(x.w.sessionStorage.length,0);
click(x.w,button(x.w,'Revoke invitation'));await until(()=>!x.w.document.querySelector('#invite-link'));assert.ok(x.calls.some(c=>c.path==='/api/invitations'&&c.method==='DELETE'));
dom.window.close();console.log('PASS onboarding UI: invitation fragment removal/sign-in persistence, preview then explicit recipient-selected handle redemption, one-time secret display/clearing, wrong-account recovery, owner creation/revocation. API mocked.');
