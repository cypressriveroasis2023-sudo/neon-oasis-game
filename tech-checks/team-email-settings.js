const EMAIL_SUPABASE_URL='https://goqrnolcvqnirjmzaeyk.supabase.co';
const EMAIL_SUPABASE_KEY='sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const emailDb=supabase.createClient(EMAIL_SUPABASE_URL,EMAIL_SUPABASE_KEY);

function emailEsc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
async function loadTeamEmailSettings(){
  const app=document.getElementById('appView');
  if(!app || app.classList.contains('hidden')) return;
  const owner=document.getElementById('view-owner');
  if(!owner || owner.classList.contains('hidden')) return;
  const {data:profiles,error}=await emailDb.from('profiles').select('user_id,notification_email,email_job_assignments,email_handoff_updates,email_owner_copies,role');
  if(error || !profiles) return;
  const byId=new Map(profiles.map(p=>[p.user_id,p]));
  document.querySelectorAll('.teamMemberCard').forEach(card=>{
    const nameInput=card.querySelector('input[id^="name_"]');
    if(!nameInput) return;
    const id=nameInput.id.replace('name_','');
    if(card.querySelector('[data-team-email-box]')) return;
    const p=byId.get(id) || {};
    const email=p.notification_email || '';
    const box=document.createElement('div');
    box.className='teamEmailBox';
    box.dataset.teamEmailBox='1';
    box.innerHTML=`<div><label>Notification Email</label><input data-notify-email type="email" autocapitalize="none" spellcheck="false" placeholder="name@camerasonsite.com" value="${emailEsc(email)}"></div>
      <div class="emailPrefs">
        <label class="emailPref"><input data-email-jobs type="checkbox" ${p.email_job_assignments!==false?'checked':''}><span>New job assignment emails</span></label>
        <label class="emailPref"><input data-email-handoffs type="checkbox" ${p.email_handoff_updates!==false?'checked':''}><span>Equipment / handoff emails</span></label>
        ${p.role==='owner'?'<label class="emailPref"><input data-email-owner type="checkbox" '+(p.email_owner_copies?'checked':'')+'><span>Owner copy emails</span></label>':''}
      </div>
      <button class="mini top8" data-save-team-email type="button">Save Email Settings</button>
      <div class="small top8">The address is stored in Tech Check. Actual email delivery starts after the outgoing email service is connected.</div>`;
    const security=card.querySelector('.accountSecurityFold');
    if(security) security.before(box); else card.querySelector('.teamMemberBody')?.append(box);
    box.querySelector('[data-save-team-email]')?.addEventListener('click',async()=>{
      const notificationEmail=box.querySelector('[data-notify-email]')?.value.trim().toLowerCase() || '';
      if(notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) return alert('Enter a valid notification email address.');
      const role=document.getElementById('role_'+id)?.value || p.role || 'pending';
      const active=document.getElementById('active_'+id)?.value === 'true';
      const fullName=document.getElementById('name_'+id)?.value.trim() || '';
      const {data,error}=await emailDb.functions.invoke('admin-user-management',{body:{
        action:'set_access',user_id:id,role,active,full_name:fullName,
        notification_email:notificationEmail || null,
        email_job_assignments:Boolean(box.querySelector('[data-email-jobs]')?.checked),
        email_handoff_updates:Boolean(box.querySelector('[data-email-handoffs]')?.checked),
        email_owner_copies:Boolean(box.querySelector('[data-email-owner]')?.checked)
      }});
      if(error || data?.error) return alert(error?.message || data.error);
      alert('Email settings saved.');
    });
  });
}
function installTeamEmailStyles(){
  if(document.getElementById('teamEmailLiveStyle')) return;
  const style=document.createElement('style');
  style.id='teamEmailLiveStyle';
  style.textContent=`.teamEmailBox{margin-top:12px;padding:12px;border:1px solid #d5e0e7;border-radius:12px;background:#f6f9fb}.teamEmailBox>div:first-child label{display:block;font-weight:850;color:#1b3347;margin-bottom:5px}.emailPrefs{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:9px}.emailPref{display:inline-flex;align-items:center;gap:7px;margin:0;font-size:12px;font-weight:800;color:#536575}.emailPref input{width:auto;min-width:18px;height:18px;margin:0}`;
  document.head.append(style);
}
installTeamEmailStyles();
new MutationObserver(()=>{clearTimeout(window.__teamEmailTimer);window.__teamEmailTimer=setTimeout(loadTeamEmailSettings,120);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
setTimeout(loadTeamEmailSettings,700);
