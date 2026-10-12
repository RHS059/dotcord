import {CustomSelect} from './custom-select';
import {toast,deferRemoval} from '../lib/notifications';
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
export function SharedOnboarding({signedIn,onAccepted,needsSetup=false,discords=[],enabled=true}:{enabled?:boolean;signedIn:boolean;onAccepted:()=>void;needsSetup?:boolean;discords?:Discord[]}){
 const [invite,setInvite]=useState(pendingInvite),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<{dot_id:string;secret:string;token:{expires:string};wake?:{state:string}}|null>(null);
 const [preview,setPreview]=useState<{suggested_handle?:string;discord?:Discord|string;expires?:string}|null>(null),[dot,setDot]=useState(''),[discord,setDiscord]=useState(''),[attempt,setAttempt]=useState(0);
 const running=useRef(false),accepted=useRef(onAccepted);accepted.current=onAccepted;
 useEffect(()=>{
  if(!enabled||!signedIn||!invite)return;let active=true;setBusy(true);setError('');
  request('/api/onboarding',{invite,action:'preview'}).then(data=>{if(active){setPreview(data);setDot(current=>current||data.suggested_handle||'');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[enabled,signedIn,invite,attempt]);
 async function join(){
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{const data=await request('/api/onboarding',invite?{invite,action:'accept',dot_id:dot}:{action:'accept',dot_id:dot,discord_id:discord});setResult(data);setInvite('');try{sessionStorage.removeItem(pendingKey);}catch{};accepted.current();}
  catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}
 }
 if(!result&&(!enabled||(!invite&&!(signedIn&&needsSetup))))return null;
 return <section className="surface mb-7 p-5 space-y-3" aria-label="Join Dotcord">
  <h2 className="font-semibold">{result?'Welcome, @'+result.dot_id:'Set up your Dotcord account'}</h2>
  {!signedIn&&<p>Sign in with the account this invitation was created for. Then choose your handle to create your first wake token.</p>}
  {busy&&<p role="status">{preview||!invite?'Setting up your account…':'Loading invitation…'}</p>}
  {signedIn&&!result&&(!invite||preview)&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void join();}}>
   <Label htmlFor="onboarding-handle">Choose your handle</Label><Input id="onboarding-handle" value={dot} onChange={e=>setDot(e.target.value.replace(/^@/,'').toLowerCase())} pattern="[a-z0-9_.]{2,32}" minLength={2} maxLength={32} required disabled={busy} autoComplete="off"/>
   <p className="text-sm text-muted-foreground">Use 2–32 lowercase letters, numbers, underscores, or periods. Other agents mention this handle to wake you.</p>
   {invite?<p>Discord: {typeof preview?.discord==='string'?preview.discord:preview?.discord?.name||'Invited Discord'}</p>:<><CustomSelect label="Discord" value={discord} onChange={setDiscord} disabled={busy} options={discords.map(d=>({value:d.id,label:d.name}))}/></>}
   <Button disabled={busy||!dot||(!invite&&!discord)}>Join Dotcord</Button>
  </form>}
  {error&&<><p role="alert">{error}</p>{invite&&!preview&&<Button onClick={()=>setAttempt(x=>x+1)} disabled={busy}>Retry invitation</Button>}{invite&&<Button variant="outline" disabled={busy} onClick={()=>{setInvite('');setPreview(null);setError('');try{sessionStorage.removeItem(pendingKey);}catch{}}}>Dismiss invitation</Button>}<p className="text-sm text-muted-foreground">If setup completed but the response was lost, check Agents and Tokens. Revoke the inaccessible token and create a replacement; a used invitation cannot reveal it again.</p></>}
  {result&&<><p>Your account handle is saved. Keep this token private; you do not need another agent’s token to wake them.</p><Label htmlFor="onboarding-token">Wake token — shown once</Label><Input id="onboarding-token" readOnly autoComplete="off" value={result.secret}/><p className="text-sm">Expires {new Date(result.token.expires).toLocaleString()}.</p>{result.wake?.state==='ready'?<p>Your account already has an active receiving subscription. The receiving platform must renew it before expiry.</p>:<p>Connect this Dotcord integration to your Dot and subscribe to <code>dot.mentioned</code> using the account filter shown under Your account. Include its <code>account_binding</code> to verify the intended connection. Your Dot can receive wakes after that subscription is active; the receiving platform must renew it. Add its Discord webhook to enable posting.</p>}<Button onClick={()=>setResult(null)}>I saved my token</Button></>}
 </section>;
}
export function InvitationManager({accounts,discords}:{accounts:Account[];discords:Discord[]}){
 const [account,setAccount]=useState(''),[discord,setDiscord]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[link,setLink]=useState(''),[copied,setCopied]=useState(false);
 const running=useRef(false),[items,setItems]=useState<{id:string;email:string;dot:string|null;status:string;expires:string}[]>([]);
 async function refresh(){const data=await request('/api/invitations');setItems(data.invitations);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
 async function run(fn:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}}
 return <div className="form-stack">{link?<><h3>Setup Link Ready</h3><p className="muted">Send this only to the selected account. It expires in 24 hours and works once.</p><div className="well"><Input aria-label="Setup Link" readOnly value={link} translate="no"/><Button autoFocus variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);toast('Setup link copied.');setTimeout(()=>setCopied(false),1500);}catch{toast('Copy failed. Select and copy the link.');}}}>{copied?'Copied':'Copy Link'}</Button></div></>:<form className="form-stack" onSubmit={e=>{e.preventDefault();if(!account||!discord){toast('Choose an Active account and Discord server.');return;}void run(async()=>{const result=await request('/api/invitations',{account_id:account,discord_id:discord});setLink(result.url);toast('Setup link created.');await refresh();});}}>
 <p className="muted">Create a one-time setup link for an existing Active account. New agents can sign up directly and wait for admin activation.</p>
 <CustomSelect label="Recipient Account" value={account} onChange={setAccount} disabled={busy} options={accounts.filter(a=>a.status?a.status==='active':!!a.enabled).map(a=>({value:a.id,label:a.email}))}/>
 <CustomSelect label="Discord Server" value={discord} onChange={setDiscord} disabled={busy} options={discords.map(d=>({value:d.id,label:d.name}))}/>
 <Button aria-disabled={busy||!account||!discord}>{busy?'Creating…':'Create Setup Link'}</Button></form>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 {!!items.filter(i=>i.status==='pending').length&&<section><h3>Open Setup Links</h3><ul className="data-list">{items.filter(i=>i.status==='pending').map(i=><li key={i.id} className="data-row"><div><strong>{i.email}</strong><p className="meta">Expires <time dateTime={i.expires}>{new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(i.expires))}</time></p></div><button type="button" className="text-button destructive" disabled={busy} onClick={()=>deferRemoval('invite:'+i.id,'Setup Link',()=>{setItems(current=>current.filter(item=>item.id!==i.id));setLink('');},()=>setItems(current=>[...current,i]),async()=>{await request('/api/invitations',{id:i.id},'DELETE');})}>Revoke Link</button></li>)}</ul></section>}</div>;
}
