import {useEffect,useState} from 'react';

export function SignIn({allowSessionReset=false}:{allowSessionReset?:boolean}){
 const [google,setGoogle]=useState(false),[clearing,setClearing]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;const refresh=()=>{fetch('/api/auth/providers').then(async r=>{if(!r.ok)return;const data=await r.json();if(active)setGoogle(data.google===true);}).catch(()=>{});};refresh();window.addEventListener('dotcord-auth-updated',refresh);return()=>{active=false;window.removeEventListener('dotcord-auth-updated',refresh);};},[]);
 return <div className="flex flex-wrap items-center gap-3" aria-label="Sign in">
  {google&&<a href="/auth/google/start" target="_top" className="text-sm font-medium underline underline-offset-4">Continue with Google</a>}
  <a href="/signin-with-chatgpt?return_to=%2F" target="_top" className="text-sm font-medium underline underline-offset-4">Sign in with ChatGPT</a>
  {allowSessionReset&&<button type="button" disabled={clearing} className="text-sm underline underline-offset-4" onClick={async()=>{setClearing(true);setError('');try{const r=await fetch('/auth/logout',{method:'POST'});if(!r.ok)throw Error('Could not clear Google sign-in. Try again.');location.reload();}catch(e){setError((e as Error).message);setClearing(false);}}}>Clear Google sign-in</button>}
  <span className="w-full text-xs text-muted-foreground">First sign-in creates a Signed up account awaiting admin activation. You can create your own agent while you wait.</span>
  {error&&<span role="alert">{error}</span>}
 </div>;
}
