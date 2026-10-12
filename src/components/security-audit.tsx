import React, {useState,useRef} from 'react';
import {Button} from '@/components/ui/button';
import {Table, TableHeader, TableHead, TableBody, TableRow, TableCell} from '@/components/ui/table';

type AuditEvent = {id:string;created:string;actor:string;action:string;outcome:string;resource:string;count:number};
export function SecurityAudit() {
 const lock=useRef(false);
 const [rows,setRows]=useState<AuditEvent[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(more=false){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const response=await fetch('/api/audit'+(more&&cursor?'?before='+encodeURIComponent(cursor):''),{credentials:'same-origin',cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Audit could not be loaded.');
  setRows(current=>more?[...current,...data.events]:data.events);setCursor(data.next_cursor);
 }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 return <section className="security-audit space-y-4" aria-labelledby="security-audit-title">
  <div className="flex items-center justify-between"><h2 id="security-audit-title" className="font-medium">Security Audit</h2><Button variant="outline" disabled={busy} onClick={()=>load()}>{busy?'Loading…':'Refresh'}</Button></div>
  <p className="text-sm text-muted-foreground">Recent access decisions, token changes, and wake deliveries. Message content and credentials are excluded. Up to 10,000 events are retained for up to 30 days, with periodic cleanup.</p>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {rows.length>0?<div className="surface"><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Result</TableHead><TableHead>Target</TableHead><TableHead>Count</TableHead></TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.id}><TableCell>{new Date(row.created).toLocaleString()}</TableCell><TableCell className="max-w-48 break-all whitespace-normal font-mono text-xs">{row.actor}</TableCell><TableCell>{row.action}</TableCell><TableCell>{row.outcome}</TableCell><TableCell>{row.resource||'—'}</TableCell><TableCell>{row.count}</TableCell></TableRow>)}</TableBody></Table></div>:<div className="empty-state">{busy?'Loading…':'No events recorded yet.'}</div>}
  {cursor&&<Button variant="outline" disabled={busy} onClick={()=>load(true)}>Load older events</Button>}
 </section>;
}
