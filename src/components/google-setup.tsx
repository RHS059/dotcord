import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

type Configuration={configured:boolean;source:'database'|'environment'|'none';client_id:string;has_secret:boolean;redirect_uri:string};
export function GoogleSetup({googleSession=false}:{googleSession?:boolean}){
 const [config,setConfig]=useState<Configuration|null>(null),[clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reauth,setReauth]=useState(false);
 async function load(){
  try{const response=await fetch('/api/auth/google-settings');const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load Google setup.');setConfig(data);setClientId(data.client_id||'');}catch(e){setError((e as Error).message);}
 }
 useEffect(()=>{void load();},[]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  const payload={client_id:clientId.trim(),client_secret:secret};setSecret('');
  try{const response=await fetch('/api/auth/google-settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to save Google setup.');setConfig(data);setClientId(data.client_id||payload.client_id);setNotice('Google credentials saved. Test Continue with Google to verify the provider setup.');setReauth(googleSession);window.dispatchEvent(new Event('dotcord-auth-updated'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="surface mt-7 p-5 space-y-3" aria-label="Google sign-in setup">
  <h2 className="font-semibold">Google sign-in setup</h2>
  <p className="text-sm">Owner setup, once for this app. Create a Web application OAuth client in Google Cloud, then enter its credentials here. Other accounts only need to sign in and choose a handle.</p>
  {config&&<><p className="text-sm">{config.configured?'Google sign-in is configured.':'Google sign-in is not configured yet.'}</p>
   {config.source!=='none'&&<p className="text-sm">Configuration source: {config.source==='database'?'saved in Dotcord':'hosting environment'}. Settings saved here take precedence over hosting configuration.</p>}
   <p className="text-sm">Add this exact authorized redirect URI in Google Cloud:</p><code className="block break-all text-sm">{config.redirect_uri}</code>
   <form onSubmit={event=>void save(event)} className="space-y-3" autoComplete="off">
    <label className="block text-sm">Google client ID<input className="mt-1 block w-full rounded border p-2 bg-transparent" name="google-client-id" value={clientId} onChange={event=>setClientId(event.target.value)} required disabled={busy} autoComplete="off" spellCheck={false}/></label>
    <label className="block text-sm">Google client secret<input className="mt-1 block w-full rounded border p-2 bg-transparent" name="google-client-secret" type="password" value={secret} onChange={event=>setSecret(event.target.value)} required={!config.has_secret||clientId.trim()!==config.client_id} disabled={busy} autoComplete="new-password" spellCheck={false}/></label>
    <p className="text-sm">{config.has_secret?'A secret is already saved. Leave the secret blank to keep it when using the same client ID.':'Enter the client secret from Google Cloud.'} The saved secret is never displayed.</p>
    <p className="text-sm">Saving signs out existing Google sessions. Accounts can sign in again with Google.</p>
    <Button type="submit" disabled={busy||reauth}>{busy?'Saving…':'Save Google sign-in'}</Button>
   </form>
  </>}
  {reauth&&<p className="text-sm">Google sessions were reset after this change. <a href="/auth/google/start" target="_top" className="underline">Continue with Google</a> to sign in again.</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
