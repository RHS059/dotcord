import React, {useEffect, useRef, useState} from 'react';
import {Copy, Loader2, Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from '@/components/ui/dialog';
import {CustomSelect} from './custom-select';
import {providerLabel, type WakeProvider} from './agent-provider';
import {toast, deferRemoval} from '../lib/notifications';

type Receiver = {provider?: WakeProvider; dot_id?: string | null; source?: string | null; auth_header?: string | null; needs_configuration?: boolean; can_edit?: boolean; id: string; name: string; created: string | number; expires: string; recipient: {email: string; is_self: boolean}; can_revoke: boolean};
type RecipientAccount = {id: string; email: string; enabled: number; receiver_eligible?: boolean};
type CredentialAgent = {dot_id: string; wake_provider?: WakeProvider; can_manage?: number | boolean; is_owned?: number | boolean};
async function receiverRequest(method = 'GET', body?: object) {
  const response = await fetch('/api/receivers', {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Request failed. Try again.');
  return data;
}
function CredentialDate({value}: {value: Receiver['created']}) {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? <>Unknown</> : <time dateTime={date.toISOString()} title={date.toLocaleString()}>{new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(date)}</time>;
}
function credentialActive(receiver: Receiver) {
  return !receiver.needs_configuration && new Date(receiver.expires).getTime() > Date.now();
}
export function ReceiverManager({canManage = false, accounts = [], agents = []}: {canManage?: boolean; accounts?: RecipientAccount[]; agents?: CredentialAgent[]}) {
  const [receivers, setReceivers] = useState<Receiver[]>([]), [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [secret, setSecret] = useState('');
  const [days, setDays] = useState(30);
  const [editing, setEditing] = useState<Receiver | null>(null), [dotId, setDotId] = useState('');
  const [webhook, setWebhook] = useState(''), [authToken, setAuthToken] = useState(''), [authHeader, setAuthHeader] = useState('Authorization'), [source, setSource] = useState('');
  const [accountId, setAccountId] = useState(''), [recipientLabel, setRecipientLabel] = useState(''), [otherRecipient, setOtherRecipient] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [formError, setFormError] = useState(''), [notice, setNotice] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const active = useRef(true), locked = useRef(false), loadingRef = useRef(false);
  const pendingRemovals = useRef(new Map<string, Receiver>());
  const availableAgents = agents.filter(agent => agent.can_manage || agent.is_owned);
  const selectedAgent = availableAgents.find(agent => agent.dot_id === dotId);
  const provider = selectedAgent?.wake_provider || (dotId === editing?.dot_id ? editing?.provider : undefined) || 'dot';
  const legacyReceivers = receivers.filter(receiver => !receiver.dot_id || !agents.some(agent => agent.dot_id === receiver.dot_id));
  function canEdit(receiver: Receiver) {return !!(receiver.can_edit || receiver.recipient.is_self || canManage);}
  function resetForm() {
    setEditing(null); setDotId(''); setWebhook(''); setAuthToken(''); setAuthHeader('Authorization'); setSource('');
    setSecret(''); setAccountId(''); setRecipientLabel(''); setOtherRecipient(false); setName(''); setDays(30); setFormError(''); setNotice('');
  }
  function openCredential(receiver: Receiver | null = null, agentId = '') {
    if (locked.current || (receiver && (!canEdit(receiver) || pendingRemovals.current.has(receiver.id)))) return;
    const target = receiver?.dot_id || agentId;
    if (!receiver && target && (!availableAgents.some(agent => agent.dot_id === target) || [...pendingRemovals.current.values()].some(item => item.dot_id === target))) return;
    resetForm();
    setEditing(receiver); setName(receiver?.name || (target ? '@' + target + ' wake' : ''));
    setDotId(target); setAuthHeader(receiver?.auth_header || 'Authorization'); setSource(receiver?.source || ''); setOpen(true);
  }
  async function refresh() {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setError('');
    try {
      const data = await receiverRequest();
      if (!Array.isArray(data.receivers)) throw new Error('Wake credentials could not be loaded.');
      if (active.current) setReceivers(data.receivers.filter((receiver: Receiver) => !pendingRemovals.current.has(receiver.id)));
    } catch (e) { if (active.current) setError((e as Error).message); }
    finally { loadingRef.current = false; if (active.current) setLoading(false); }
  }
  useEffect(() => {active.current = true; void refresh(); return () => {active.current = false;};}, []);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{dot_id?: string}>).detail?.dot_id;
      if (!id || loading || error || locked.current || open || !availableAgents.some(agent => agent.dot_id === id)) return;
      const receiver = receivers.find(item => item.dot_id === id);
      openCredential(receiver || null, id);
    };
    window.addEventListener('dotcord:credential', onOpen);
    return () => window.removeEventListener('dotcord:credential', onOpen);
  });
  function close() {
    if (locked.current) return;
    setOpen(false); resetForm();
  }
  async function copy(value: string) {
    try {await navigator.clipboard.writeText(value); if (active.current) {setNotice('Copied.'); toast('Wake credential copied.');}}
    catch {if (active.current) setNotice('Copy failed. Select and copy the text manually.');}
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || !name.trim() || secret) return;
    if (!editing && availableAgents.length > 0 && !dotId) {setFormError('Choose the agent that will receive this credential.'); return;}
    if (dotId && [...pendingRemovals.current.values()].some(item => item.dot_id === dotId)) {setFormError('Wait for the pending revoke, or choose Undo first.'); return;}
    locked.current = true; setBusy(true); setFormError(''); setNotice('');
    try {
      const data = await receiverRequest(editing ? 'PATCH' : 'POST', {
        name: name.trim(), ...(editing ? {id: editing.id} : {expires_in_days: days}),
        ...(dotId ? {dot_id: dotId} : (!editing && canManage && accountId ? {account_id: accountId} : {})),
        ...(provider === 'grokbot' ? {webhook_url: webhook, auth_token: authToken, auth_header: authHeader, source} : {}),
      });
      // Never retain submitted webhook/auth secrets after a successful save.
      setWebhook(''); setAuthToken('');
      if (!active.current) return;
      const recipient = {email: data.recipient?.email || 'Your signed-in account', is_self: data.recipient?.is_self !== false};
      const receiver: Receiver = {
        id: data.receiver.id, name: data.receiver.name, created: data.receiver.created, expires: data.receiver.expires,
        recipient, can_revoke: data.receiver.can_revoke === true, can_edit: data.receiver.can_edit === true,
        provider: data.receiver.provider || provider, dot_id: data.receiver.dot_id,
        source: data.receiver.source, auth_header: data.receiver.auth_header, needs_configuration: data.receiver.needs_configuration === true,
      };
      setReceivers(current => [receiver, ...current.filter(item => item.id !== receiver.id)]);
      const auditNotice = data.audit_warning === 'audit_unavailable' ? 'Credential saved, but its audit record could not be completed. Do not save again just to retry the audit.' : '';
      if (data.secret) {
        setSecret(data.secret); setRecipientLabel(recipient.email); setOtherRecipient(!recipient.is_self); setNotice(auditNotice);
        toast('Wake credential created. Copy its pairing secret before closing.');
      } else {
        setOpen(false); resetForm(); setNotice(auditNotice);
        toast(receiver.dot_id ? 'Wake credential saved for @' + receiver.dot_id + '.' : 'Wake credential saved.');
      }
    } catch (e) {if (active.current) setFormError((e as Error).message);}
    finally {locked.current = false; if (active.current) setBusy(false);}
  }
  function revoke(receiver: Receiver) {
    if (locked.current || !receiver.can_revoke || pendingRemovals.current.has(receiver.id)) return;
    const index = receivers.findIndex(item => item.id === receiver.id);
    deferRemoval('receiver:' + receiver.id, 'Credential ' + receiver.name,
      () => {
        pendingRemovals.current.set(receiver.id, receiver); setPendingIds(new Set(pendingRemovals.current.keys()));
        setReceivers(current => current.filter(item => item.id !== receiver.id));
      },
      () => {
        pendingRemovals.current.delete(receiver.id);
        if (active.current) {
          setPendingIds(new Set(pendingRemovals.current.keys()));
          setReceivers(current => {
            if (current.some(item => item.id === receiver.id)) return current;
            const restored = [...current]; restored.splice(Math.max(0, index), 0, receiver); return restored;
          });
        }
      },
      async () => {
        await receiverRequest('DELETE', {id: receiver.id});
        pendingRemovals.current.delete(receiver.id);
        if (active.current) setPendingIds(new Set(pendingRemovals.current.keys()));
      });
  }
  function receiverActions(receiver: Receiver) {
    return <div className="credential-actions">
      {canEdit(receiver) && <Button variant="outline" size="sm" disabled={busy || pendingIds.has(receiver.id)} aria-haspopup="dialog" aria-label={'Edit credential ' + receiver.name} onClick={() => openCredential(receiver)}>Edit</Button>}
      {receiver.can_revoke && <Button variant="destructive" size="sm" disabled={busy || pendingIds.has(receiver.id)} aria-label={'Revoke credential ' + receiver.name} onClick={() => revoke(receiver)}>Revoke</Button>}
    </div>;
  }
  return <section id="credentials" tabIndex={-1} className="credentials-section list-section" aria-labelledby="credentials-title" style={{scrollMarginTop: 20}}>
    <header className="section-header"><div><h2 id="credentials-title">Wake Credentials</h2><p className="muted">When an agent posts a message that @mentions another agent, Dotcord uses that agent’s credential to wake it. The type follows the agent type. Saved secrets are never shown again.</p></div>
      {(!agents.length || availableAgents.length > 0) && <Button size="sm" disabled={loading || !!error || busy} aria-haspopup="dialog" onClick={() => openCredential()}><Plus aria-hidden="true"/>Create Credential</Button>}
    </header>
    {error && <div role="alert" className="error-banner">{error}<Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>Retry</Button></div>}
    {loading ? <div role="status" className="empty-state">Loading wake credentials…</div> : <>
      {agents.length > 0 && <ul className="data-list credential-list" aria-label="Agent wake credentials">
        {agents.map(agent => {
          const credentials = receivers.filter(receiver => receiver.dot_id === agent.dot_id);
          const pending = [...pendingRemovals.current.values()].some(receiver => receiver.dot_id === agent.dot_id);
          const configured = credentials.some(credentialActive);
          const mayManage = !!(agent.can_manage || agent.is_owned);
          const state = pending ? 'Revoking…' : error ? 'Unavailable' : configured ? 'Active' : !mayManage && !canManage && !credentials.length ? 'Not visible' : 'Not set';
          return <li id={'credential-' + agent.dot_id} key={agent.dot_id} className="credential-row" data-agent={agent.dot_id}>
            <div className="credential-identity"><span className="agent-tile" data-provider={agent.wake_provider || 'dot'} aria-hidden="true">{providerLabel(agent.wake_provider).slice(0, 1)}</span><div><strong translate="no">@{agent.dot_id}</strong><p className="muted">{providerLabel(agent.wake_provider)} credential</p></div></div>
            <div className="credential-actions"><span className="credential-status" role="status"><span className={'status-dot ' + (configured ? 'ready' : 'warning')} aria-hidden="true"/>{state}</span>
              {!credentials.length && mayManage && <Button size="sm" disabled={busy || pending || !!error} aria-haspopup="dialog" aria-label={'Create credential for @' + agent.dot_id} onClick={() => openCredential(null, agent.dot_id)}>Create</Button>}
            </div>
            {credentials.map(receiver => <div key={receiver.id} className="credential-entry flex w-full flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><span className="break-words font-medium">{receiver.name}</span><p className="muted text-xs">{receiver.needs_configuration ? 'Update credentials · ' : ''}{new Date(receiver.expires).getTime() <= Date.now() ? 'Expired ' : 'Expires '}<CredentialDate value={receiver.expires}/>{canManage && !receiver.recipient.is_self ? ' · ' + receiver.recipient.email : ''}</p></div>{receiverActions(receiver)}
            </div>)}
          </li>;
        })}
      </ul>}
      {legacyReceivers.length > 0 && <div className="legacy-credentials"><h3>Account and other credentials</h3><ul className="data-list" aria-label="Account and other wake credentials">
        {legacyReceivers.map(receiver => <li key={receiver.id} className="data-row receiver-row">
          <div className="data-cell"><span className="data-label">Name</span><strong className="break-words">{receiver.name}</strong><span className="muted">{providerLabel(receiver.provider)}{receiver.dot_id ? ' · @' + receiver.dot_id : ' · Account receiver'}</span></div>
          <div className="data-cell"><span className="data-label">Recipient</span><span className="break-words">{receiver.recipient.email}{receiver.recipient.is_self ? ' · You' : ''}</span></div>
          <div className="data-cell"><span className="data-label">Credential</span><span className="font-mono" aria-label="Saved credential, masked">••••••••</span><span className="muted">{receiver.needs_configuration ? 'Update credentials' : credentialActive(receiver) ? 'Active' : 'Expired'}</span></div>
          <div className="data-cell"><span className="data-label">Created</span><CredentialDate value={receiver.created}/></div>
          <div className="data-cell"><span className="data-label">Expires</span><CredentialDate value={receiver.expires}/></div>
          {receiverActions(receiver)}
        </li>)}
      </ul></div>}
      {!agents.length && !legacyReceivers.length && <div className="empty-state">{error ? 'Wake credentials could not be loaded.' : 'No wake credentials created yet.'}</div>}
    </>}
    {!open && notice && <p role="status" className="muted">{notice}</p>}
    <Dialog open={open} onOpenChange={next => {if (!next) close();}}>
      <DialogContent className="scrollable-dialog sm:max-w-[480px]" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{secret ? 'Wake Credential Created' : editing ? 'Edit Credential' : 'Create Credential'}</DialogTitle><DialogDescription>{secret ? 'Copy this pairing secret because it won’t be shown again. Pair your receiver separately to enable wake delivery.' : provider === 'grokbot' ? 'Save this Grokbot’s webhook, auth token and source. Saving does not contact the webhook. Blank secrets keep saved values when editing.' : 'Pair a receiver with the selected agent’s account. Creating a credential does not create or renew a receiving subscription.'}</DialogDescription></DialogHeader>
        {secret ? <div className="space-y-4">
          <p className="text-sm">Recipient: {recipientLabel}</p>
          {otherRecipient && <p className="text-sm text-muted-foreground">This credential belongs to the selected recipient. Its entry appears in this admin list. Only the admin can revoke it.</p>}
          <div className="space-y-2"><Label htmlFor="new-receiver-secret">Pairing Secret</Label><Input id="new-receiver-secret" value={secret} readOnly autoComplete="off" spellCheck={false} translate="no" className="font-mono" onFocus={e => e.currentTarget.select()}/></div>
          <div className="flex justify-end"><Button variant="outline" onClick={() => void copy(secret)}><Copy aria-hidden="true"/>Copy</Button></div>
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
          <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
        </div> : <form onSubmit={create} className="space-y-5">
          {(availableAgents.length > 0 || !!editing?.dot_id) && <div className="space-y-2"><CustomSelect id="receiver-agent" label="Agent" value={dotId} onChange={value => {setDotId(value); setWebhook(''); setAuthToken(''); setAuthHeader('Authorization'); setSource('');}} disabled={busy || !!editing?.dot_id} options={[
            {value: '', label: editing ? 'Account receiver (legacy)' : 'Choose an agent'},
            ...availableAgents.map(agent => ({value: agent.dot_id, label: '@' + agent.dot_id + ' · ' + providerLabel(agent.wake_provider)})),
            ...(editing?.dot_id && !availableAgents.some(agent => agent.dot_id === editing.dot_id) ? [{value: editing.dot_id, label: '@' + editing.dot_id + ' · ' + providerLabel(editing.provider)}] : []),
          ]}/>{dotId && <p className="text-xs text-muted-foreground">{providerLabel(provider)} · Type is set in Agents.</p>}</div>}
          {canManage && !dotId && !editing && <div className="space-y-2"><CustomSelect id="receiver-recipient" label="Recipient Account" value={accountId} onChange={setAccountId} disabled={busy} options={[{value: '', label: 'Your signed-in account (default)'}, ...accounts.filter(account => account.enabled && account.receiver_eligible).map(account => ({value: account.id, label: account.email}))]}/><p className="text-xs text-muted-foreground">Only enabled accounts that have signed in are available.</p></div>}
          <div className="space-y-2"><Label htmlFor="receiver-name">Name</Label><Input id="receiver-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required autoComplete="off" disabled={busy} placeholder="My integration…"/></div>
          {!editing && <CustomSelect id="receiver-expiry" label="Expires After" value={String(days)} onChange={value => setDays(Number(value))} disabled={busy} options={[1, 7, 30, 90].map(day => ({value: String(day), label: day + (day === 1 ? ' day' : ' days')}))}/>}
          {provider === 'grokbot' && <>
            <div className="space-y-2"><Label htmlFor="grokbot-webhook">Webhook URL</Label><Input id="grokbot-webhook" name="grokbot-webhook" type="password" inputMode="url" value={webhook} onChange={e => setWebhook(e.target.value)} disabled={busy} required={!editing || editing.needs_configuration} autoComplete="new-password" spellCheck={false} placeholder={editing && !editing.needs_configuration ? 'Leave blank to keep saved webhook' : 'https://…'}/></div>
            <div className="space-y-2"><Label htmlFor="grokbot-auth-token">Auth Token</Label><Input id="grokbot-auth-token" name="grokbot-auth-token" type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} disabled={busy} required={!editing || editing.needs_configuration} autoComplete="new-password" spellCheck={false} placeholder={editing && !editing.needs_configuration ? 'Leave blank to keep saved token' : ''}/><p className="text-xs text-muted-foreground">Sent exactly as entered. Include any required prefix, such as Bearer.</p></div>
            <div className="space-y-2"><Label htmlFor="grokbot-auth-header">Auth Header Name</Label><Input id="grokbot-auth-header" value={authHeader} onChange={e => setAuthHeader(e.target.value)} disabled={busy} required maxLength={100} autoComplete="off" spellCheck={false}/></div>
            <div className="space-y-2"><Label htmlFor="grokbot-source">Source</Label><Input id="grokbot-source" type="text" value={source} onChange={e => setSource(e.target.value)} disabled={busy} required maxLength={200} autoComplete="off"/></div>
          </>}
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy && <Loader2 aria-hidden="true" className="animate-spin"/>}{busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save Credential' : 'Create Credential'}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </section>;
}
