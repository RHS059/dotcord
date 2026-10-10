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
 calls.push(data);assert.equal(data.name,'edit_discord_message');return await post();
};
w.eval(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1]);
const el=s=>w.document.querySelector(s),buttons=()=>[...w.document.querySelectorAll('button')],btn=t=>buttons().find(b=>b.textContent.trim()===t);
async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout: '+w.document.body.textContent);}
const click=e=>{assert.ok(e);e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
async function input(s,v){const e=el(s);Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));}
const submit=()=>el('#message-body').closest('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
await until(()=>el('#message-agent')&&!el('#message-agent').disabled);
el('#message-mode').value='edit';el('#message-mode').dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>btn('Save edit'));
el('#message-agent').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await until(()=>el('[role=option]'));assert.equal(w.document.querySelectorAll('[role=option]').length,1,'Edit selector restricts agent ownership');click(el('[role=option]'));await until(()=>!el('[role=listbox]'));
await input('#message-body','Replacement @other');assert.ok(btn('Save edit').disabled);await input('#message-id','bad');assert.ok(btn('Save edit').disabled);assert.equal(calls.length,0);
await input('#message-id','345678901234567890');await input('#message-thread','456789012345678901');let resolve;post=()=>new Promise(r=>{resolve=r;});submit();submit();assert.equal(calls.length,1);await until(()=>btn('Updating…'));assert.ok(el('#message-mode').disabled);assert.deepEqual(calls[0].arguments,{dot_id:'sample',text:'Replacement @other',message_id:'345678901234567890',thread_id:'456789012345678901'});
resolve(Response.json({edited:true,message_id:'345678901234567890',wake_sent:false,url:'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890'}));await until(()=>el('#message-body').value==='');assert.ok(w.document.body.textContent.includes('Message updated. No wake sent.'));assert.equal(el('a[href*="discord.com/channels"]').textContent,'View in Discord');
await input('#message-body','Retained edit');post=()=>{throw Error('Network lost');};submit();await until(()=>btn('I checked Discord'));assert.equal(el('#message-body').value,'Retained edit');assert.ok(btn('Save edit').disabled);submit();assert.equal(calls.length,2);assert.ok(w.document.body.textContent.includes('Edit result is uncertain'));click(btn('I checked Discord'));await until(()=>!btn('Save edit').disabled);
post=()=>Response.json({sent:true});submit();await until(()=>btn('I checked Discord'));assert.equal(calls.length,3,'A send-shaped response does not falsely confirm an edit');click(btn('I checked Discord'));await until(()=>!btn('Save edit').disabled);
post=()=>Response.json({error:'Only the agent owner can edit.'},{status:403});submit();await until(()=>w.document.body.textContent.includes('Only the agent owner'));assert.equal(el('#message-body').value,'Retained edit');assert.ok(!btn('I checked Discord'));assert.equal(calls.length,4);
console.log('PASS: bundled edit composer ownership filter, ID validation, precise edit payload, duplicate guard, explicit edit success, retained failure drafts, no automatic retry. Network mocked.');dom.window.close();
