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
sql.prepare('UPDATE dots SET discord_id=NULL WHERE id=?').run('sample');
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
await reload();await choose('[aria-label="Discord for @sample"]','First');await until(()=>sql.prepare('SELECT discord_id FROM dots').get().discord_id===first.id);await reload();assert.ok(w.document.querySelector('[aria-label="Discord for @sample"]').textContent.includes('First'));
await replace('Replace webhook for @sample',hook,'Save Agent');await reload();assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);assert.equal(w.document.querySelector('[aria-label="Replace webhook for @sample"]').textContent,'••••••••');assert.ok(!w.document.documentElement.outerHTML.includes(hook));
await choose('[aria-label="Discord for @sample"]','Second');await until(()=>sql.prepare('SELECT discord_id FROM dots').get().discord_id===second.id);await reload();assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
click(btn('@sample'));await until(()=>btn('Save Agent'));input('[aria-label="Discord handle"]','renamed');await new Promise(r=>setTimeout(r,0));
// An independently saved Discord picker must retain an in-progress handle edit
// and merge the new destination so the subsequent row save cannot overwrite it.
await choose('[aria-label="Discord for @sample"]','First');await until(()=>sql.prepare('SELECT discord_id FROM dots').get().discord_id===first.id);
await until(()=>w.document.querySelector('[aria-label="Discord for @sample"]')&&!w.document.querySelector('[aria-label="Discord for @sample"]').disabled);
assert.ok(btn('Save Agent'),'Changing Discord must retain the pending handle draft');assert.equal(w.document.querySelector('[aria-label="Discord handle"]').value,'renamed');
click(btn('Save Agent'));await until(()=>btn('@renamed'));await reload();assert.ok(btn('@renamed'));assert.ok(w.document.querySelector('[aria-label="Discord for @renamed"]').textContent.includes('First'));assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
await choose('[aria-label="Discord for @renamed"]','Second');await until(()=>sql.prepare('SELECT discord_id FROM dots').get().discord_id===second.id);await reload();
click(w.document.querySelector('[aria-label="ChatGPT Dot: @renamed"]'));await until(()=>btn('Save Agent'));click(btn('Save Agent'));await until(()=>!btn('Save Agent'));await reload();assert.equal(w.document.querySelector('[aria-label="ChatGPT Dot: @renamed"]').getAttribute('aria-checked'),'false');assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
await reload('discord');await replace('Edit name for Second','Renamed Discord');await reload('discord');assert.ok(w.document.querySelector('[aria-label="Edit name for Renamed Discord"]'));
await replace('Replace bot for Renamed Discord','new_bot_token_1234567890');await reload('discord');assert.equal(sql.prepare('SELECT bot_token FROM discords WHERE id=?').get(second.id).bot_token,'new_bot_token_1234567890');
await replace('Replace channel for Renamed Discord','https://discord.com/channels/123456789012345678/434567890123456789');await reload('discord');assert.equal(sql.prepare('SELECT channel_id FROM discords WHERE id=?').get(second.id).channel_id,'434567890123456789');assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
// A rejected replacement must keep both the existing credential and the open,
// editable dialog so the user can correct the value without losing the row.
click(w.document.querySelector('[aria-label="Replace bot for Renamed Discord"]'));await until(()=>w.document.querySelector('#replacement-value'));
input('#replacement-value','bad token');await new Promise(r=>setTimeout(r,0));click(btn('Save Discord'));
await until(()=>w.document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('valid Discord bot token'));
assert.equal(sql.prepare('SELECT bot_token FROM discords WHERE id=?').get(second.id).bot_token,'new_bot_token_1234567890');
assert.equal(w.document.querySelector('#replacement-value').value,'bad token');click(btn('Cancel'));await until(()=>!w.document.querySelector('[role=dialog]'));
await reload();click(w.document.querySelector('[aria-label="Replace webhook for @renamed"]'));await until(()=>w.document.querySelector('#replacement-value'));
input('#replacement-value','https://invalid.example/webhook');await new Promise(r=>setTimeout(r,0));click(btn('Save Agent'));
await until(()=>w.document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('valid Discord webhook'));
assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
input('#replacement-value',hook);await new Promise(r=>setTimeout(r,0));click(btn('Save Agent'));await until(()=>!w.document.querySelector('[role=dialog]'));
await reload();click(btn('@renamed'));await until(()=>btn('Save Agent'));input('[aria-label="Discord handle"]','bad..handle');await new Promise(r=>setTimeout(r,0));click(btn('Save Agent'));
await until(()=>[...w.document.querySelectorAll('[role=alert]')].some(e=>e.textContent.trim()));
assert.equal(sql.prepare('SELECT id FROM dots').get().id,'renamed');assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
assert.ok(btn('Save Agent'));click(btn('Cancel'));await until(()=>!btn('Save Agent'));
// Simulated HTTP failure exercises the picker rollback; the Worker is not called
// for this one write. The next fresh page reads the unchanged stored destination.
w.fetch=async(path,opts={})=>path==='/api/tool'&&JSON.parse(opts.body).name==='set_discord'?Response.json({error:'Destination save failed for test.'},{status:503}):request(path,opts);
await choose('[aria-label="Discord for @renamed"]','First');await until(()=>w.document.body.textContent.includes('Destination save failed for test.'));
assert.ok(w.document.querySelector('[aria-label="Discord for @renamed"]').textContent.includes('Renamed Discord'));
assert.equal(sql.prepare('SELECT discord_id FROM dots').get().discord_id,second.id);
await reload();assert.ok(w.document.querySelector('[aria-label="Discord for @renamed"]').textContent.includes('Renamed Discord'));assert.equal(sql.prepare('SELECT webhook_url FROM dots').get().webhook_url,hook);
await reload('settings');const member=w.document.querySelector('[aria-label="Inactive account member@example.test"]');click(member);await until(()=>member.checked);await reload('settings');assert.equal(w.document.querySelector('[aria-label="Inactive account member@example.test"]').checked,true);assert.ok(w.document.documentElement.outerHTML.includes('member@example.test'),'Owner sees exact account email for invitation selection');
await reload();click(btn('Add Agent'));await until(()=>w.document.querySelector('#handle'));input('#handle','new_agent');input('#webhook',hook);await new Promise(r=>setTimeout(r,0));await choose('#discord','First');click(btn('Save Agent'));await until(()=>!w.document.querySelector('[role=dialog]'));await reload();assert.ok(btn('@new_agent'));assert.equal(sql.prepare('SELECT webhook_url FROM dots WHERE id=?').get('new_agent').webhook_url,hook);
await reload('discord');click(btn('Add Discord'));await until(()=>w.document.querySelector('#name'));input('#name','Third');input('#channel_url','https://discord.com/channels/123456789012345678/534567890123456789');input('#bot_token','third_bot_token_1234567890');click(btn('Save Discord'));await until(()=>!w.document.querySelector('[role=dialog]'));await reload('discord');assert.ok(w.document.querySelector('[aria-label="Edit name for Third"]'));
click(w.document.querySelector('[aria-label="Delete Discord Third"]'));await until(()=>btn('Delete'));click(btn('Delete'));await until(()=>!w.document.querySelector('[role=alertdialog]'));await reload('discord');assert.ok(!w.document.querySelector('[aria-label="Edit name for Third"]'));
await reload();click(w.document.querySelector('[aria-label="Delete @new_agent"]'));await until(()=>btn('Delete'));click(btn('Delete'));await until(()=>!w.document.querySelector('[role=alertdialog]'));await reload();assert.ok(!btn('@new_agent'));
dom.window.close();
let posts=0,reads=0;const original=globalThis.fetch;globalThis.fetch=async(url,opts)=>{if(opts.method==='POST'){posts++;return Response.json({id:'634567890123456789',channel_id:'434567890123456789'});}reads++;assert.equal(opts.headers.Authorization,'Bot new_bot_token_1234567890');return Response.json([{id:'634567890123456789',content:'Live text',author:{username:'example'},attachments:[]}]);};
assert.equal((await api('post_to_discord',{dot_id:'renamed',text:'hello @new_agent'})).sent,true);assert.equal(posts,1);assert.equal((await api('read_discord',{dot_id:'renamed',limit:5})).messages[0].text,'Live text');assert.equal(reads,1);globalThis.fetch=original;
console.log('PASS: actual bundled UI → Worker → SQLite → fresh-page reload for every editable field, both add dialogs and deletions; secrets retained and masked; rejected credential/handle edits preserve stored values and stay editable, rejected destination saves roll back; saved webhook posting and bot-token reading. Discord network and one rejected picker request mocked.');
