import {useEffect,useState} from 'react';
type Notice={text:string;undo?:()=>void};
let current:Notice|null=null,hide:ReturnType<typeof setTimeout>|undefined;
const listeners=new Set<()=>void>(),pending=new Map<string,{timer:ReturnType<typeof setTimeout>;undo:()=>void}>();
const emit=()=>listeners.forEach(fn=>fn());
export function toast(text:string,undo?:()=>void){if(current?.undo&&pending.size&&!undo)return;clearTimeout(hide);current={text,undo};emit();hide=setTimeout(()=>{if(!pending.size){current=null;emit();}},undo?6000:3000);}
export function deferRemoval(key:string,label:string,optimistic:()=>void,restore:()=>void,commit:()=>Promise<void>){if(pending.size)return;optimistic();const undo=()=>{const item=pending.get(key);if(!item)return;clearTimeout(item.timer);pending.delete(key);restore();toast(label+' restored.');};const timer=setTimeout(async()=>{pending.delete(key);try{await commit();toast(label+' removed.');}catch(error){restore();toast((error as Error).message||'Removal failed. Check the saved state.');}},6000);pending.set(key,{timer,undo});toast(label+' will be removed in 6 seconds.',undo);}
export function Toast(){const [notice,setNotice]=useState(current);useEffect(()=>{const listen=()=>setNotice(current),leave=(e:BeforeUnloadEvent)=>{if(pending.size){e.preventDefault();e.returnValue='';}};listeners.add(listen);window.addEventListener('beforeunload',leave);return()=>{listeners.delete(listen);window.removeEventListener('beforeunload',leave);};},[]);return <div role="status" aria-live="polite" aria-atomic="true" className={'toast '+(notice?'shown':'')}><span>{notice?.text}</span>{notice?.undo&&<button type="button" onClick={notice.undo}>Undo</button>}</div>;}

