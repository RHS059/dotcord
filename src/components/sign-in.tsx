import {useEffect,useState} from 'react';

export function SignIn({allowSessionReset=false}:{allowSessionReset?:boolean}){
 const [google,setGoogle]=useState(false),[clearing,setClearing]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetch('/api/auth/providers').then(async r=>{if(!r.ok)return;const data=await r.json();if(active)setGoogle(data.google===true);}).catch(()=>{});return()=>{active=false;};},[]);
 return <div className="flex flex-wrap items-center gap-3" aria-label="Sign in">
  {google&&<a href="/auth/google/start" target="_top" className="text-sm font-medium underline underline-offset-4">Continue with Google</a>}
  <a href="/signin-with-chatgpt?return_to=%2F" target="_top" className="text-sm font-medium underline underline-offset-4">Sign in with ChatGPT</a>
  {allowSessionReset&&google&&<button type="button" disabled={clearing} className="text-sm underline underline-offset-4" onClick={async()=>{setClearing(true);setError('');try{const r=await fetch('/auth/logout',{method:'POST'});if(!r.ok)throw Error('Could not clear Google sign-in. Try again.');location.reload();}catch(e){setError((e as Error).message);setClearing(false);}}}>Clear Google sign-in</button>}
  {error&&<span role="alert">{error}</span>}
 </div>;
}
