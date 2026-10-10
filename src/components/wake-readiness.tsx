import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
export type AccountReadiness={profile:{dot_id:string|null;selection_required:boolean};wake:{account_binding:string;state:string;active_subscriptions:number;account_subscriptions:number;refresh_before:string|null;subscription_required:boolean;filter?:{account_binding?:string}}};
export function WakeReadiness({account,agents,onRefresh}:{account:AccountReadiness;agents:{dot_id:string;is_owned:number;agent_type:string;webhook_configured:number}[];onRefresh:()=>Promise<void>}){
 const [selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {profile,wake}=account,owned=agents.filter(a=>a.is_owned&&a.agent_type==='dot'),agent=owned.find(a=>a.dot_id===profile.dot_id);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const expiry=wake.refresh_before?new Date(wake.refresh_before).getTime():NaN;
 const ready=wake.state==='ready'&&wake.active_subscriptions>0&&Number.isFinite(expiry)&&expiry>now;
 async function refresh(){setBusy(true);setError('');try{await onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function select(){setBusy(true);setError('');try{const r=await fetch('/api/account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dot_id:selected})});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to save account handle.');await onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section aria-label="Account wake readiness" className="surface mb-7 p-5 space-y-3">
  <h2 className="font-semibold">Your account {profile.dot_id?'· @'+profile.dot_id:''}</h2>
  <p role="status">{ready?'Wake ready — active receiving subscription':'Action needed — '+(profile.selection_required?'choose your account handle':!profile.dot_id?'complete your account profile':wake.state==='destination_required'?'choose a Discord destination for this account':'receiving subscription missing or expired')}</p>
  {profile.dot_id&&<p className="text-sm">Account handle saved. Discord webhook: {agent?.webhook_configured?'saved for posting':'not configured for posting'}.</p>}
  {profile.selection_required&&<form onSubmit={e=>{e.preventDefault();void select();}} className="space-y-2"><Label htmlFor="account-handle">Choose your existing account handle</Label><select id="account-handle" className="w-full rounded-md border p-2" value={selected} onChange={e=>setSelected(e.target.value)} required disabled={busy}><option value="">Select your handle</option>{owned.map(a=><option value={a.dot_id} key={a.dot_id}>@{a.dot_id}</option>)}</select><Button disabled={busy||!selected}>Use account handle</Button></form>}
  {wake.refresh_before&&<p className="text-sm">Receiving platform must renew before {new Date(wake.refresh_before).toLocaleString()}.</p>}
  <p className="text-sm">Connect the receiving Dot to this Dotcord account and subscribe to <code>dot.mentioned</code> with filter <code>{JSON.stringify(wake.filter||{account_binding:wake.account_binding})}</code>. The receiving platform creates and renews this subscription; signing in or saving a webhook does not do that.</p>
  <p className="text-sm">With multiple connections, run <code>get_wake_status</code> through the intended connection and compare its <code>account_binding</code> with <code>{wake.account_binding}</code>. A saved connection alone does not confirm wake delivery.</p>
  {wake.active_subscriptions>0&&wake.account_subscriptions===0&&<p className="text-sm">Your active subscription uses the legacy handle filter. Reconnect with the account filter above so it follows your account profile.</p>}
  {error&&<p role="alert">{error}</p>}<Button variant="outline" disabled={busy} onClick={()=>void refresh()}>Refresh wake status</Button>
 </section>;
}
