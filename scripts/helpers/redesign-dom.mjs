import {JSDOM,VirtualConsole} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import fixture from './redesign-fixture.cjs';
export const pause=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function until(check,label='condition'){for(let i=0;i<300;i++){if(check())return;await pause();}throw Error('Redesign UI timeout: '+label);}
export function executeScripts(w,html){const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];assert.ok(scripts.length);for(const [,attrs,source] of scripts)if(!/application\/ld\+json/.test(attrs)&&source.trim())w.eval(source);}
export function boot({route='/agents',width=1440,theme,...options}={}){
 global.gc?.();
 const html=readFileSync('client-build/index.html','utf8'),errors=[],vc=new VirtualConsole();
 vc.on('jsdomError',e=>{if(!/Not implemented: (navigation|Window's scrollTo)|Could not parse CSS stylesheet/.test(e.message))errors.push(e.message);});
 // JSDOM has no layout engine. Styles are checked separately; avoiding its
 // unsupported Tailwind CSS parser keeps repeated structural tests bounded.
 const dom=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,''),{url:'https://dotcord.example.test'+route,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window,doc=w.document;
 Object.defineProperty(w,'innerWidth',{value:width,writable:true});w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};
 w.matchMedia=query=>({matches:/prefers-reduced-motion/.test(query)?false:query.includes('1080')?width>=1080:query.includes('760')?width>=760:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});w.confirm=()=>true;
 if(theme)w.localStorage.setItem('dotcord-theme',theme);
 const state=fixture.installFixture(w,options),byText=(selector,text)=>[...doc.querySelectorAll(selector)].find(el=>el.textContent.trim()===text),button=text=>byText('button',text);
 const click=el=>{assert.ok(el,'Expected clickable control');el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));};
 const key=(el,value)=>{assert.ok(el);el.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));};
 const input=(selector,value)=>{const el=typeof selector==='string'?doc.querySelector(selector):selector;assert.ok(el,'Expected input '+selector);const proto=el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const nav=path=>{w.history.pushState({},'',path);w.dispatchEvent(new w.PopStateEvent('popstate'));},calls=name=>state.calls.filter(c=>c.body?.name===name),close=()=>dom.window.close();
 executeScripts(w,html);return{dom,w,doc,state,errors,byText,button,click,key,input,nav,calls,close,html};
}
