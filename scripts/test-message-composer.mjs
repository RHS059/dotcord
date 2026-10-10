import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('client-build/index.html','utf8');
const dom=new JSDOM(html,{url:'https://dotcord.test/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
const calls=[];let post=()=>Response.json({sent:true,url:'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',mention_delivery:{results:[{status:'accepted'}]}});
w.fetch=async(url,opts)=>{
 if(url==='/api/account')return Response.json({can_manage_accounts:false});
 const data=JSON.parse(opts.body);
 if(data.name==='list_dots')return Response.json([{dot_id:'sample',discord_id:'one',webhook_configured:1,can_manage:1},{dot_id:'other',discord_id:'one',webhook_configured:1,can_manage:0}]);
 if(data.name==='list_discords')return Response.json([{id:'one',name:'Team Discord',bot_configured:1}]);
 calls.push(data);assert.equal(data.name,'post_to_discord');return await post();
};
w.eval(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1]);
const el=s=>w.document.querySelector(s),buttons=()=>[...w.document.querySelectorAll('button')],btn=t=>buttons().find(b=>b.textContent.trim()===t);
async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout: '+w.document.body.textContent);}
const click=e=>{assert.ok(e);e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
async function input(s,v){const e=el(s);Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));}
const submit=()=>el('#message-body').closest('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
await until(()=>el('#message-agent')&&!el('#message-agent').disabled);assert.ok(btn('Send').disabled);
el('#message-agent').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await until(()=>el('[role=option]'));assert.equal(w.document.querySelectorAll('[role=option]').length,2,'Selector does not invent additional account restrictions');click([...w.document.querySelectorAll('[role=option]')].find(e=>e.textContent==='@sample'));await until(()=>!el('[role=listbox]'));
await input('#message-body','   ');assert.ok(btn('Send').disabled);
await input('#message-body','Hello @other');await input('#message-thread','bad');assert.ok(btn('Send').disabled);assert.equal(calls.length,0);
await input('#message-thread','');let resolve;post=()=>new Promise(r=>{resolve=r;});submit();submit();assert.equal(calls.length,1,'Synchronous submits make one request');await until(()=>btn('Sending…'));assert.ok(btn('Sending…').disabled);
click([...w.document.querySelectorAll('nav a')].find(a=>a.textContent==='Discord'));await until(()=>el('h1').textContent==='Discord');
click([...w.document.querySelectorAll('nav a')].find(a=>a.textContent==='Agents'));await until(()=>el('h1').textContent==='Agents');
assert.equal(el('#message-body').value,'Hello @other');assert.ok(btn('Sending…').disabled);submit();assert.equal(calls.length,1,'Tab navigation retains pending-send guard');
const unload=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(unload);assert.ok(unload.defaultPrevented,'Pending draft warns before unload');
assert.equal(calls[0].arguments.thread_id,undefined);resolve(Response.json({sent:true,url:'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',mention_delivery:{results:[]}}));await until(()=>el('#message-body').value==='');assert.ok(w.document.body.textContent.includes('Message sent.'));assert.equal(el('a[href*="discord.com/channels"]').textContent,'View in Discord');assert.ok(btn('Send').disabled);
await input('#message-body','Thread reply');await input('#message-thread','456789012345678901');post=()=>Response.json({sent:true,mention_delivery:{error:'Post sent to a different Discord channel. Do not repost.'}});submit();await until(()=>el('#message-body').value==='');assert.equal(calls[1].arguments.thread_id,'456789012345678901');assert.ok(w.document.body.textContent.includes('Message sent.'));assert.ok(w.document.body.textContent.includes('different Discord channel'));assert.ok(!btn('I checked Discord'));
await input('#message-body','Keep this draft');post=()=>{throw Error('Network lost');};submit();await until(()=>btn('I checked Discord'));assert.equal(el('#message-body').value,'Keep this draft');assert.ok(btn('Send').disabled);submit();assert.equal(calls.length,3);click(btn('I checked Discord'));await until(()=>!btn('Send').disabled);
post=()=>new Response('invalid-json');submit();await until(()=>btn('I checked Discord'));assert.equal(calls.length,4);assert.equal(el('#message-body').value,'Keep this draft');click(btn('I checked Discord'));await until(()=>!btn('Send').disabled);
post=()=>Response.json({error:'Discord did not confirm the post (HTTP 429). Check the channel before retrying.'},{status:400});submit();await until(()=>btn('I checked Discord'));assert.equal(calls.length,5);click(btn('I checked Discord'));await until(()=>!btn('Send').disabled);
post=()=>Response.json({error:'Register this handle with the connected account first.'},{status:403});submit();await until(()=>w.document.body.textContent.includes('Register this handle'));assert.ok(!btn('I checked Discord'));assert.equal(el('#message-body').value,'Keep this draft');assert.equal(calls.length,6);
assert.ok(!JSON.stringify(calls).includes('webhook'));assert.ok(!el('#composer-title').parentElement.innerHTML.includes('/api/webhooks/')); assert.equal(el('#message-body').maxLength,2000);
console.log('PASS: bundled composer validation, all-name selector, exact shared API and optional thread payload, duplicate-submit lock, sent/warning states, retained uncertain/error drafts, manual uncertainty acknowledgement, no automatic retries or exposed webhook. Network mocked.');dom.window.close();
