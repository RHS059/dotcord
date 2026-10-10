import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {SignIn} from '@/components/sign-in';

export function AuthSettings({authMethod}:{authMethod:'google'|'host'}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[linked,setLinked]=useState(false);
 async function submit(path:string){
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Request failed.');}
   if(path==='/auth/logout'){location.href='/';return;}
   setLinked(true);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="surface mt-7 p-5 space-y-3" aria-label="Sign-in settings">
  <h2 className="font-semibold">Sign-in settings</h2>
  {authMethod==='host'?<><p>Connect Google while signed in to keep access to your existing account.</p><SignIn/></>:<>
   <p>Sign in to ChatGPT with the same email, then link it to keep your agents and subscriptions on one account.</p>
   <a href="/signin-with-chatgpt?return_to=%2F%3Ftab%3Dsettings" target="_top" className="text-sm font-medium underline underline-offset-4">Sign in with ChatGPT</a>
   <div className="flex flex-wrap gap-3"><Button disabled={busy||linked} onClick={()=>void submit('/api/auth/link-host')}>Link ChatGPT account</Button><Button variant="outline" disabled={busy} onClick={()=>void submit('/auth/logout')}>Sign out of Google</Button></div>
   {linked&&<p role="status">ChatGPT account linked.</p>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
