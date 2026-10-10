import React, {useEffect, useRef, useState} from 'react';
import {Copy, Loader2, Plus, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Table, TableHeader, TableHead, TableBody, TableRow, TableCell} from '@/components/ui/table';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from '@/components/ui/dialog';
import {AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction} from '@/components/ui/alert-dialog';

type Receiver = {id: string; name: string; created: string | number; expires: string};
async function receiverRequest(method = 'GET', body?: object) {
  const response = await fetch('/api/receivers', {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Request failed. Try again.');
  return data;
}
function createdDate(value: Receiver['created']) {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}
export function ReceiverManager() {
  const [receivers, setReceivers] = useState<Receiver[]>([]), [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [secret, setSecret] = useState('');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [formError, setFormError] = useState('');
  const [remove, setRemove] = useState<Receiver | null>(null), [notice, setNotice] = useState('');
  const active = useRef(true), locked = useRef(false);
  async function refresh() {
    setLoading(true); setError('');
    try { const data = await receiverRequest(); if (!Array.isArray(data.receivers)) throw new Error('Receiver credentials could not be loaded.'); if (active.current) setReceivers(data.receivers); }
    catch (e) { if (active.current) setError((e as Error).message); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, []);
  function close() {
    if (locked.current) return;
    setOpen(false); setSecret(''); setName(''); setFormError(''); setNotice('');
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); if (active.current) setNotice('Copied.'); }
    catch { if (active.current) setNotice('Copy failed. Select and copy the text manually.'); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || !name.trim()) return;
    locked.current = true; setBusy(true); setFormError(''); setNotice('');
    try {
      const data = await receiverRequest('POST', {name: name.trim(), expires_in_days: days});
      if (!active.current) return;
      setSecret(data.secret);
      // Store only the safe list fields, never the response's full secret.
      const receiver: Receiver = {id: data.receiver.id, name: data.receiver.name, created: data.receiver.created, expires: data.receiver.expires};
      setReceivers(current => [receiver, ...current]);
    } catch (e) { if (active.current) setFormError((e as Error).message); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function revoke(event: React.MouseEvent) {
    event.preventDefault();
    if (locked.current || !remove) return;
    locked.current = true; setBusy(true); setFormError('');
    try {
      await receiverRequest('DELETE', {id: remove.id});
      if (!active.current) return;
      setReceivers(current => current.filter(receiver => receiver.id !== remove.id)); setRemove(null); setNotice('Receiver credential revoked.');
    } catch (e) { if (active.current) setFormError((e as Error).message); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  return <>
    <section className="surface mt-7 p-5 space-y-3" aria-label="Wake receiver credentials"><header className="flex items-center justify-between gap-3"><h2 className="font-semibold">Wake receiver credentials</h2><Button disabled={loading || !!error} onClick={() => {setName(''); setDays(30); setSecret(''); setFormError(''); setNotice(''); setOpen(true);}}><Plus/>Create Credential</Button></header><p className="text-sm text-muted-foreground">Pair a dedicated Dotcord receiver app with this account. Store its credential privately in that receiver’s settings. Pairing alone does not enable live wakes; the receiving platform must establish its wake subscription.</p>
    {error && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}<Button variant="outline" size="sm" onClick={refresh}>Retry</Button></div>}
    <div className="surface overflow-hidden"><Table><TableHeader><TableRow><TableHead className="pl-5">Name</TableHead><TableHead>Credential</TableHead><TableHead>Created</TableHead><TableHead>Expires</TableHead><TableHead className="w-14"><span className="sr-only">Revoke</span></TableHead></TableRow></TableHeader><TableBody>
      {loading ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Loading…</TableCell></TableRow> : receivers.length ? receivers.map(receiver => <TableRow key={receiver.id}><TableCell className="pl-5 font-medium max-w-64 whitespace-normal break-words">{receiver.name}</TableCell><TableCell className="font-mono">••••••••</TableCell><TableCell className="text-muted-foreground">{createdDate(receiver.created)}</TableCell><TableCell className="text-muted-foreground">{createdDate(receiver.expires)}{new Date(receiver.expires).getTime() <= Date.now() ? ' · Expired' : ''}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={'Revoke receiver ' + receiver.name} disabled={busy} className="text-muted-foreground hover:text-destructive" onClick={() => {setFormError(''); setRemove(receiver);}}><X className="size-4"/></Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-36 text-center text-muted-foreground">{error ? 'Receivers could not be loaded.' : 'No receiver credentials created yet.'}</TableCell></TableRow>}
    </TableBody></Table></div>
    <p role="status" className="mt-4 text-sm text-muted-foreground">{!open && notice}</p>
    <Dialog open={open} onOpenChange={next => {if (!next) close();}}><DialogContent className="sm:max-w-[480px]" showCloseButton={!busy}><DialogHeader><DialogTitle>{secret ? 'Receiver credential created' : 'Create Credential'}</DialogTitle><DialogDescription>{secret ? 'Copy this because it won’t be shown again' : 'This credential lets a dedicated receiver manage wake subscriptions for your account. Choose when it expires.'}</DialogDescription></DialogHeader>
      {secret ? <div className="space-y-4"><div className="space-y-2"><Label htmlFor="new-receiver-secret">Receiver credential</Label><Input id="new-receiver-secret" value={secret} readOnly autoComplete="off" spellCheck={false} className="font-mono" onFocus={e => e.currentTarget.select()}/></div><div className="flex justify-end"><Button variant="outline" onClick={() => copy(secret)}><Copy/>Copy</Button></div><p role="status" className="text-sm text-muted-foreground">{notice}</p><DialogFooter><Button onClick={close}>Done</Button></DialogFooter></div> : <form onSubmit={create} className="space-y-5"><div className="space-y-2"><Label htmlFor="receiver-name">Name</Label><Input id="receiver-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required autoComplete="off" disabled={busy} placeholder="My integration"/></div><div className="space-y-2"><Label htmlFor="receiver-expiry">Expires after</Label><select id="receiver-expiry" value={days} onChange={e=>setDays(Number(e.target.value))} disabled={busy} className="w-full rounded-md border bg-background p-2">{[1,7,30,90].map(day=><option key={day} value={day}>{day} {day===1?'day':'days'}</option>)}</select></div>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin"/>}Create Credential</Button></DialogFooter></form>}
    </DialogContent></Dialog>
    <AlertDialog open={!!remove} onOpenChange={next => {if (!next && !locked.current) {setRemove(null); setFormError('');}}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke {remove?.name}?</AlertDialogTitle><AlertDialogDescription>This credential will stop working immediately. Its registered wake subscriptions will stop receiving new deliveries. Pair the receiver again with a new credential to restore access.</AlertDialogDescription></AlertDialogHeader>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-white hover:bg-destructive/90" onClick={revoke}>{busy && <Loader2 className="animate-spin"/>}Revoke Credential</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section></>;
}
