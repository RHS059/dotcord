import {seedActiveAccounts} from './helpers/accounts.mjs';
import {JSDOM} from 'jsdom';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
const DB={async batch(items){sql.exec('BEGIN');try{const r=[];for(const i of items)r.push(await i.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}},prepare(q){return {bind(...a){return {first:async()=>sql.prepare(q).get(...a)||null,all:async()=>({results:sql.prepare(q).all(...a)}),run:async()=>sql.prepare(q).run(...a)}}}}};
const env={DB,AUTHORIZED_ACCOUNTS:JSON.stringify([{email:'owner@example.test',role:'owner'},{email:'member@example.test',role:'member'}])};
seedActiveAccounts(sql,env);
async function request(path,opts={}){return worker.fetch(new Request('https://relay.test'+path,{...opts,headers:{'content-type':'application/json',origin:'https://relay.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}}),env);}
async function api(name,args={}){const r=await request('/api/tool',{method:'POST',body:JSON.stringify({name,arguments:args})});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;}
const first=await api('add_discord',{name:'First',channel_url:'https://discord.com/channels/123456789012345678/234567890123456789',bot_token:'test_bot_token_1234567890'});
const second=await api('add_discord',{name:'Second',channel_url:'https://discord.com/channels/123456789012345678/334567890123456789',bot_token:'other_bot_token_1234567890'});
await api('register_dot',{dot_id:'sample',discord_id:first.id});

const html=readFileSync('client-build/index.html','utf8'),script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
let dom,w;
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout: '+w.document.body.textContent);}
const btn=t=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
function click(e){assert.ok(e);e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));}
function input(selector,value){const e=w.document.querySelector(selector);assert.ok(e);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new w.Event('input',{bubbles:true}));}
async function reload(tab='agents'){dom?.window.close();dom=new JSDOM(html,{url:'https://relay.test/?tab='+tab,runScripts:'outside-only',pretendToBeVisual:true});w=dom.window;w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.confirm=()=>true;w.FormData=class{constructor(form){this.p=[...form.elements].filter(e=>e.name).map(e=>[e.name,e.value]);}*[Symbol.iterator](){yield* this.p;}};w.fetch=request;w.eval(script);await until(()=>w.document.querySelector('h1')&&!w.document.body.textContent.includes('Loading…')&&(tab!=='settings'||w.document.querySelectorAll('[role=radiogroup]').length===2)&&(tab==='discord'?btn('Add Discord')&&!btn('Add Discord').disabled:tab==='agents'?btn('Add Agent')&&!btn('Add Agent').disabled:true));}
async function choose(selector,label){const e=w.document.querySelector(selector);assert.ok(e);e.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await until(()=>w.document.querySelector('[role=option]'));click([...w.document.querySelectorAll('[role=option]')].find(e=>e.textContent===label));await until(()=>!w.document.querySelector('[role=listbox]'));}
async function replace(label,value,save='Save Discord'){click(w.document.querySelector('[aria-label="'+label+'"]'));await until(()=>w.document.querySelector('#replacement-value'));if(!label.startsWith('Edit name'))assert.equal(w.document.querySelector('#replacement-value').value,'');input('#replacement-value',value);await new Promise(r=>setTimeout(r,0));click(btn(save));await until(()=>!w.document.querySelector('[role=dialog]'));}
const hook='https://discord.com/api/webhooks/123456789012345678/'+'x'.repeat(60);

await reload();
assert.equal(w.document.querySelector('[aria-label="Agent type for @sample"]').value,'dot');
{const provider=w.document.querySelector('[aria-label="Agent type for @sample"]');provider.value='grokbot';provider.dispatchEvent(new w.Event('change',{bubbles:true}));}await until(()=>btn('Save Agent'));click(btn('Save Agent'));await until(()=>!btn('Save Agent'));
await reload();assert.equal(w.document.querySelector('[aria-label="Agent type for @sample"]').value,'grokbot');
await reload('settings');click(btn('Create Credential'));await until(()=>w.document.querySelector('#receiver-agent'));
assert.equal(w.document.querySelector('[role="dialog"] input[type="radio"]'),null,'Credentials have no independent provider selector');
const select=w.document.querySelector('#receiver-agent');select.value='sample';select.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('#grokbot-auth-token'));
assert.equal(w.document.querySelector('#grokbot-webhook').type,'password');assert.equal(w.document.querySelector('#grokbot-auth-token').type,'password');assert.equal(w.document.querySelector('#grokbot-source').type,'text');
input('#receiver-name','Grok config');input('#grokbot-webhook','https://grok.example.com/private-hook');input('#grokbot-auth-token','synthetic-grok-secret');input('#grokbot-auth-header','X-Grok-Auth');input('#grokbot-source','dotcord');await new Promise(r=>setTimeout(r,0));
w.document.querySelector('[role="dialog"] form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('[role="dialog"]'));
let row=sql.prepare("SELECT * FROM receiver_credentials WHERE dot_id='sample'").get();assert.equal(row.provider,'grokbot');assert.equal(row.auth_token,'synthetic-grok-secret');assert.equal(row.source,'dotcord');
await reload('settings');assert.ok(w.document.querySelector('[aria-label="Edit receiver Grok config"]'));assert.equal(w.document.documentElement.outerHTML.includes(row.auth_token),false);assert.equal(w.document.documentElement.outerHTML.includes(row.webhook_url),false);
click(w.document.querySelector('[aria-label="Edit receiver Grok config"]'));await until(()=>w.document.querySelector('#grokbot-auth-token'));
assert.equal(w.document.querySelector('#grokbot-auth-token').value,'');assert.equal(w.document.querySelector('#grokbot-webhook').value,'');assert.equal(w.document.querySelector('#grokbot-source').value,'dotcord');assert.equal(w.document.querySelector('#grokbot-auth-header').value,'X-Grok-Auth');
input('#grokbot-source','edited source');await new Promise(r=>setTimeout(r,0));click(btn('Save Credential'));await until(()=>!w.document.querySelector('[role="dialog"]'));
await reload('settings');click(w.document.querySelector('[aria-label="Edit receiver Grok config"]'));await until(()=>w.document.querySelector('#grokbot-source'));assert.equal(w.document.querySelector('#grokbot-source').value,'edited source');assert.equal(sql.prepare("SELECT auth_token FROM receiver_credentials WHERE dot_id='sample'").get().auth_token,row.auth_token);
click(btn('Cancel'));await until(()=>!w.document.querySelector('[role="dialog"]'));await reload();{const provider=w.document.querySelector('[aria-label="Agent type for @sample"]');provider.value='dot';provider.dispatchEvent(new w.Event('change',{bubbles:true}));}await until(()=>btn('Save Agent'));click(btn('Save Agent'));await until(()=>!btn('Save Agent'));
await reload('settings');click(w.document.querySelector('[aria-label="Edit receiver Grok config"]'));await until(()=>w.document.querySelector('#receiver-name'));assert.equal(w.document.querySelector('#grokbot-auth-token'),null);assert.equal(w.document.querySelector('[role="dialog"] input[type="radio"]'),null);
click(btn('Save Credential'));await until(()=>w.document.querySelector('#new-receiver-secret'));assert.match(w.document.querySelector('#new-receiver-secret').value,/^dcr_/);assert.equal(sql.prepare("SELECT provider FROM receiver_credentials WHERE dot_id='sample'").get().provider,'dot');
assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);dom.window.close();sql.close();console.log('PASS real bundled UI → Worker → SQLite: agent-only type chips persist, Grok fields inherit agent, credential create/edit/reload, no secret readback, blank secret retention, source edit, switching back to Dot issues native pairing credential. No external requests.');
