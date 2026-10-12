// Synthetic-only UI fixture. Every API request is intercepted, never forwarded.
function installFixture(w,opts={}){
 const state={status:opts.status||'active',owner:opts.owner!==false,calls:[],unknown:[],clipboard:[],override:null,
 agents:opts.agents||[
  {dot_id:'nova',agent_type:'dot',wake_provider:'dot',is_owned:1,can_manage:1,discord_id:'studio',webhook_configured:1,webhook_suffix:'123456',subscriptions:1,grokbot_configured:0},
  {dot_id:'orbit',agent_type:'dot',wake_provider:'dot',is_owned:0,can_manage:1,discord_id:'studio',webhook_configured:1,subscriptions:1,grokbot_configured:0},
  {dot_id:'lyra',agent_type:'agent',wake_provider:'grokbot',is_owned:0,can_manage:1,discord_id:'studio',webhook_configured:1,subscriptions:0,grokbot_configured:0},
  {dot_id:'ember',agent_type:'agent',wake_provider:'claude',is_owned:0,can_manage:1,discord_id:'other',webhook_configured:0,subscriptions:0,grokbot_configured:0}],
 discords:[{id:'studio',name:'Studio Discord',bot_configured:1,can_manage:1},{id:'other',name:'Other Discord',bot_configured:0,can_manage:1}],
 accounts:[{id:'owner-fixture',email:'owner@example.test',role:'owner',enabled:1,status:'active',receiver_eligible:true},{id:'member-fixture',email:'member@example.test',role:'member',enabled:0,status:'signed_up',receiver_eligible:false}],
 tokens:[{id:'token-fixture',name:'Synthetic Test Token',prefix:'demo',created:1780272000,expires:'2027-06-01T00:00:00Z',dot:'nova',can_revoke:true}],
 receivers:[{id:'receiver-fixture',name:'Nova Receiver',provider:'dot',dot_id:'nova',created:1780272000,expires:'2027-06-01T00:00:00Z',recipient:{email:'owner@example.test',is_self:true},can_revoke:true,can_edit:true}]};
 const response=(body,status=200)=>Promise.resolve({ok:status<400,status,headers:{get:()=>null},json:async()=>JSON.parse(JSON.stringify(body)),text:async()=>JSON.stringify(body)});
 w.fetch=async(input,options={})=>{
  const path=new URL(String(input),w.location.href).pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):null,call={path,method,body};state.calls.push(call);
  if(state.override){const value=state.override(call,response);if(value!==undefined)return value;}
  if(path==='/api/account'){if(state.status==='logged_out'||state.status==='inactive')return response({error:state.status==='inactive'?'This account is inactive.':'Sign in to continue.'},401);return response({email:'owner@example.test',account_status:state.status,can_manage_accounts:state.owner,auth_method:'host',host_linked:true,needs_setup:false,profile:{dot_id:'nova',selection_required:false},wake:{account_binding:'fixture-only',state:'ready',active_subscriptions:1,account_subscriptions:1,refresh_before:'2027-06-01T00:00:00Z',subscription_required:false}});}
  if(path==='/api/tool'){
   const a=body.arguments||{},n=body.name;
   if(n==='list_dots')return response(state.status==='signed_up'?state.agents.filter(a=>a.is_owned):state.agents);
   if(n==='list_discords')return response(state.discords);
   if(n==='get_wake_status')return response({profile:{dot_id:a.dot_id||'nova',selection_required:false},wake:{state:'ready',active_subscriptions:1,account_subscriptions:1,refresh_before:'2027-06-01T00:00:00Z'}});
   if(n==='list_pending_messages')return response({messages:[{inbox_id:'fixture-inbox',message_id:'fixture-message',sender:'orbit',expires_at:'2027-06-01T00:15:00Z'}],has_more:false});
   if(n==='read_pending_message')return response({inbox_id:a.inbox_id,message_id:'fixture-message',sender:'orbit',text:'Synthetic message for local QA only.'});
   if(n==='acknowledge_message')return response({acknowledged:true});
   if(n==='delete_agent'){state.agents=state.agents.filter(x=>x.dot_id!==a.dot_id);return response({deleted:true});}
   if(n==='set_discord'){Object.assign(state.agents.find(x=>x.dot_id===a.dot_id),{discord_id:a.discord_id});return response({saved:true});}
   if(n==='set_webhook'){Object.assign(state.agents.find(x=>x.dot_id===a.dot_id),{webhook_configured:1});return response({saved:true});}
   if(n==='update_agent'){Object.assign(state.agents.find(x=>x.dot_id===a.dot_id),{...a,dot_id:a.handle||a.dot_id});return response({saved:true});}
   if(n==='register_dot'){state.agents.push({dot_id:a.dot_id,agent_type:a.agent_type,wake_provider:a.wake_provider,is_owned:1,can_manage:1,discord_id:a.discord_id,webhook_configured:!!a.webhook_url,subscriptions:0});return response({registered:true});}
   if(n==='add_discord'){state.discords.push({id:'new-fixture',name:a.name,bot_configured:1,can_manage:1});return response({added:true});}
   if(n==='update_discord'){Object.assign(state.discords.find(x=>x.id===a.discord_id),a);return response({updated:true});}
   if(n==='delete_discord'){state.discords=state.discords.filter(x=>x.id!==a.discord_id);return response({deleted:true});}
   if(n==='post_to_discord')return response({sent:true,message_id:'123456789012345678',url:'https://discord.com/channels/123456789012345678/123456789012345679/123456789012345680',mention_delivery:{results:[{handle:'orbit',status:'accepted'}]}});
   if(n==='edit_discord_message')return response({edited:true,message_id:a.message_id});
  }
  if(path==='/api/accounts'){if(method==='POST')Object.assign(state.accounts.find(x=>x.id===body.account_id),{status:body.status,enabled:body.status==='active'?1:0});return response({accounts:state.accounts});}
  if(path==='/api/agent-profiles')return response({agents:state.agents.map(a=>({dot_id:a.dot_id,account_id:a.dot_id==='nova'?'owner-fixture':'member-fixture',account_status:'active',created:1780272000}))});
  if(path==='/api/tokens'){if(method==='DELETE')state.tokens=state.tokens.filter(x=>x.id!==body.id);if(method==='POST'){const token={id:'new-fixture-token',name:body.name,prefix:'demo',created:Date.now(),expires:'2027-06-01T00:00:00Z',dot:body.dot_id,can_revoke:true};state.tokens.push(token);return response({token,secret:'synthetic-token-only-not-valid'});}return response({tokens:state.tokens});}
  if(path==='/api/receivers'){if(method==='DELETE')state.receivers=state.receivers.filter(x=>x.id!==body.id);if(method==='POST'||method==='PATCH'){const receiver={id:'new-fixture-receiver',name:body.name,provider:body.provider||'dot',dot_id:body.dot_id,created:Date.now(),expires:'2027-06-01T00:00:00Z',can_revoke:true};state.receivers.push(receiver);return response({receiver,recipient:{email:'owner@example.test',is_self:true},secret:'synthetic-receiver-only-not-valid'});}return response({receivers:state.receivers});}
  if(path==='/api/audit')return response({events:[]});
  if(path==='/api/test-wake')return response({request_id:body.request_id,message_id:'test_message_'+body.request_id,handle:body.dot_id,status:'accepted',results:[{handle:body.dot_id,status:'accepted',attempts:1}],agent_execution_confirmed:false});
  if(path==='/api/auth/providers')return response({chatgpt:true,google:false});
  if(path==='/api/auth/google-settings')return response({configured:false,source:'none',client_id:'',has_secret:false,redirect_uri:'https://example.test/auth/google/callback'});
  if(path==='/api/onboarding')return response({needs_setup:false,invitations:[],profile:{dot_id:'nova'}});
  if(path==='/api/invitations')return response({invitations:[]});
  if(path==='/auth/logout')return response({ok:true});
  state.unknown.push(call);return response({error:'Unmocked local QA request: '+path},500);
 };
 try{Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async text=>state.clipboard.push(text)}});}catch{}
 return state;
}
module.exports={installFixture};
