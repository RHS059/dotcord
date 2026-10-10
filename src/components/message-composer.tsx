import {useEffect, useRef, useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';

type Agent = {dot_id:string;discord_id:string;webhook_configured:number};
type Discord = {id:string;name:string};
type Outcome = {kind:'sent'|'error'|'uncertain';message:string;url?:string;warning?:string};

export function MessageComposer({agents,discords,loading}:{agents:Agent[];discords:Discord[];loading:boolean}) {
 const [agentId,setAgentId]=useState(''),[message,setMessage]=useState(''),[threadId,setThreadId]=useState('');
 const [sending,setSending]=useState(false),[outcome,setOutcome]=useState<Outcome|null>(null);
 const inFlight=useRef(false);
 const agent=agents.find(a=>a.dot_id===agentId);
 const destination=discords.find(d=>d.id===agent?.discord_id);
 const uncertain=outcome?.kind==='uncertain';
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(sending||uncertain||message){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[sending,uncertain,message]);
 const invalidThread=!!threadId.trim()&&!/^[0-9]{15,22}$/.test(threadId.trim());
 const ready=!!agent&&!!destination&&!!agent.webhook_configured&&!!message.trim()&&message.length<=2000&&!invalidThread;
 async function send(event:React.FormEvent) {
  event.preventDefault();
  // Ref closes the same-render double-click window before React disables Send.
  if(inFlight.current||uncertain||!ready)return;
  inFlight.current=true;setSending(true);setOutcome(null);
  try {
   const response=await fetch('/api/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'post_to_discord',arguments:{dot_id:agentId,text:message,...(threadId.trim()?{thread_id:threadId.trim()}:{})}})});
   let data;
   try {data=await response.json();}catch {setOutcome({kind:'uncertain',message:'Send result is uncertain. Check Discord before trying again.'});return;}
   if(!response.ok||data.error){
    const detail=typeof data.error==='string'?data.error:'Send result is uncertain. Check Discord before trying again.';
    const unknown=response.status>=500||!data.error||/uncertain|did not confirm|operation failed/i.test(detail);
    setOutcome({kind:unknown?'uncertain':'error',message:detail});return;
   }
   if(data.sent!==true){setOutcome({kind:'uncertain',message:'Send result is uncertain. Check Discord before trying again.'});return;}
   const failedMentions=data.mention_delivery?.results?.filter((r:{status:string})=>r.status!=='accepted')||[];
   const warning=data.mention_delivery?.error||(failedMentions.length?'Some mention wakeups were not delivered. Do not resend the message.':undefined);
   const url=typeof data.url==='string'&&/^https:\/\/discord\.com\/channels\/\d{15,22}\/\d{15,22}\/\d{15,22}$/.test(data.url)?data.url:undefined;
   setOutcome({kind:'sent',message:'Message sent.',url,warning});setMessage('');
  }catch {setOutcome({kind:'uncertain',message:'Send result is uncertain. Check Discord before trying again.'});}
  finally {inFlight.current=false;setSending(false);}
 }
 return <section aria-labelledby="composer-title" className="surface mb-7 p-5">
  <h2 id="composer-title" className="mb-4 text-base font-semibold">Send a message</h2>
  <form onSubmit={send} className="space-y-4">
   <div className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2"><Label htmlFor="message-agent">Agent name</Label>
     <Select value={agentId} onValueChange={setAgentId} disabled={loading||sending||uncertain||!agents.length}>
      <SelectTrigger id="message-agent" className="w-full"><SelectValue placeholder={loading?'Loading agents…':'Select your agent'}/></SelectTrigger>
      <SelectContent>{agents.map(a=><SelectItem key={a.dot_id} value={a.dot_id}>@{a.dot_id}</SelectItem>)}</SelectContent>
     </Select>
     {destination&&<p className="text-sm text-muted-foreground">Discord: {destination.name}</p>}
     {!loading&&!agents.length&&<p className="text-sm text-muted-foreground">Add an agent to send messages.</p>}
     {agent&&(!destination||!agent.webhook_configured)&&<p className="text-sm text-muted-foreground">Set this agent’s Discord destination and webhook before sending.</p>}
    </div>
    <div className="space-y-2"><Label htmlFor="message-thread">Thread ID (optional)</Label><Input id="message-thread" inputMode="numeric" value={threadId} disabled={sending||uncertain} onChange={e=>setThreadId(e.target.value)} aria-describedby="message-thread-help" aria-invalid={invalidThread}/><p id="message-thread-help" className="text-sm text-muted-foreground">For replies in an existing Discord thread. Leave blank to post to the selected destination.</p>{invalidThread&&<p role="alert" className="text-sm text-destructive">Enter a thread ID with 15–22 digits.</p>}</div>
   </div>
   <div className="space-y-2"><Label htmlFor="message-body">Message</Label><textarea id="message-body" rows={3} maxLength={2000} value={message} disabled={sending||uncertain} onChange={e=>setMessage(e.target.value)} aria-describedby="message-count" className="w-full min-h-24 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"/><p id="message-count" className="text-sm text-muted-foreground">{message.length} / 2000</p></div>
   <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!ready||sending||uncertain}>{sending&&<Loader2 className="animate-spin"/>}{sending?'Sending…':'Send'}</Button>{uncertain&&<Button type="button" variant="outline" onClick={()=>setOutcome(null)}>I checked Discord</Button>}</div>
   {outcome&&<div role={outcome.kind==='sent'?'status':'alert'} className={'text-sm '+(outcome.kind==='error'?'text-destructive':'text-foreground')}><p>{outcome.message} {outcome.url&&<a href={outcome.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">View in Discord</a>}</p>{outcome.warning&&<p className="mt-1">{outcome.warning}</p>}{uncertain&&<p className="mt-1">No automatic retry was made. If the message is there, clear the draft instead of sending it again.</p>}</div>}
  </form>
 </section>;
}
