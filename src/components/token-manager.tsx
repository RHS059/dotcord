import React, {useEffect, useRef, useState} from 'react';
import {Copy, Loader2, Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from '@/components/ui/dialog';
import {CustomSelect} from './custom-select';
import {toast, deferRemoval} from '../lib/notifications';

type Token = {id: string; name: string; prefix: string; created: string | number; expires: string; dot?: string | null; can_revoke: boolean};
async function tokenRequest(method = 'GET', body?: object) {
  const response = await fetch('/api/tokens', {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Request failed. Try again.');
  return data;
}
function tokenDate(value: Token['created']) {
  return new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
}
function DateValue({value}: {value: Token['created']}) {
  const date = tokenDate(value);
  return Number.isNaN(date.getTime()) ? <>Unknown</> : <time dateTime={date.toISOString()} title={date.toLocaleString()}>{new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(date)}</time>;
}
function ExpiryBadge({value}: {value: string}) {
  const remaining = Math.ceil((tokenDate(value).getTime() - Date.now()) / 86400000);
  if (!Number.isFinite(remaining)) return null;
  return <span className="badge warn-badge">{remaining <= 0 ? 'Expired' : remaining === 1 ? 'in 1 day' : 'in ' + remaining + ' days'}</span>;
}
export function TokenManager({agents = []}: {agents?: {dot_id: string; is_owned?: number | boolean}[]}) {
  const [tokens, setTokens] = useState<Token[]>([]), [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [secret, setSecret] = useState('');
  const [days, setDays] = useState(30), [dotId, setDotId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(true), locked = useRef(false), loadingRef = useRef(false);
  const pendingRemovals = useRef(new Set<string>());
  async function refresh() {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setError('');
    try {
      const data = await tokenRequest();
      if (!Array.isArray(data.tokens)) throw new Error('API tokens could not be loaded.');
      if (active.current) setTokens(data.tokens.filter((token: Token) => !pendingRemovals.current.has(token.id)));
    } catch (e) { if (active.current) setError((e as Error).message); }
    finally { loadingRef.current = false; if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, []);
  function close() {
    if (locked.current) return;
    setOpen(false); setSecret(''); setName(''); setDotId(''); setDays(30); setFormError(''); setNotice('');
  }
  function openToken() {
    if (locked.current) return;
    setName(''); setDays(30); setDotId(''); setSecret(''); setFormError(''); setNotice(''); setOpen(true);
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); if (active.current) {setNotice('Copied.'); toast('Token copied.');} }
    catch { if (active.current) setNotice('Copy failed. Select and copy the text manually.'); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || !name.trim() || secret) return;
    locked.current = true; setBusy(true); setFormError(''); setNotice('');
    try {
      const data = await tokenRequest('POST', {name: name.trim(), expires_in_days: days, ...(dotId ? {dot_id: dotId} : {})});
      if (!active.current) return;
      setSecret(data.secret);
      if (data.audit_warning === 'audit_unavailable') setNotice('Token created, but its audit record could not be completed. Copy this token; do not create another as a retry.');
      // Retain safe list fields only. The full secret belongs exclusively to the one-time dialog.
      const token: Token = {id: data.token.id, name: data.token.name, prefix: data.token.prefix.slice(0, 4), created: data.token.created, expires: data.token.expires, dot: data.token.dot, can_revoke: data.token.can_revoke === true};
      setTokens(current => [token, ...current]);
      toast('API token created. Copy its secret before closing.');
    } catch (e) { if (active.current) setFormError((e as Error).message); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  function revoke(token: Token) {
    if (locked.current || !token.can_revoke || pendingRemovals.current.has(token.id)) return;
    const index = tokens.findIndex(item => item.id === token.id);
    deferRemoval('token:' + token.id, 'Token ' + token.name,
      () => {pendingRemovals.current.add(token.id); setTokens(current => current.filter(item => item.id !== token.id));},
      () => {
        pendingRemovals.current.delete(token.id);
        if (active.current) setTokens(current => {
          if (current.some(item => item.id === token.id)) return current;
          const restored = [...current]; restored.splice(Math.max(0, index), 0, token); return restored;
        });
      },
      async () => {
        const data = await tokenRequest('DELETE', {id: token.id});
        pendingRemovals.current.delete(token.id);
        if (active.current && data.audit_warning === 'audit_unavailable') setNotice('Token revoked, but its audit record could not be completed.');
      });
  }
  return <>
    <header className="page-header"><h1>Tokens</h1><Button disabled={loading || !!error} aria-haspopup="dialog" onClick={openToken}><Plus aria-hidden="true"/>Create Token</Button></header>
    <section aria-labelledby="api-tokens-title" className="list-section">
      <h2 id="api-tokens-title">API Tokens</h2>
      {error && <div role="alert" className="error-banner">{error}<Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>Retry</Button></div>}
      {loading ? <div role="status" className="empty-state">Loading API tokens…</div> : tokens.length ? <ul className="data-list" aria-label="API Tokens">
        {tokens.map(token => <li key={token.id} className="data-row token-row">
          <div className="data-cell"><span className="data-label">Name</span><strong className="break-words">{token.name}</strong></div>
          <div className="data-cell"><span className="data-label">Token</span><span className="font-mono" translate="no" aria-label="Masked token">{token.prefix.slice(0, 4)}••••••••</span></div>
          <div className="data-cell"><span className="data-label">Wake Scope</span><span>{token.dot ? '@' + token.dot + ' · same channel' : 'All recipients'}</span></div>
          <div className="data-cell"><span className="data-label">Created</span><DateValue value={token.created}/></div>
          <div className="data-cell"><span className="data-label">Expires</span><DateValue value={token.expires}/><ExpiryBadge value={token.expires}/></div>
          {token.can_revoke && <div className="data-actions"><Button variant="destructive" size="sm" aria-label={'Revoke token ' + token.name} disabled={busy} onClick={() => revoke(token)}>Revoke</Button></div>}
        </li>)}
      </ul> : <div className="empty-state">{error ? 'API tokens could not be loaded.' : 'No API tokens. Create one to integrate.'}</div>}
      {!open && notice && <p role="status" className="muted">{notice}</p>}
    </section>
    <Dialog open={open} onOpenChange={next => {if (!next) close();}}>
      <DialogContent className="scrollable-dialog sm:max-w-[480px]" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{secret ? 'Token Created' : 'Create Token'}</DialogTitle><DialogDescription>{secret ? 'Copy this because it won’t be shown again.' : 'This token can only send wakeups. It cannot read messages, manage the app, or create other tokens. Choose when it expires.'}</DialogDescription></DialogHeader>
        {secret ? <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="new-token-secret">Your Token</Label><Input id="new-token-secret" value={secret} readOnly autoComplete="off" spellCheck={false} translate="no" className="font-mono" onFocus={e => e.currentTarget.select()}/></div>
          <div className="flex justify-end"><Button variant="outline" onClick={() => void copy(secret)}><Copy aria-hidden="true"/>Copy</Button></div>
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
          <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
        </div> : <form onSubmit={create} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="token-name">Name</Label><Input id="token-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required autoComplete="off" disabled={busy} placeholder="My integration…"/></div>
          <div className="space-y-2"><CustomSelect id="token-scope" label="Wake Scope" value={dotId} onChange={setDotId} disabled={busy} options={[{value: '', label: 'All configured recipients'}, ...agents.filter(agent => agent.is_owned).map(agent => ({value: agent.dot_id, label: '@' + agent.dot_id + ' · same channel'}))]}/><p className="text-sm text-muted-foreground">To replace your onboarding token, choose your agent’s handle. Its token can wake recipients in the same configured Discord channel.</p></div>
          <CustomSelect id="token-expiry" label="Expires After" value={String(days)} onChange={value => setDays(Number(value))} disabled={busy} options={[1, 7, 30, 90].map(day => ({value: String(day), label: day + (day === 1 ? ' day' : ' days')}))}/>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy && <Loader2 aria-hidden="true" className="animate-spin"/>}{busy ? 'Creating…' : 'Create Token'}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
