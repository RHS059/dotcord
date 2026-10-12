// Built Worker, in-memory requests only. No hosted identity, DB, credentials or live wake.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import worker from '../dist/server/index.js';
import {boot,pause} from './helpers/redesign-dom.mjs';
const request=(path,headers={})=>worker.fetch(new Request('https://dotcord.example.test'+path,{headers}),{});
let landing;
for(const path of ['/','/docs/connect-an-agent']){
 const r=await request(path);assert.equal(r.status,200);assert.equal(r.headers.get('x-robots-tag'),null);const html=await r.text();
 const d=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'')).window.document;
 assert.equal(d.querySelector('link[rel=canonical]').href,'https://dotcord.example.test'+path);
 assert.ok(d.querySelector('meta[name=description]').content.length>30);assert.ok(d.querySelector('meta[property="og:title"]'));assert.ok(d.querySelector('link[type="text/markdown"]'));
 const structured=d.querySelector('script[type="application/ld+json"]');const graph=structured?JSON.parse(structured.textContent)['@graph']:[];
 if(path==='/'){assert.ok(graph.some(x=>x['@type']==='SoftwareApplication'));assert.ok(graph.some(x=>x['@type']==='HowTo'));landing=graph;}else assert.ok(!graph.some(x=>x['@type']==='FAQPage'),'Docs must not assert an invisible FAQ');
}
for(const path of ['/agents','/agents/nova','/discord','/tokens','/settings','/setup','/status','/join/synthetic-code']){
 const loggedOut=await request(path);assert.equal(loggedOut.status,302,path);assert.equal(loggedOut.headers.get('location'),'/login?next='+encodeURIComponent(path));assert.equal(loggedOut.headers.get('x-robots-tag'),'noindex, nofollow');
 const page=await request(path,{'oai-authenticated-user-id':'synthetic-ui-only'});assert.equal(page.status,200);assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');assert.match(await page.text(),/<meta name="robots" content="noindex, nofollow">/);
}
const login=await request('/login');assert.equal(login.status,200);assert.equal(login.headers.get('x-robots-tag'),'noindex, nofollow');
for(const [path,type] of [['/llms.txt','text/plain'],['/docs/connect-an-agent.md','text/markdown'],['/assets/sidebar-bg.png','image/png'],['/logo.svg','image/svg+xml']]){
 const r=await request(path);assert.equal(r.status,200,path);assert.ok(r.headers.get('content-type').startsWith(type));assert.deepEqual(Buffer.from(await r.arrayBuffer()),readFileSync('public'+path),'Served exact asset '+path);
}
const ui=boot({route:'/'});await pause(150);assert.equal(ui.state.calls.length,0,'Public landing never fetches account/private data');
const visible=[...ui.doc.querySelectorAll('.public-faq details')].map(el=>[el.querySelector('summary').textContent,el.querySelector('p').textContent]);
const machine=landing.find(x=>x['@type']==='FAQPage').mainEntity.map(x=>[x.name,x.acceptedAnswer.text]);assert.deepEqual(machine,visible,'JSON-LD FAQ equals visible FAQ exactly');ui.close();
console.log('PASS redesigned routes: auth redirects, app noindex, public canonical/SEO, exact sidebar/logo/docs assets, visible FAQ parity, and no private-data fetch on landing. Synthetic requests only.');
