const SUPABASE_URL='https://goqrnolcvqnirjmzaeyk.supabase.co';
const SUPABASE_KEY='sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const BATTERY={Sniper:{per:1,label:'12V 30Ah battery'},Ranger:{per:1,label:'Ranger lithium battery'},'Solar Spotter':{per:4,label:'12V 110Ah batteries'}};
const TRUCK=['Fuel level sufficient for today’s route','Tires appear safe and properly inflated','Headlights / signals / brake lights working','Windshield and mirrors are safe and clear','No visible fluid leaks','Required tools and service supplies onboard','Ladders / cargo / equipment secured','Truck cab and bed organized'];
const TRAILER=['Trailer tires appear safe and properly inflated','Hitch / coupler fully secured','Safety chains attached correctly','Trailer plug connected; lights and signals working','Jack / supports secured for travel','Load balanced and equipment tied down','No visible structural damage or unsafe condition'];
let state={session:null,profile:null,preps:[],reports:[],profiles:[],matched:[],sessionClosed:[]};
let draftNeeds=[];let liveChannel=null;
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function msg(id,text,type='warn'){const el=$(id);if(!el)return;el.innerHTML=text?'<div class="'+type+'">'+esc(text)+'</div>':''}
function badge(p){return '<span class="pill '+(p==='SWAP'?'swap':'backup')+'">'+esc(p)+'</span>'}
function roleLabel(r){return r==='owner'?'Owner/Admin':r==='it'?'IT Tech':r==='service'?'Service Tech':'Pending'}
function setBusy(on){document.body.classList.toggle('busy',on)}

async function init(){
  const {data:{session}}=await db.auth.getSession();
  if(session) await enterApp(session); else showAuth();
  db.auth.onAuthStateChange(async(_event,session)=>{if(session&&!state.session) await enterApp(session);if(!session&&state.session) showAuth();});
}
function showAuth(){state={session:null,profile:null,preps:[],reports:[],profiles:[],matched:[],sessionClosed:[]};$('authView').classList.remove('hidden');$('appView').classList.add('hidden');if(liveChannel){db.removeChannel(liveChannel);liveChannel=null}}
async function login(){msg('loginMessage','');setBusy(true);const email=$('loginEmail').value.trim(),password=$('loginPassword').value;const {data,error}=await db.auth.signInWithPassword({email,password});setBusy(false);if(error)return msg('loginMessage',error.message,'bad');await enterApp(data.session)}
async function bootstrapOwner(){
  msg('setupMessage','');
  const fullName=$('setupName').value.trim();
  const email=$('setupEmail').value.trim();
  const password=$('setupPassword').value;
  if(!fullName||!email||password.length<8){return msg('setupMessage','Enter your full name, authorized Owner email, and a password of at least 8 characters.','bad')}
  setBusy(true);
  const body={full_name:fullName,email,password};
  const {data,error}=await db.functions.invoke('bootstrap-owner',{body});
  if(error){setBusy(false);return msg('setupMessage',error.message||'Owner setup failed.','bad')}
  if(data?.error){setBusy(false);return msg('setupMessage',data.error,'bad')}
  const {data:sign,error:signErr}=await db.auth.signInWithPassword({email:body.email,password:body.password});
  setBusy(false);
  if(signErr)return msg('setupMessage','Owner created. Sign in above with the email and password you chose.','ok');
  await enterApp(sign.session)
}
async function enterApp(session){state.session=session;const {data:profile,error}=await db.from('profiles').select('*').eq('user_id',session.user.id).single();if(error||!profile){await db.auth.signOut();return msg('loginMessage','No active Cameras On Site profile was found.','bad')}if(!profile.active||profile.role==='pending'){await db.auth.signOut();return msg('loginMessage','Your account is not active yet. Contact the Owner/Admin.','bad')}state.profile=profile;$('authView').classList.add('hidden');$('appView').classList.remove('hidden');$('whoName').textContent=profile.full_name||session.user.email;$('whoRole').textContent=roleLabel(profile.role);configureTabs();setupRealtime();await refreshData()}
function configureTabs(){const r=state.profile.role;$('tab-it').classList.toggle('hidden',!['it','owner'].includes(r));$('tab-svc').classList.toggle('hidden',!['service','owner'].includes(r));$('tab-owner').classList.toggle('hidden',r!=='owner');if(r==='owner')show('owner');else if(r==='it')show('it');else show('svc')}
function show(which){['it','svc','owner'].forEach(n=>{$('view-'+n).classList.toggle('hidden',n!==which);$('tab-'+n).classList.toggle('on',n===which)})}
async function logout(){await db.auth.signOut();showAuth()}
function togglePasswordCard(){$('passwordCard').classList.toggle('hidden')}
async function changeMyPassword(){const p=$('myNewPassword').value;if(p.length<8)return msg('passwordMessage','Password must be at least 8 characters.','bad');const {error}=await db.auth.updateUser({password:p});if(error)return msg('passwordMessage',error.message,'bad');$('myNewPassword').value='';msg('passwordMessage','Password updated.','ok')}

function setupRealtime(){if(liveChannel)db.removeChannel(liveChannel);liveChannel=db.channel('cos-shared-live').on('postgres_changes',{event:'*',schema:'public',table:'prep_tickets'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'prep_items'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'reports'},refreshData).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},refreshData).subscribe(s=>{$('syncStatus').textContent=s==='SUBSCRIBED'?'Live shared data connected':'Connecting shared data…'})}
async function refreshData(){if(!state.session)return;const prepQ=await db.from('prep_tickets').select('*,prep_items(*)').order('created_at',{ascending:true});if(!prepQ.error)state.preps=prepQ.data||[];if(state.profile.role==='owner'){const rep=await db.from('reports').select('*').order('created_at',{ascending:true});if(!rep.error)state.reports=rep.data||[];const prof=await db.from('profiles').select('*').order('created_at',{ascending:true});if(!prof.error)state.profiles=prof.data||[];renderOwner();renderUsers()}renderIT();renderMatched();updateMorningStatus()}
