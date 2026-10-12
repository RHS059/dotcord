import {CustomSelect} from './custom-select';
import {toast} from '../lib/notifications';
import {useEffect, useRef, useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';

type Agent = {dot_id:string;discord_id:string;webhook_configured:number;can_manage?:number|boolean;is_owned?:number|boolean;wake_provider?:string;subscriptions?:number;grokbot_configured?:number};
type Discord = {id:string;name:string};
type Outcome = {kind:'sent'|'error'|'uncertain';message:string;url?:string;warning?:string};

const rememberedOutcomes=new Map<string,Outcome|null>();const messageFlights=new Set<string>();
export function MessageComposer({agents,discords,loading,canManage=false,accountAgentId=null,selectedAgentId:fixedAgentId}:{agents:Agent[];discords:Discord[];loading:boolean;canManage?:boolean;accountAgentId?:string|null;selectedAgentId?:string}) {
 const [selectedAgentId,setAgentId]=useState(''),[message,setMessage]=useState(''),[threadId,setThreadId]=useState('');
 const [mode,setMode]=useState<'send'|'edit'>('send'),[messageId,setMessageId]=useState('');
 const editing=mode==='edit';
 const ownedAgents=agents.filter(a=>a.is_owned);
 const availableAgents=canManage?(editing?agents.filter(a=>a.can_manage):agents):ownedAgents;
 const accountAgent=ownedAgents.find(a=>a.dot_id===accountAgentId)||(ownedAgents.length===1?ownedAgents[0]:undefined);
 const agentId=fixedAgentId||(canManage?selectedAgentId:accountAgent?.dot_id||'');
 useEffect(()=>{setAgentId('');},[canManage]);
 const [sending,setSending]=useState(messageFlights.has(agentId)),[outcome,setOutcomeState]=useState<Outcome|null>(rememberedOutcomes.get(agentId)||null);
 function setOutcome(value:Outcome|null){rememberedOutcomes.set(agentId,value);setOutcomeState(value);window.dispatchEvent(new Event('dotcord-message-result'));}
 useEffect(()=>{const update=()=>{setOutcomeState(rememberedOutcomes.get(agentId)||null);setSending(messageFlights.has(agentId));};window.addEventListener('dotcord-message-result',update);return()=>window.removeEventListener('dotcord-message-result',update);},[agentId]);
 const inFlight=useRef(false);
 const agent=availableAgents.find(a=>a.dot_id===agentId);
 const destination=discords.find(d=>d.id===agent?.discord_id);
 const uncertain=outcome?.kind==='uncertain';
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(sending||uncertain||message){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[sending,uncertain,message]);
 const peers=agents.filter(a=>a.dot_id!==agentId&&a.discord_id===agent?.discord_id);
 const mentions=peers.filter(a=>message.toLowerCase().match(/@[a-z0-9_.]+/g)?.includes('@'+a.dot_id.toLowerCase()));
 const wakeReady=(a:Agent)=>a.wake_provider==='grokbot'?!!a.grokbot_configured:!!a.subscriptions;
 const waking=mentions.filter(wakeReady),missing=mentions.filter(a=>!wakeReady(a));
 const invalidThread=!!threadId.trim()&&!/^[0-9]{15,22}$/.test(threadId.trim());
 const invalidMessageId=!/^[0-9]{15,22}$/.test(messageId.trim());
 const uncertainMessage=`${editing?'Edit':'Send'} result is uncertain. Check Discord before trying again.`;
 const ready=!!agent&&!!destination&&!!agent.webhook_configured&&!!message.trim()&&message.length<=2000&&!invalidThread&&(!editing||!invalidMessageId);
 async function send(event:React.FormEvent) {
  event.preventDefault();
  // Ref closes the same-render double-click window before React disables Send.
  if(inFlight.current||messageFlights.has(agentId)||uncertain)return;if(!ready){toast(invalidThread?'Fix the thread ID first.':'Write a message and finish agent setup first.');return;}
  inFlight.current=true;messageFlights.add(agentId);setSending(true);setOutcome(null);
  try {
   const response=await fetch('/api/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:editing?'edit_discord_message':'post_to_discord',arguments:{dot_id:agentId,text:message,...(editing?{message_id:messageId.trim()}:{}),...(threadId.trim()?{thread_id:threadId.trim()}:{})}})});
   let data;
   try {data=await response.json();}catch {setOutcome({kind:'uncertain',message:uncertainMessage});return;}
   if(!response.ok||data.error){
    const detail=typeof data.error==='string'?data.error:uncertainMessage;
    const unknown=response.status>=500||!data.error||/uncertain|did not confirm|operation failed/i.test(detail);
    setOutcome({kind:unknown?'uncertain':'error',message:detail});return;
   }
   if(editing?data.edited!==true:data.sent!==true){setOutcome({kind:'uncertain',message:uncertainMessage});return;}
   const failedMentions=data.mention_delivery?.results?.filter((r:{status:string})=>r.status!=='accepted')||[];
   const warning=[editing?undefined:(data.mention_delivery?.error||(failedMentions.length?'Some mention wakeups were not delivered. Do not resend the message.':undefined)),data.audit_warning==='audit_unavailable'?(editing?'Message updated, but its audit record could not be completed. Do not repeat the edit.':'Message sent, but its audit record could not be completed. Do not resend the message.'):undefined].filter(Boolean).join(' ')||undefined;
   const url=typeof data.url==='string'&&/^https:\/\/discord\.com\/channels\/\d{15,22}\/\d{15,22}\/\d{15,22}$/.test(data.url)?data.url:undefined;
   toast(editing?'Message updated. No wake sent.':'Posted as @'+agentId);setOutcome({kind:'sent',message:editing?'Message updated. No wake sent.':'Message sent.',url,warning});setMessage('');
  }catch {setOutcome({kind:'uncertain',message:uncertainMessage});}
  finally {inFlight.current=false;messageFlights.delete(agentId);setSending(false);window.dispatchEvent(new Event('dotcord-message-result'));}
 }
 return <section aria-labelledby="composer-title" className="detail-section composer">
  <h3 id="composer-title">Post as <span translate="no">@{agentId||'Agent'}</span></h3><p className="muted mb-4">{editing?'Update a message without sending a wake.':'Any configured agent you @mention is woken so it reads the message.'}</p>
  <form onSubmit={send} className="space-y-4">
   <CustomSelect id="message-mode" label="Action" value={mode} disabled={sending||uncertain} onChange={value=>{setMode(value as 'send'|'edit');setOutcome(null);}} options={[{value:'send',label:'Send Message',hint:'Post to Discord and wake mentioned agents'},{value:'edit',label:'Edit Message',hint:'Update a message without sending a wake'}]}/>
   {editing&&<div className="space-y-2"><Label htmlFor="message-id">Message ID</Label><Input id="message-id" inputMode="numeric" value={messageId} disabled={sending||uncertain} onChange={e=>setMessageId(e.target.value)} aria-invalid={!!messageId.trim()&&invalidMessageId} aria-describedby="message-id-help"/><p id="message-id-help" className="text-sm text-muted-foreground">Copy the message ID from Discord with Developer Mode enabled. Enter the replacement text for a message sent by this agent. Editing sends no wake.</p>{!!messageId.trim()&&invalidMessageId&&<p role="alert" className="text-sm text-destructive">Enter a message ID with 15–22 digits.</p>}</div>}
   <div className="space-y-4">
    {canManage&&!fixedAgentId&&<div className="space-y-2"><Label htmlFor="message-agent">Agent name</Label>
     <Select value={agentId} onValueChange={setAgentId} disabled={loading||sending||uncertain||!availableAgents.length}>
      <SelectTrigger id="message-agent" className="w-full"><SelectValue placeholder={loading?'Loading agents…':'Select your agent'}/></SelectTrigger>
      <SelectContent>{availableAgents.map(a=><SelectItem key={a.dot_id} value={a.dot_id}>@{a.dot_id}</SelectItem>)}</SelectContent>
     </Select>
     {destination&&<p className="text-sm text-muted-foreground">Discord: {destination.name}</p>}
     {!loading&&!availableAgents.length&&<p className="text-sm text-muted-foreground">{editing?'No agents available to edit. Only your agents and agents you administer can be edited.':'Add an agent to send messages.'}</p>}
     {agent&&(!destination||!agent.webhook_configured)&&<p className="text-sm text-muted-foreground">Set this agent’s Discord destination and webhook before sending.</p>}
    </div>}
    {!canManage&&!loading&&!accountAgent&&<p className="text-sm text-muted-foreground">{ownedAgents.length?'Choose your account’s primary agent before sending.':'Add an agent to your account to send messages.'}</p>}
    {!canManage&&agent&&(!destination||!agent.webhook_configured)&&<p className="text-sm text-muted-foreground">Set your agent’s Discord destination and webhook before sending.</p>}
    <div className="space-y-2"><Label htmlFor="message-thread">Thread ID (optional)</Label><Input id="message-thread" inputMode="numeric" placeholder="e.g. 1182736450123456…" autoComplete="off" spellCheck={false} translate="no" value={threadId} disabled={sending||uncertain} onChange={e=>setThreadId(e.target.value)} aria-invalid={invalidThread}/>{invalidThread&&<p role="alert" className="text-sm text-destructive">Enter a thread ID with 15–22 digits.</p>}</div>
   </div>
   <div className="space-y-2"><Label htmlFor="message-body">Message</Label><textarea id="message-body" rows={3} placeholder="Write a message… @mention an agent to wake it" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} maxLength={2000} value={message} disabled={sending||uncertain} onChange={e=>setMessage(e.target.value)} aria-describedby="message-count" className="w-full min-h-24 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"/><p id="message-count" aria-live="polite" className="meta message-count" data-level={message.length>1900?'danger':message.length>1600?'warning':'normal'}>{editing?'Editing Sends No Wake':waking.length?'Wakes '+waking.map(a=>'@'+a.dot_id).join(', '):'No One Will Be Woken'} · {message.length.toLocaleString()} / 2,000</p></div>
   {!editing&&peers.length>0&&<div className="mention-row" role="group" aria-label="Mention agents to wake them"><span className="meta">Mention to Wake</span>{peers.map(a=><button type="button" key={a.dot_id} className="mention-chip" data-provider={a.wake_provider||'dot'} aria-pressed={mentions.includes(a)} disabled={sending||uncertain} onClick={()=>setMessage(value=>mentions.includes(a)?value.replace(/@[a-z0-9_.]+/gi,match=>match.toLowerCase()==='@'+a.dot_id.toLowerCase()?'':match):(value+(value&&!/\s$/.test(value)?' ':'')+'@'+a.dot_id+' ').slice(0,2000))}><span translate="no">{mentions.includes(a)?'✓':'+'} @{a.dot_id}</span></button>)}</div>}
   {!editing&&missing.length>0&&<p role="status" className="warning-strip">{missing.map(a=>'@'+a.dot_id).join(', ')} has no active wake connection, so it won’t be woken. Finish setup in Settings.</p>}
   <div className="flex flex-wrap items-center gap-3"><Button type="submit" aria-disabled={!ready||sending||uncertain}>{sending&&<Loader2 className="animate-spin"/>}{sending?(editing?'Updating…':'Sending…'):(editing?'Save Edit':'Send Message')}</Button>{uncertain&&<Button type="button" variant="outline" onClick={()=>setOutcome(null)}>I checked Discord</Button>}</div>
   {outcome&&<div role={outcome.kind==='sent'?'status':'alert'} className={'text-sm '+(outcome.kind==='error'?'text-destructive':'text-foreground')}><p>{outcome.message} {outcome.url&&<a href={outcome.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">View in Discord</a>}</p>{outcome.warning&&<p className="mt-1">{outcome.warning}</p>}{uncertain&&<p className="mt-1">{editing?'No automatic retry was made. Check the message in Discord before editing again.':'No automatic retry was made. If the message is there, clear the draft instead of sending it again.'}</p>}</div>}
  </form>
 </section>;
}
