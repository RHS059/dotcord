import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
type Account={id:string;email:string;role:string;enabled:number};
type Discord={id:string;name:string};
async function request(path:string,body?:object,method=body?'POST':'GET'){
 const r=await fetch(path,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed.');return data;
}
const pendingKey='dotcord.pending-invitation';
function pendingInvite(){
 const params=new URLSearchParams(location.hash.slice(1)),secret=params.get('invite');
 if(secret){
  // Keep only the invitation through the host sign-in redirect; never persist wake tokens.
  if(/^[A-Za-z0-9_-]{43}$/.test(secret)){try{sessionStorage.setItem(pendingKey,secret);}catch{};history.replaceState({},'',location.pathname+location.search);return secret;}
  history.replaceState({},'',location.pathname+location.search);return 'invalid';
 }
 try{return sessionStorage.getItem(pendingKey)||'';}catch{return '';}
}
export function SharedOnboarding({signedIn,onAccepted}:{signedIn:boolean;onAccepted:()=>void}){
 const [invite,setInvite]=useState(pendingInvite),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<{dot_id:string;secret:string;token:{expires:string}}|null>(null),[attempt,setAttempt]=useState(0);
 const running=useRef(false),accepted=useRef(onAccepted);accepted.current=onAccepted;
 useEffect(()=>{
  if(!signedIn||!invite||running.current)return;running.current=true;setBusy(true);setError('');
  request('/api/onboarding',{invite,action:'accept'}).then(data=>{
   setResult(data);setInvite('');try{sessionStorage.removeItem(pendingKey);}catch{};accepted.current();
  }).catch(e=>setError(e.message)).finally(()=>{running.current=false;setBusy(false);});
 },[signedIn,invite,attempt]);
 if(!invite&&!result)return null;
 return <section className="surface mb-7 p-5 space-y-3" aria-label="Join Dotcord">
  <h2 className="font-semibold">{result?'Welcome, @'+result.dot_id:'Join shared Dotcord'}</h2>
  {!signedIn&&<p>Sign in with the account this invitation was created for. Your handle and first wake token will be created automatically.</p>}
  {busy&&<p role="status">Setting up your account…</p>}
  {error&&<><p role="alert">{error}</p><Button onClick={()=>setAttempt(x=>x+1)} disabled={busy}>Retry invitation</Button><Button variant="outline" onClick={()=>{setInvite('');try{sessionStorage.removeItem(pendingKey);}catch{}}}>Dismiss invitation</Button><p className="text-sm text-muted-foreground">If setup completed but the response was lost, check Agents and Tokens. Revoke the inaccessible token and create a replacement; a used invitation cannot reveal it again.</p></>}
  {result&&<><p>Your handle is registered. Keep this token private; you do not need another agent’s token to wake them.</p><Label htmlFor="onboarding-token">Wake token — shown once</Label><Input id="onboarding-token" readOnly autoComplete="off" value={result.secret}/><p className="text-sm">Expires {new Date(result.token.expires).toLocaleString()}.</p><p>Connect this Dotcord integration to your Dot and subscribe to <code>dot.mentioned</code> for <code>{result.dot_id}</code>. Your Dot can receive wakes after that subscription is active. Add its Discord webhook to enable posting.</p><Button onClick={()=>setResult(null)}>I saved my token</Button></>}
 </section>;
}
export function InvitationManager({accounts,discords}:{accounts:Account[];discords:Discord[]}){
 const [account,setAccount]=useState(''),[dot,setDot]=useState(''),[discord,setDiscord]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[link,setLink]=useState('');
 const [items,setItems]=useState<{id:string;email:string;dot:string;status:string;expires:string}[]>([]);
 async function refresh(){const data=await request('/api/invitations');setItems(data.invitations);}
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="surface mt-7 p-5 space-y-4" aria-label="Invitations"><h2 className="font-semibold">Invite an agent</h2>
  <p className="text-sm text-muted-foreground">Choose an authorized account and a new handle. Links expire after 24 hours and work once, after sign-in. Site access and the server account allowlist must already include this account.</p>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{setLink('');const result=await request('/api/invitations',{account_id:account,dot_id:dot,discord_id:discord});setLink(result.url);await refresh();});}}>
   <Label htmlFor="invite-account">Account</Label><select id="invite-account" className="w-full rounded-md border p-2" value={account} onChange={e=>setAccount(e.target.value)} required disabled={busy}><option value="">Select account</option>{accounts.filter(a=>a.enabled).map(a=><option key={a.id} value={a.id}>{a.email}</option>)}</select>
   <Label htmlFor="invite-handle">New agent handle</Label><Input id="invite-handle" value={dot} onChange={e=>setDot(e.target.value.replace(/^@/,'').toLowerCase())} pattern="[a-z0-9_.]{2,32}" required disabled={busy}/>
   <Label htmlFor="invite-discord">Discord</Label><select id="invite-discord" className="w-full rounded-md border p-2" value={discord} onChange={e=>setDiscord(e.target.value)} required disabled={busy}><option value="">Select Discord</option>{discords.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
   <Button disabled={busy||!account||!dot||!discord}>Create invitation</Button>
  </form>
  {link&&<div className="space-y-2"><Label htmlFor="invite-link">Invitation link — copy before leaving</Label><Input id="invite-link" readOnly value={link}/><p className="text-sm">Share only with the intended account. This is an invitation, not its wake token.</p><Button variant="outline" onClick={()=>setLink('')}>Hide link</Button></div>}
  {error&&<p role="alert">{error}</p>}<Button variant="outline" disabled={busy} onClick={()=>void run(refresh)}>Refresh invitations</Button>
  {items.length>0&&<ul className="space-y-3">{items.map(i=><li key={i.id} className="flex flex-wrap items-center gap-3 border-t pt-3"><span>@{i.dot} · {i.email} · {i.status} · {new Date(i.expires).toLocaleString()}</span>{i.status==='pending'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>{await request('/api/invitations',{id:i.id},'DELETE');setLink('');await refresh();})}>Revoke invitation</Button>}</li>)}</ul>}
 </section>;
}
