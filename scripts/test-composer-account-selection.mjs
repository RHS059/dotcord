import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('client-build/index.html','utf8'),script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
for(const scenario of ['member','primary','admin','no-agent','ambiguous']){
 const dom=new JSDOM(html,{url:'https://relay.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout '+scenario);};
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
 const agents=[{dot_id:'shared_agent',is_owned:0},{dot_id:'owned_agent',is_owned:1},...(['primary','ambiguous'].includes(scenario)?[{dot_id:'other_owned',is_owned:1}]:[])].filter(a=>scenario!=='no-agent'||!a.is_owned).map(a=>({...a,can_manage:scenario==='admin'||a.is_owned,discord_id:'shared',webhook_configured:1,agent_type:'dot'}));
 w.fetch=async(path,options={})=>{
  if(path==='/api/account')return Response.json({can_manage_accounts:scenario==='admin',profile:{dot_id:scenario==='primary'?'other_owned':null,selection_required:false},wake:{state:'not_subscribed',active_subscriptions:0,account_subscriptions:0,refresh_before:null,account_binding:'test',subscription_required:true}});
  if(path==='/api/accounts')return Response.json({accounts:[]});
  const data=JSON.parse(options.body);if(data.name==='list_dots')return Response.json(agents);if(data.name==='list_discords')return Response.json([{id:'shared',name:'Team'}]);
  calls.push(data);return Response.json({sent:true,mention_delivery:{results:[]}});
 };
 w.eval(script);await until(()=>w.document.querySelector('#message-body')&&!w.document.body.textContent.includes('Loading…'));
 const field=w.document.querySelector('#message-body'),form=field.closest('form'),send=()=>[...form.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send');
 Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(field,'hello');field.dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,10));
 if(scenario==='admin'){
  const selector=w.document.querySelector('#message-agent');assert.ok(selector);assert.ok(selector.textContent.includes('Select your agent'));assert.equal(send().disabled,true,'Admin starts with no selection');
  selector.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await until(()=>w.document.querySelector('[role=option]'));
  [...w.document.querySelectorAll('[role=option]')].find(e=>e.textContent==='@shared_agent').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await until(()=>!send().disabled);
 }else{assert.equal(w.document.querySelector('#message-agent'),null);assert.equal(form.textContent.includes('Agent name'),false);}
 if(['no-agent','ambiguous'].includes(scenario)){assert.equal(send().disabled,true);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(calls.length,0);}
 else{await until(()=>!send().disabled);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>calls.length===1);assert.equal(calls[0].arguments.dot_id,scenario==='admin'?'shared_agent':scenario==='primary'?'other_owned':'owned_agent');}
 dom.window.close();
}
console.log('PASS account selection: member auto-owned agent even with foreign first, primary precedence, hidden member field, admin blank/manual choice, no foreign fallback for missing/ambiguous accounts. Network mocked.');
