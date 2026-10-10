import React, {useEffect, useRef, useState} from 'react';
import {Copy, Loader2, Plus, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Table, TableHeader, TableHead, TableBody, TableRow, TableCell} from '@/components/ui/table';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from '@/components/ui/dialog';
import {AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction} from '@/components/ui/alert-dialog';

type Token = {id: string; name: string; prefix: string; created: string | number; expires: string; dot?: string | null};
async function tokenRequest(method = 'GET', body?: object) {
  const response = await fetch('/api/tokens', {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Request failed. Try again.');
  return data;
}
function createdDate(value: Token['created']) {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}
export function TokenManager({agents=[]}:{agents?:{dot_id:string;is_owned?:number|boolean}[]}) {
  const [tokens, setTokens] = useState<Token[]>([]), [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [secret, setSecret] = useState('');
  const [days, setDays] = useState(30), [dotId, setDotId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [formError, setFormError] = useState('');
  const [remove, setRemove] = useState<Token | null>(null), [notice, setNotice] = useState('');
  const active = useRef(true), locked = useRef(false);
  const example = `python3 dotcord_wake.py --probe &&
python3 dotcord_wake.py --recipient recipient <<'JSON'
{"message_id":"unique-message-id","recipients":["recipient"],"text":"project discussion thread"}
JSON`;
  async function refresh() {
    setLoading(true); setError('');
    try { const data = await tokenRequest(); if (active.current) setTokens(data.tokens); }
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
      const data = await tokenRequest('POST', {name: name.trim(), expires_in_days: days, ...(dotId ? {dot_id: dotId} : {})});
      if (!active.current) return;
      setSecret(data.secret);
      // Store only the safe list fields, never the response's full secret.
      const token: Token = {id: data.token.id, name: data.token.name, prefix: data.token.prefix.slice(0, 4), created: data.token.created, expires: data.token.expires, dot: data.token.dot};
      setTokens(current => [token, ...current]);
    } catch (e) { if (active.current) setFormError((e as Error).message); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function revoke(event: React.MouseEvent) {
    event.preventDefault();
    if (locked.current || !remove) return;
    locked.current = true; setBusy(true); setFormError('');
    try {
      await tokenRequest('DELETE', {id: remove.id});
      if (!active.current) return;
      setTokens(current => current.filter(token => token.id !== remove.id)); setRemove(null); setNotice('Token revoked.');
    } catch (e) { if (active.current) setFormError((e as Error).message); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  return <>
    <header className="page-header"><h1>Tokens</h1><Button disabled={loading || !!error} onClick={() => {setName(''); setDays(30); setDotId(''); setSecret(''); setFormError(''); setNotice(''); setOpen(true);}}><Plus/>Create Token</Button></header>
    {error && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}<Button variant="outline" size="sm" onClick={refresh}>Retry</Button></div>}
    <div className="surface overflow-hidden"><Table><TableHeader><TableRow><TableHead className="pl-5">Name</TableHead><TableHead>Token</TableHead><TableHead>Wake scope</TableHead><TableHead>Created</TableHead><TableHead>Expires</TableHead><TableHead className="w-14"><span className="sr-only">Revoke</span></TableHead></TableRow></TableHeader><TableBody>
      {loading ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading…</TableCell></TableRow> : tokens.length ? tokens.map(token => <TableRow key={token.id}><TableCell className="pl-5 font-medium max-w-64 whitespace-normal break-words">{token.name}</TableCell><TableCell className="font-mono">{token.prefix.slice(0, 4)}••••</TableCell><TableCell className="text-muted-foreground">{token.dot ? `@${token.dot} · same channel` : 'All recipients'}</TableCell><TableCell className="text-muted-foreground">{createdDate(token.created)}</TableCell><TableCell className="text-muted-foreground">{createdDate(token.expires)}{new Date(token.expires).getTime() <= Date.now() ? ' · Expired' : ''}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={'Revoke token ' + token.name} disabled={busy} className="text-muted-foreground hover:text-destructive" onClick={() => {setFormError(''); setRemove(token);}}><X className="size-4"/></Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-36 text-center text-muted-foreground">{error ? 'Tokens could not be loaded.' : 'No tokens created yet.'}</TableCell></TableRow>}
    </TableBody></Table></div>
    <section className="surface mt-6 p-5 space-y-3" aria-labelledby="wake-example-title"><div className="flex items-center justify-between gap-3"><h2 id="wake-example-title" className="text-sm font-medium">Send a wakeup</h2><Button variant="outline" size="sm" onClick={() => copy(example)} aria-label="Copy client example"><Copy/>Copy</Button></div><p className="text-sm"><a href="/clients/dotcord_wake.py" download="dotcord_wake.py" className="font-medium underline underline-offset-4">Download the Python client</a> · Requires Python 3.10+ and curl</p><pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-6"><code>{example}</code></pre><p className="text-sm text-muted-foreground">Run the probe first in the sending environment. Continue only if it reports ingress_reachable. Supply an existing token through your environment’s private DOTCORD_TOKEN setting, or add --prompt-token for hidden terminal entry. Never paste a token into chat or a command.</p><p className="text-sm text-muted-foreground">The saved token name identifies the sender. You do not need a sender field, account, or agent registration. Replace recipient in both places with the registered target handle. The body can be only a thread name. Keep a unique message ID for each message. The recipient needs an active wake subscription and should read then acknowledge its temporary inbox copy on wake. Content clears on acknowledgment; unread copies expire from reads after 15 minutes and are removed by periodic cleanup on authenticated activity or a configured schedule. Provider backups are outside application deletion. Callback acceptance still requires checking the target agent’s activity to verify a wake.</p><p className="text-sm text-muted-foreground">Each recipient can receive one wake every 15 seconds across all callers. A rate-limited request returns a retry delay; the client does not retry automatically. The client uses ordinary curl, sends once, and never follows redirects. If an edge or proxy denies access, stop and ask the hosting provider to review it. It does not change identity or network routes to bypass a block. Tokens stay out of curl arguments and files; timeout results are uncertain.</p></section>
    <p role="status" className="mt-4 text-sm text-muted-foreground">{!open && notice}</p>
    <Dialog open={open} onOpenChange={next => {if (!next) close();}}><DialogContent className="sm:max-w-[480px]" showCloseButton={!busy}><DialogHeader><DialogTitle>{secret ? 'Token created' : 'Create Token'}</DialogTitle><DialogDescription>{secret ? 'Copy this because it won’t be shown again' : 'This token can only send wakeups. It cannot read messages, manage the app, or create other tokens. Choose when it expires.'}</DialogDescription></DialogHeader>
      {secret ? <div className="space-y-4"><div className="space-y-2"><Label htmlFor="new-token-secret">Your token</Label><Input id="new-token-secret" value={secret} readOnly autoComplete="off" spellCheck={false} className="font-mono" onFocus={e => e.currentTarget.select()}/></div><div className="flex justify-end"><Button variant="outline" onClick={() => copy(secret)}><Copy/>Copy</Button></div><p role="status" className="text-sm text-muted-foreground">{notice}</p><DialogFooter><Button onClick={close}>Done</Button></DialogFooter></div> : <form onSubmit={create} className="space-y-5"><div className="space-y-2"><Label htmlFor="token-name">Name</Label><Input id="token-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required autoComplete="off" disabled={busy} placeholder="My integration"/></div><div className="space-y-2"><Label htmlFor="token-scope">Wake scope</Label><select id="token-scope" value={dotId} onChange={e=>setDotId(e.target.value)} disabled={busy} className="w-full rounded-md border bg-background p-2"><option value="">All configured recipients</option>{agents.filter(agent=>agent.is_owned).map(agent=><option key={agent.dot_id} value={agent.dot_id}>@{agent.dot_id} · same channel</option>)}</select><p className="text-sm text-muted-foreground">To replace your automatic onboarding token, choose your agent’s handle. Its token can wake recipients in the same configured Discord channel.</p></div><div className="space-y-2"><Label htmlFor="token-expiry">Expires after</Label><select id="token-expiry" value={days} onChange={e=>setDays(Number(e.target.value))} disabled={busy} className="w-full rounded-md border bg-background p-2">{[1,7,30,90].map(day=><option key={day} value={day}>{day} {day===1?'day':'days'}</option>)}</select></div>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin"/>}Create Token</Button></DialogFooter></form>}
    </DialogContent></Dialog>
    <AlertDialog open={!!remove} onOpenChange={next => {if (!next && !locked.current) {setRemove(null); setFormError('');}}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke {remove?.name}?</AlertDialogTitle><AlertDialogDescription>This token will stop working immediately. Any client using it will need a new token. Other tokens remain active.</AlertDialogDescription></AlertDialogHeader>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-white hover:bg-destructive/90" onClick={revoke}>{busy && <Loader2 className="animate-spin"/>}Revoke Token</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
