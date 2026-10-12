import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {boot,pause,until} from './helpers/redesign-dom.mjs';

const chosen=process.env.QA_CASE;
if(!chosen){
 const cases=[...[320,759,760,1079,1080,1440].map(w=>'width-'+w),'theme','drill-in','route-discord','route-tokens','route-settings','gate-signed_up','gate-logged_out','gate-inactive','deferred-profile','deferred-settings','wake-pending','wake-uncertain','edit-message','replacement','send-pending','send-uncertain','inbox'];
 for(const name of cases){const r=spawnSync(process.execPath,['--expose-gc',process.argv[1]],{stdio:'inherit',env:{...process.env,QA_CASE:name},timeout:30000});if(r.status!==0)throw new Error('Case '+name+' failed: '+(r.error?.message||r.signal||r.status));}
 console.log('PASS all redesigned production UI cases. Synthetic API only.');process.exit(0);
}
async function loaded(ui,title='Agents'){await until(()=>ui.doc.querySelector('h1')?.textContent===title&&!ui.doc.body.textContent.includes('Loading…'),'load '+title);await pause(100);assert.deepEqual(ui.state.unknown,[],'Every fetch stays inside the explicit local fixture');}
function btn(ui,text){return [...ui.doc.querySelectorAll('button:not([role=combobox])')].find(b=>b.textContent.trim().toLowerCase()===text.toLowerCase());}
function navLink(ui,path){return ui.doc.querySelector('nav a[href="'+path+'"]');}

// Direct paths, labelled controls, list semantics, and theme persistence.
for(const width of [320,759,760,1079,1080,1440].filter(w=>chosen==='width-'+w)){
 const ui=boot({route:'/agents/nova',width});await loaded(ui);
 assert.equal(ui.doc.querySelector('#detail-title')?.textContent,'@nova');
 assert.equal(ui.doc.querySelectorAll('h1').length,1);
 assert.equal(ui.doc.querySelectorAll('select').length,0,'No native select at '+width);
 assert.equal(ui.doc.querySelectorAll('table').length,0,'Agents are semantic lists');
 assert.equal(ui.doc.documentElement.dataset.theme,'dark');
 assert.ok(ui.doc.querySelector('a[href="#main"]'));
 if(width<1080)assert.ok(btn(ui,'All Agents'));
 assert.equal(ui.state.calls.filter(c=>c.path==='/api/test-wake').length,0,'Mount never sends test wake');
 assert.equal(ui.calls('post_to_discord').length,0,'Mount never posts');
 assert.equal(ui.state.calls.filter(c=>c.method==='POST'&&['/api/receivers','/api/tokens'].includes(c.path)).length,0,'Mount never creates persistent access');
 ui.close();
}
if(chosen==='theme'){
 const ui=boot();await loaded(ui);ui.click(btn(ui,'Light'));await pause();
 assert.equal(ui.w.localStorage.getItem('dotcord-theme'),'light');assert.equal(ui.doc.documentElement.dataset.theme,'light');
 assert.equal(ui.doc.querySelector('meta[name="theme-color"]').content,'#faf5ef');ui.close();
 const restored=boot({theme:'light'});await loaded(restored);assert.equal(restored.doc.documentElement.dataset.theme,'light');restored.close();
}
if(chosen==='drill-in'){
 const ui=boot({route:'/agents',width:320});await loaded(ui);
 assert.equal(ui.doc.querySelector('#detail-title'),null,'Small view starts at agent list');
 const row=[...ui.doc.querySelectorAll('.agent-row')].find(b=>b.textContent.includes('@nova'));ui.click(row);await until(()=>ui.doc.querySelector('#detail-title'));
 assert.equal(ui.w.location.pathname,'/agents/nova');ui.click(btn(ui,'All Agents'));await pause();assert.equal(ui.w.location.pathname,'/agents');assert.equal(ui.doc.querySelector('#detail-title'),null);ui.close();
}
for(const [route,title] of [['/discord','Discord'],['/tokens','Tokens'],['/settings','Settings']].filter(([route])=>chosen==='route-'+route.slice(1))){
 const ui=boot({route});await loaded(ui,title);assert.equal(ui.doc.querySelectorAll('h1').length,1);assert.equal(ui.doc.querySelectorAll('select').length,0);
 if(route!=='/settings')assert.equal(ui.doc.querySelectorAll('table').length,0);
 if(route==='/settings')assert.ok(ui.doc.querySelector('#credentials'));
 ui.click(navLink(ui,'/agents'));await loaded(ui);assert.equal(ui.w.location.pathname,'/agents');assert.equal(ui.doc.querySelector('#main').style.opacity,'1','Transition fallback restores main');assert.equal(ui.doc.activeElement.id,'main');
 ui.nav(route);await loaded(ui,title);ui.close();
}
// Identity gating: signed-up and unauthenticated pages never load shared data.
for(const status of ['signed_up','logged_out','inactive'].filter(s=>chosen==='gate-'+s)){
 const ui=boot({route:'/settings',status,owner:false,agents:[]});await pause(200);
 assert.equal(ui.calls('list_discords').length,0,status+' cannot fetch shared destinations');
 assert.equal(ui.state.calls.some(c=>['/api/accounts','/api/receivers','/api/tokens','/api/audit'].includes(c.path)),false,status+' cannot mount privileged panels');
 assert.equal(ui.doc.querySelector('input[type=password]'),null,status+' initial onboarding never asks for secrets');ui.close();
}
// Replacement dialog never retrieves a saved secret and restores focus after close.
if(chosen==='deferred-profile'){
 const ui=boot({route:'/status',status:'signed_up',owner:false});let release;
 ui.state.override=(call,response)=>call.body?.name==='list_dots'?new Promise(resolve=>release=()=>resolve(response(ui.state.agents.filter(a=>a.is_owned)))):undefined;
 await until(()=>release,'deferred own-profile load');await pause(50);release();await pause(100);
 assert.match(ui.doc.querySelector('h1')?.textContent||'',/Queue/,'Saved profile arriving after identity must show status, not blank setup');
 assert.equal(ui.w.location.pathname,'/status');ui.close();
}
// Replacement dialog never retrieves a saved secret and restores focus after close.
if(chosen==='replacement'){
 const ui=boot({route:'/discord'});await loaded(ui,'Discord');const trigger=ui.doc.querySelector('[aria-label="Replace bot for Studio Discord"]');trigger.focus();ui.click(trigger);
 await until(()=>ui.doc.querySelector('[role=dialog]'));const dialog=ui.doc.querySelector('[role=dialog]');assert.equal(dialog.querySelector('input').type,'password');assert.equal(dialog.querySelector('input').value,'');
 ui.click(btn(ui,'Cancel'));await until(()=>!ui.doc.querySelector('[role=dialog]'));await pause(30);assert.ok(ui.doc.activeElement===trigger,'Dialog close must restore the invoking control; actual '+ui.doc.activeElement.tagName+' '+ui.doc.activeElement.id);assert.equal(ui.calls('update_discord').length,0);ui.close();
}
// Mention recipients and send safety use the exact production bundle with synthetic fetch.
if(chosen==='send-pending'){
 const ui=boot({route:'/agents/nova'});await loaded(ui);ui.input('#message-body','@orbit @lyra Please review.');await pause();
 const composer=ui.doc.querySelector('#message-body').closest('section');assert.ok(composer.textContent.includes('@orbit'));assert.ok(composer.textContent.includes('@lyra'));
 assert.ok(![...composer.querySelectorAll('button[aria-pressed]')].some(b=>b.textContent.includes('@ember')),'Different Discord recipients excluded');
 let release;ui.state.override=(call,response)=>call.body?.name==='post_to_discord'?new Promise(resolve=>release=()=>resolve(response({sent:true,mention_delivery:{results:[{handle:'orbit',status:'accepted'}]}}))):undefined;
 const send=btn(ui,'Send Message');assert.ok(send);ui.click(send);ui.click(send);await pause();assert.equal(ui.calls('post_to_discord').length,1,'Same-render duplicate send is locked');
 ui.click(navLink(ui,'/discord'));await loaded(ui,'Discord');ui.nav('/agents/nova');await loaded(ui);const during=btn(ui,'Sending…');assert.ok(during,'Pending send survives route unmount');
 ui.click(during);assert.equal(ui.calls('post_to_discord').length,1);release();await pause(100);assert.equal(ui.calls('post_to_discord').length,1);ui.close();
}
if(chosen==='send-uncertain'){
 const ui=boot({route:'/agents/nova'});await loaded(ui);ui.input('#message-body','Do not duplicate this synthetic message.');await pause();
 ui.state.override=(call,response)=>call.body?.name==='post_to_discord'?response({error:'Result uncertain'},503):undefined;ui.click(btn(ui,'Send Message'));await pause(100);
 assert.match(ui.doc.body.textContent,/uncertain|Check Discord/i);ui.click(navLink(ui,'/discord'));await loaded(ui,'Discord');ui.nav('/agents/nova');await loaded(ui);
 const send=btn(ui,'Send Message');if(send)ui.click(send);await pause();assert.equal(ui.calls('post_to_discord').length,1,'Uncertain result survives remount and prevents automatic duplicate');ui.close();
}
// Inbox list and reads remain scoped and never acknowledge automatically.
if(chosen==='inbox'){
 const ui=boot({route:'/agents/nova'});await loaded(ui);ui.click(btn(ui,'Load Inbox'));await pause();assert.equal(ui.calls('list_pending_messages').at(-1)?.body.arguments.dot_id,'nova');
 const read=btn(ui,'Read Message');if(read){ui.click(read);await pause();assert.equal(ui.calls('read_pending_message').at(-1)?.body.arguments.dot_id,'nova');}
 assert.equal(ui.calls('acknowledge_message').length,0);ui.nav('/agents/orbit');await loaded(ui);assert.equal(ui.doc.body.textContent.includes('Synthetic message for local QA only.'),false);ui.close();
}

if(chosen==='deferred-settings'){
 const ui=boot({route:'/settings',status:'signed_up',owner:false});let release;
 ui.state.override=(call,response)=>call.body?.name==='list_dots'?new Promise(resolve=>release=()=>resolve(response(ui.state.agents.filter(a=>a.is_owned)))):undefined;
 await until(()=>release);await pause(80);
 const privateCalls=()=>ui.state.calls.filter(c=>['/api/accounts','/api/receivers','/api/tokens','/api/audit'].includes(c.path));
 assert.equal(privateCalls().length,0,'Pending own-profile must not mount Settings');release();await pause(150);assert.equal(privateCalls().length,0);assert.equal(ui.doc.querySelector('input[type=password]'),null);ui.close();
}
if(chosen==='wake-pending'){
 const ui=boot({route:'/agents/nova'});await loaded(ui);let release;
 ui.state.override=(call,response)=>call.path==='/api/test-wake'?new Promise(resolve=>release=()=>resolve(response({request_id:call.body.request_id,message_id:'synthetic-test',handle:call.body.dot_id,status:'accepted',results:[{handle:call.body.dot_id,status:'accepted',attempts:1}]}))):undefined;
 const trigger=btn(ui,'Test Wake');ui.click(trigger);ui.click(trigger);await pause();assert.equal(ui.state.calls.filter(c=>c.path==='/api/test-wake').length,1);
 ui.nav('/discord');await loaded(ui,'Discord');ui.nav('/agents/nova');await loaded(ui);assert.ok(btn(ui,'Testing…')?.disabled);release();await until(()=>ui.doc.querySelector('[aria-label="Test wake result"]')?.textContent.includes('accepted by the receiving callback'));
 assert.ok(!btn(ui,'Test Wake').disabled);assert.match(ui.doc.body.textContent,/Agent execution is not confirmed/);assert.equal(ui.calls('post_to_discord').length,0);ui.close();
}
if(chosen==='wake-uncertain'){
 const ui=boot({route:'/agents/nova'});await loaded(ui);
 ui.state.override=(call,response)=>call.path==='/api/test-wake'?response({error:'Synthetic uncertain response'},503):undefined;
 ui.click(btn(ui,'Test Wake'));await until(()=>btn(ui,'Check Test Result'));const first=ui.state.calls.find(c=>c.path==='/api/test-wake').body.request_id;
 ui.nav('/discord');await loaded(ui,'Discord');ui.nav('/agents/nova');await loaded(ui);ui.click(btn(ui,'Check Test Result'));await pause(80);const calls=ui.state.calls.filter(c=>c.path==='/api/test-wake');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.body.request_id===first),'Uncertain result check must reuse request ID');assert.equal(ui.calls('post_to_discord').length,0);ui.close();
}
if(chosen==='edit-message'){
 const ui=boot({route:'/agents/nova'});await loaded(ui);ui.click(ui.doc.querySelector('#message-mode'));await pause();ui.click([...ui.doc.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('Edit Message')));await until(()=>ui.doc.querySelector('#message-id'));
 ui.input('#message-id','bad');ui.input('#message-body','@orbit Edited synthetic content');await pause();assert.equal(btn(ui,'Save Edit').getAttribute('aria-disabled'),'true');ui.click(btn(ui,'Save Edit'));await pause();assert.equal(ui.calls('edit_discord_message').length,0);
 ui.input('#message-id','123456789012345678');ui.input('#message-thread','123456789012345679');await pause();ui.click(btn(ui,'Save Edit'));await pause(80);
 assert.equal(ui.calls('edit_discord_message').length,1);assert.deepEqual(ui.calls('edit_discord_message')[0].body.arguments,{dot_id:'nova',text:'@orbit Edited synthetic content',message_id:'123456789012345678',thread_id:'123456789012345679'});assert.equal(ui.calls('post_to_discord').length,0);assert.equal(ui.state.calls.filter(c=>c.path==='/api/test-wake').length,0);ui.close();
}
console.log('PASS redesign UI '+chosen+' (synthetic only)');
