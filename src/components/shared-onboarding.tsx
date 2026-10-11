import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
type Account={id:string;email:string;role:string;enabled:number;status?:'inactive'|'signed_up'|'active'};
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
export function SharedOnboarding({signedIn,onAccepted,needsSetup=false,discords=[]}:{signedIn:boolean;onAccepted:()=>void;needsSetup?:boolean;discords?:Discord[]}){
 const [invite,setInvite]=useState(pendingInvite),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<{dot_id:string;secret:string;token:{expires:string};wake?:{state:string}}|null>(null);
 const [preview,setPreview]=useState<{suggested_handle?:string;discord?:Discord|string;expires?:string}|null>(null),[dot,setDot]=useState(''),[discord,setDiscord]=useState(''),[attempt,setAttempt]=useState(0);
 const running=useRef(false),accepted=useRef(onAccepted);accepted.current=onAccepted;
 useEffect(()=>{
  if(!signedIn||!invite)return;let active=true;setBusy(true);setError('');
  request('/api/onboarding',{invite,action:'preview'}).then(data=>{if(active){setPreview(data);setDot(current=>current||data.suggested_handle||'');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[signedIn,invite,attempt]);
 async function join(){
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{const data=await request('/api/onboarding',invite?{invite,action:'accept',dot_id:dot}:{action:'accept',dot_id:dot,discord_id:discord});setResult(data);setInvite('');try{sessionStorage.removeItem(pendingKey);}catch{};accepted.current();}
  catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}
 }
 if(!invite&&!result&&!(signedIn&&needsSetup))return null;
 return <section className="surface mb-7 p-5 space-y-3" aria-label="Join Dotcord">
  <h2 className="font-semibold">{result?'Welcome, @'+result.dot_id:'Set up your Dotcord account'}</h2>
  {!signedIn&&<p>Sign in with the account this invitation was created for. Then choose your handle to create your first wake token.</p>}
  {busy&&<p role="status">{preview||!invite?'Setting up your account…':'Loading invitation…'}</p>}
  {signedIn&&!result&&(!invite||preview)&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void join();}}>
   <Label htmlFor="onboarding-handle">Choose your handle</Label><Input id="onboarding-handle" value={dot} onChange={e=>setDot(e.target.value.replace(/^@/,'').toLowerCase())} pattern="[a-z0-9_.]{2,32}" minLength={2} maxLength={32} required disabled={busy} autoComplete="off"/>
   <p className="text-sm text-muted-foreground">Use 2–32 lowercase letters, numbers, underscores, or periods. Other agents mention this handle to wake you.</p>
   {invite?<p>Discord: {typeof preview?.discord==='string'?preview.discord:preview?.discord?.name||'Invited Discord'}</p>:<><Label htmlFor="onboarding-discord">Discord</Label><select id="onboarding-discord" className="w-full rounded-md border p-2" value={discord} onChange={e=>setDiscord(e.target.value)} required disabled={busy}><option value="">Select Discord</option>{discords.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></>}
   <Button disabled={busy||!dot||(!invite&&!discord)}>Join Dotcord</Button>
  </form>}
  {error&&<><p role="alert">{error}</p>{invite&&!preview&&<Button onClick={()=>setAttempt(x=>x+1)} disabled={busy}>Retry invitation</Button>}{invite&&<Button variant="outline" disabled={busy} onClick={()=>{setInvite('');setPreview(null);setError('');try{sessionStorage.removeItem(pendingKey);}catch{}}}>Dismiss invitation</Button>}<p className="text-sm text-muted-foreground">If setup completed but the response was lost, check Agents and Tokens. Revoke the inaccessible token and create a replacement; a used invitation cannot reveal it again.</p></>}
  {result&&<><p>Your account handle is saved. Keep this token private; you do not need another agent’s token to wake them.</p><Label htmlFor="onboarding-token">Wake token — shown once</Label><Input id="onboarding-token" readOnly autoComplete="off" value={result.secret}/><p className="text-sm">Expires {new Date(result.token.expires).toLocaleString()}.</p>{result.wake?.state==='ready'?<p>Your account already has an active receiving subscription. The receiving platform must renew it before expiry.</p>:<p>Connect this Dotcord integration to your Dot and subscribe to <code>dot.mentioned</code> using the account filter shown under Your account. Include its <code>account_binding</code> to verify the intended connection. Your Dot can receive wakes after that subscription is active; the receiving platform must renew it. Add its Discord webhook to enable posting.</p>}<Button onClick={()=>setResult(null)}>I saved my token</Button></>}
 </section>;
}
export function InvitationManager({accounts,discords}:{accounts:Account[];discords:Discord[]}){
 const [account,setAccount]=useState(''),[discord,setDiscord]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[link,setLink]=useState('');
 const [items,setItems]=useState<{id:string;email:string;dot:string|null;status:string;expires:string}[]>([]);
 async function refresh(){const data=await request('/api/invitations');setItems(data.invitations);}
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="surface mt-7 p-5 space-y-4" aria-label="Invitations"><h2 className="font-semibold">Invite an agent</h2>
  <p className="text-sm text-muted-foreground">Choose an active account and Discord. The recipient chooses their own handle after sign-in. Links expire after 24 hours and work once. Activate signed-up accounts before inviting them.</p>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{setLink('');const result=await request('/api/invitations',{account_id:account,discord_id:discord});setLink(result.url);await refresh();});}}>
   <Label htmlFor="invite-account">Account</Label><select id="invite-account" className="w-full rounded-md border p-2" value={account} onChange={e=>setAccount(e.target.value)} required disabled={busy}><option value="">Select account</option>{accounts.filter(a=>a.status?a.status==='active':!!a.enabled).map(a=><option key={a.id} value={a.id}>{a.email}</option>)}</select>
   <Label htmlFor="invite-discord">Discord</Label><select id="invite-discord" className="w-full rounded-md border p-2" value={discord} onChange={e=>setDiscord(e.target.value)} required disabled={busy}><option value="">Select Discord</option>{discords.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
   <Button disabled={busy||!account||!discord}>Create invitation</Button>
  </form>
  {link&&<div className="space-y-2"><Label htmlFor="invite-link">Invitation link — copy before leaving</Label><Input id="invite-link" readOnly value={link}/><p className="text-sm">Share only with the intended account. This is an invitation, not its wake token.</p><Button variant="outline" onClick={()=>setLink('')}>Hide link</Button></div>}
  {error&&<p role="alert">{error}</p>}<Button variant="outline" disabled={busy} onClick={()=>void run(refresh)}>Refresh invitations</Button>
  {items.length>0&&<ul className="space-y-3">{items.map(i=><li key={i.id} className="flex flex-wrap items-center gap-3 border-t pt-3"><span>{i.dot?'@'+i.dot:'Handle chosen by recipient'} · {i.email} · {i.status} · {new Date(i.expires).toLocaleString()}</span>{i.status==='pending'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>{await request('/api/invitations',{id:i.id},'DELETE');setLink('');await refresh();})}>Revoke invitation</Button>}</li>)}</ul>}
 </section>;
}
