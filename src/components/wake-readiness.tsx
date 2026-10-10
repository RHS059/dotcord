import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
export type AccountReadiness={profile:{dot_id:string|null;selection_required:boolean};wake:{account_binding:string;state:string;active_subscriptions:number;account_subscriptions:number;refresh_before:string|null;subscription_required:boolean;filter?:{account_binding?:string}}};
type WakeAgent={dot_id:string;is_owned:number;agent_type:string;webhook_configured:number;can_manage?:number|boolean;discord_id?:string|null};
type TestStatus='accepted'|'partial'|'failed'|'not_subscribed'|'destination_required'|'rate_limited'|'in_progress'|'unknown';
type TestDelivery={handle:string;status:string;attempts:number;inbox_id?:string;inbox_expires_at?:string;retry_after_seconds?:number};
type TestAttempt={request_id:string;message_id?:string;handle:string;status:TestStatus;results:TestDelivery[];replayed?:boolean;audit_warning?:string;receipt_warning?:string;error?:string};
const testStatuses:TestStatus[]=['accepted','partial','failed','not_subscribed','destination_required','rate_limited','in_progress','unknown'];
const unresolved=(attempt?:TestAttempt)=>attempt?.status==='unknown'||attempt?.status==='in_progress';
const testSummary:Record<TestStatus,string>={
 accepted:'Test notification accepted by the receiving callback.',
 partial:'Some receiving callbacks accepted the test; others did not.',
 failed:'No callback acceptance was confirmed for this test.',
 not_subscribed:'No active receiving subscription. Connect or renew the receiving Dot’s subscription, then start a new test.',
 destination_required:'Choose a saved Discord destination for this Dot, then start a new test.',
 rate_limited:'This recipient is rate limited. Wait before starting a new test.',
 in_progress:'This test is still in progress. Check its result using the same request.',
 unknown:'The test result is unknown. Check the same request before starting another test.'
};
function deliveryDescription(result:TestDelivery){
 const descriptions:Record<string,string>={
  accepted:'Receiving callback accepted the notification.',
  gone:'Receiving callback is gone. Reconnect or renew the receiving subscription.',
  oversized:'Receiving callback rejected the payload size. Check the receiving integration.',
  transient:'Receiving callback temporarily failed. Check the receiving platform before starting a new test.',
  rejected:'Receiving callback rejected delivery. Verify the receiving connection and subscription.',
  inactive:'Account or subscription is inactive. Check account access and renew the receiving subscription.',
  not_subscribed:'Connect or renew the receiving Dot’s subscription.',
  destination_required:'Choose this Dot’s saved Discord destination.',
  rate_limited:typeof result.retry_after_seconds==='number'?`Wait at least ${Math.ceil(result.retry_after_seconds)} seconds before a new test.`:'Wait before starting a new test.',
  inbox_full:'Recipient inbox is full. Read and acknowledge pending messages before a new test.',
  inbox_unavailable:'Temporary inbox storage is unavailable. Check the service before a new test.',
  already_acknowledged:'This message was already acknowledged; no new callback was sent.',
  message_conflict:'Message ID conflict. Check the existing test and receiving agent before a new test.'
 };
 return descriptions[result.status]||'Check the receiving platform and this test’s message ID before a new test.';
}
function validTestResponse(data:unknown,requestId:string,handle:string):data is TestAttempt{
 if(!data||typeof data!=='object')return false;
 const value=data as TestAttempt;
 return value.request_id===requestId&&value.handle===handle&&typeof value.message_id==='string'&&testStatuses.includes(value.status)&&Array.isArray(value.results)&&value.results.every(r=>r&&r.handle===handle&&typeof r.status==='string'&&Number.isInteger(r.attempts)&&r.attempts>=0);
}
export function WakeReadiness({account,agents,onRefresh}:{account:AccountReadiness;agents:WakeAgent[];onRefresh:()=>Promise<void>}){
 const [selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {profile,wake}=account,owned=agents.filter(a=>a.is_owned&&a.agent_type==='dot'),agent=owned.find(a=>a.dot_id===profile.dot_id);
 const testAgents=agents.filter(a=>a.agent_type==='dot'&&(a.is_owned||a.can_manage));
 const [testSelected,setTestSelected]=useState(''),[testBusy,setTestBusy]=useState(false),[newTestFor,setNewTestFor]=useState(''),[attempts,setAttempts]=useState<Record<string,TestAttempt>>({});
 // Keep unresolved requests per recipient only in this mounted component. Switching
 // recipients or tabs must not silently turn a result check into another delivery.
 const attemptsRef=useRef<Record<string,TestAttempt>>({}),testInFlight=useRef(false);
 const testHandle=testAgents.some(a=>a.dot_id===testSelected)?testSelected:testAgents.some(a=>a.dot_id===profile.dot_id)?profile.dot_id!:'';
 const testAgent=testAgents.find(a=>a.dot_id===testHandle),attempt=attempts[testHandle],checkResult=unresolved(attempt);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const hasUnresolved=Object.values(attempts).some(unresolved);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(testBusy||hasUnresolved){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[testBusy,hasUnresolved]);
 const expiry=wake.refresh_before?new Date(wake.refresh_before).getTime():NaN;
 const ready=wake.state==='ready'&&wake.active_subscriptions>0&&Number.isFinite(expiry)&&expiry>now;
 async function refresh(){setBusy(true);setError('');try{await onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function select(){setBusy(true);setError('');try{const r=await fetch('/api/account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dot_id:selected})});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to save account handle.');await onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function testWake(forceNew=false){
  // A ref closes the same-render double-click window before React disables the UI.
  if(testInFlight.current||!testAgent)return;
  const previous=attemptsRef.current[testHandle],checking=!forceNew&&unresolved(previous);
  const requestId=checking?previous.request_id:`${Date.now()}_${crypto.randomUUID()}`;
  const current:TestAttempt={request_id:requestId,handle:testHandle,status:'in_progress',results:[],...(checking?previous:{})};
  const save=(next:TestAttempt)=>{attemptsRef.current={...attemptsRef.current,[testHandle]:next};setAttempts(attemptsRef.current);};
  testInFlight.current=true;setTestBusy(true);save(current);
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),60000);
  try{
   const response=await fetch('/api/test-wake',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({dot_id:testHandle,request_id:requestId}),signal:controller.signal});
   let data;try{data=await response.json();}catch{save({...current,status:'unknown'});return;}
   if(validTestResponse(data,requestId,testHandle)){save(data);return;}
   const detail=typeof data?.error==='string'?data.error:undefined;
   // A later authentication error cannot settle an earlier uncertain delivery.
   save({...current,status:!response.ok&&response.status<500&&detail&&!checking?'failed':'unknown',error:detail});
  }catch{save({...current,status:'unknown'});}
  finally{window.clearTimeout(timeout);testInFlight.current=false;setTestBusy(false);}
 }
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
  <div aria-labelledby="test-wake-title" className="space-y-3 border-t pt-4">
   <h3 id="test-wake-title" className="font-medium">Test a receiving subscription</h3>
   <p id="test-wake-help" className="text-sm text-muted-foreground">Sends a real test notification through the selected Dot’s saved receiving subscription without posting to Discord. It does not create or renew a subscription.</p>
   <div className="space-y-2"><Label htmlFor="test-wake-recipient">Test recipient</Label><select id="test-wake-recipient" className="w-full rounded-md border p-2" value={testHandle} onChange={e=>{if(!testInFlight.current){setTestSelected(e.target.value);setNewTestFor('');}}} disabled={testBusy||!testAgents.length} aria-describedby="test-wake-help"><option value="">Select a Dot handle</option>{testAgents.map(a=><option key={a.dot_id} value={a.dot_id}>@{a.dot_id}{a.dot_id===profile.dot_id?' (your account)':''}</option>)}</select></div>
   {!testAgents.length&&<p className="text-sm">Add your Dot handle or choose a Dot you administer before testing.</p>}
   {testAgent&&testAgent.discord_id===null&&<p className="text-sm">This Dot needs a saved Discord destination before delivery can succeed.</p>}
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={testBusy||!testAgent} onClick={()=>void testWake()}>{testBusy?'Checking test…':checkResult?'Check test result':'Test wake'}</Button>{attempt?.status==='unknown'&&<Button type="button" variant="outline" disabled={testBusy} onClick={()=>setNewTestFor(testHandle)}>Start a new test</Button>}</div>
   {newTestFor===testHandle&&attempt?.status==='unknown'&&<div role="alert" className="space-y-2 text-sm"><p>The earlier notification may already have been delivered. Check the receiving Dot first. Starting a new test uses a new request ID and may send another notification.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={testBusy} onClick={()=>setNewTestFor('')}>Cancel new test</Button><Button type="button" disabled={testBusy} onClick={()=>{setNewTestFor('');void testWake(true);}}>Send another test</Button></div></div>}
   {attempt&&<div aria-label="Test wake result" aria-live="polite" role={attempt.status==='accepted'||attempt.status==='in_progress'?'status':'alert'} className="space-y-2 text-sm">
    <p>{testBusy?'Waiting for the test result…':testSummary[attempt.status]}</p>
    {attempt.error&&<p>{attempt.error}</p>}
    <p>Agent execution is not confirmed. Verify the matching message ID in the receiving Dot’s activity.</p>
    {!!attempt.results.length&&<ul className="list-disc space-y-2 pl-5">{attempt.results.map((result,index)=><li key={index}><p>@{result.handle}: {result.status}. {deliveryDescription(result)} {result.attempts} callback {result.attempts===1?'attempt':'attempts'}.</p>{result.inbox_id&&<p className="break-all">Inbox ID: {result.inbox_id}</p>}{result.inbox_expires_at&&<p>Inbox readable until {new Date(result.inbox_expires_at).toLocaleString()}. The recipient can read and acknowledge it.</p>}</li>)}</ul>}
    {attempt.status==='partial'&&<p>Do not repeat this test just for the failed callbacks; accepted callbacks already received it.</p>}
    {attempt.audit_warning&&<p>The audit record could not be completed. Do not repeat a delivered test just to repair the audit.</p>}
    {attempt.receipt_warning&&<p>The test result could not be fully saved. Check the receiving agent before starting another test.</p>}
    {attempt.replayed&&<p>Showing the same test request; this check does not create a new test.</p>}
    {checkResult&&<p>No automatic retry was made. “Check test result” uses the same request ID. Keep this page open to retain it.</p>}
    <p className="break-all">Request ID: {attempt.request_id}</p>
    {attempt.message_id&&<p className="break-all">Message ID: {attempt.message_id}</p>}
   </div>}
  </div>
 </section>;
}
