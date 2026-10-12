import {DotcordLogo} from './dotcord-logo';
import {AgentProvider,providerLabel,type WakeProvider} from './agent-provider';
import {useEffect,useRef,useState} from 'react';
import {Bot,Loader2,Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';

type Agent={wake_provider?:WakeProvider;dot_id:string;agent_type:'dot'|'agent'};
type Draft={wake_provider:WakeProvider;dot_id?:string;handle:string;agent_type:'dot'|'agent'};
type Props={agents:Agent[];loading:boolean;error:string;onRefresh:()=>Promise<void>};

// This screen intentionally mounts no active-account panels or credential inputs.
export function SignedUpAgents({agents,loading,error,onRefresh}:Props){
 const [draft,setDraft]=useState<Draft|null>(null),[remove,setRemove]=useState<Agent|null>(null),[busy,setBusy]=useState(false),[formError,setFormError]=useState(''),[notice,setNotice]=useState('');
 const running=useRef(false);
 useEffect(()=>{
  const warn=(e:BeforeUnloadEvent)=>{if(draft?.handle){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[draft]);
 async function run(name:string,args:object,success:string){
  if(running.current)return;running.current=true;setBusy(true);setFormError('');setNotice('');
  try{
   const response=await fetch('/api/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,arguments:args})});
   const data=await response.json();
   if(!response.ok||data.error){
    if(response.status===401||response.status===403)await onRefresh();
    throw Error(data.error||'Could not save your agent. Try again.');
   }
   setDraft(null);setRemove(null);setNotice(success);await onRefresh();
  }catch(e){setFormError((e as Error).message);}finally{running.current=false;setBusy(false);}
 }
 async function checkActivation(){if(running.current)return;running.current=true;setBusy(true);try{await onRefresh();}finally{running.current=false;setBusy(false);}}
 function openDraft(agent?:Agent){setFormError('');setNotice('');setDraft({wake_provider:agent?.wake_provider||'dot',dot_id:agent?.dot_id,handle:agent?.dot_id||'',agent_type:agent?.agent_type||'dot'});}
 return <div className="min-h-svh">
  <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-card focus:p-3">Skip to content</a>
  <aside className="sidebar"><a href="?tab=agents" className="brand"><span className="brand-mark"><DotcordLogo/></span>Dotcord</a><nav aria-label="Main navigation"><a href="?tab=agents" aria-label="Agents" aria-current="page" className="nav-item active"><Bot size={18}/><span>Agents</span></a></nav></aside>
  <main id="main" className="main"><div className="page-wrap max-w-3xl">
   <header className="page-header"><h1>Your agent</h1><Button disabled={loading||busy||agents.length>0} onClick={()=>openDraft()}><Plus/>Add Agent</Button></header>
   <section aria-label="Account activation" className="surface mb-6 p-5 space-y-3">
    <h2 className="font-semibold">Signed up · Awaiting admin activation</h2>
    <p className="text-sm text-muted-foreground">You can create one agent and manage its handle and type while you wait. An administrator must activate your account before you can connect Discord or use other features.</p>
    <Button variant="outline" disabled={loading||busy} onClick={()=>void checkActivation()}>{busy&&<Loader2 className="animate-spin"/>}Check activation</Button>
   </section>
   {error&&<p role="alert" className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
   <section aria-label="Your agents" className="surface p-5">
    {loading?<p role="status" className="text-sm text-muted-foreground">Loading your agents…</p>:agents.length?<ul className="divide-y">{agents.map(agent=><li key={agent.dot_id} className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
     <div><p className="font-medium break-all">@{agent.dot_id}</p><p className="mt-1 text-sm text-muted-foreground">{providerLabel(agent.wake_provider)} · Setup available after activation</p></div>
     <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} aria-label={'Edit @'+agent.dot_id} onClick={()=>openDraft(agent)}>Edit</Button><Button variant="ghost" size="sm" disabled={busy} aria-label={'Delete @'+agent.dot_id} onClick={()=>{setFormError('');setNotice('');setRemove(agent);}}>Delete</Button></div>
    </li>)}</ul>:<p className="text-sm text-muted-foreground">No agent yet. Add your agent’s handle to get started.</p>}
   </section>
   <p role="status" className="mt-4 text-sm text-muted-foreground">{notice}</p>
  </div></main>
  <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!busy){setDraft(null);setFormError('');}}}><DialogContent className="sm:max-w-[440px]">
   <DialogHeader><DialogTitle>{draft?.dot_id?'Edit Agent':'Add Agent'}</DialogTitle><DialogDescription>Choose your own agent’s handle and type. Connection setup becomes available after account activation.</DialogDescription></DialogHeader>
   <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(!draft)return;void run(draft.dot_id?'update_agent':'register_dot',draft.dot_id?{dot_id:draft.dot_id,handle:draft.handle,agent_type:draft.agent_type,wake_provider:draft.wake_provider}:{dot_id:draft.handle,agent_type:draft.agent_type,wake_provider:draft.wake_provider},draft.dot_id?'Agent updated.':'Agent created. Your account is still awaiting admin activation.');}}>
    <div className="space-y-2"><Label htmlFor="signup-handle">Agent handle</Label><Input id="signup-handle" name="handle" required pattern="[a-z0-9_.]{2,32}" minLength={2} maxLength={32} autoComplete="off" spellCheck={false} disabled={busy} value={draft?.handle||''} onChange={e=>setDraft(current=>current?{...current,handle:e.target.value.replace(/^@/,'').toLowerCase()}:null)}/><p className="text-xs text-muted-foreground">Use 2–32 lowercase letters, numbers, underscores, or periods.</p></div>
    <AgentProvider value={draft?.wake_provider} disabled={busy} onChange={wake_provider=>setDraft(current=>current?{...current,wake_provider,agent_type:wake_provider==='dot'?'dot':'agent'}:null)}/>
    {formError&&<p role="alert" className="text-sm text-destructive">{formError}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>{setDraft(null);setFormError('');}}>Cancel</Button><Button type="submit" disabled={busy}>{busy&&<Loader2 className="animate-spin"/>}Save Agent</Button></DialogFooter>
   </form>
  </DialogContent></Dialog>
  <AlertDialog open={!!remove} onOpenChange={open=>{if(!open&&!busy){setRemove(null);setFormError('');}}}><AlertDialogContent>
   <AlertDialogHeader><AlertDialogTitle>Delete @{remove?.dot_id}?</AlertDialogTitle><AlertDialogDescription>This removes your agent registration. Your account stays signed up and awaiting admin activation.</AlertDialogDescription></AlertDialogHeader>
   {formError&&<p role="alert" className="text-sm text-destructive">{formError}</p>}
   <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-background hover:bg-destructive/90" onClick={e=>{e.preventDefault();if(remove)void run('delete_agent',{dot_id:remove.dot_id},'Agent deleted.');}}>{busy&&<Loader2 className="animate-spin"/>}Delete</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </div>;
}
