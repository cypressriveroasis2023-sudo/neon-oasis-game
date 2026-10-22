// COS existing Owner Team Board extension. No technician screen or protected app.js is replaced.
const context = () => window.TechCheckContext;
const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',year: 'numeric',month: '2-digit',day: '2-digit'
}).format(new Date());
const owner = () => {
  const c=context(),p=c?.getProfile?.(),id=c?.getSession?.()?.user?.id;
  return Boolean(id && p?.user_id===id && p?.role==='owner' && p?.active===true
    && !p.archived_at && c?.getRole?.()==='owner');
};
const esc = value => String(value??'').replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentModal=null,busy=false,scheduled=false,cache=null,lastRead=0,reading=null;

const style=document.createElement('style');
style.id='cos-owner-daily-takeover-css';
style.textContent=[
  '.cosOwnerDailyModal .ownerTruckInventoryWorkspace{max-width:760px;max-height:calc(100vh - 36px);overflow-y:auto;padding:20px}',
  '.cosOwnerDailyModal .cosOwnerDailyBlock{border:1px solid #596778;border-radius:8px;padding:12px;margin-top:14px}',
  '.cosOwnerDailyModal .cosOwnerDailyBlock h3{font-size:14px;margin:0 0 7px}',
  '.cosOwnerDailyModal .cosOwnerDailyBlock p{font-size:13px;line-height:1.5;margin:4px 0}',
  '.cosOwnerDailyModal .cosOwnerDailyWarn{border-left:4px solid #e2a238;padding:12px;margin:14px 0;background:rgba(229,164,56,.12);line-height:1.5}',
  '.cosOwnerDailyModal .cosOwnerDailyField{display:block;padding:9px 0;font-size:14px}',
  '.cosOwnerDailyModal textarea{width:100%;box-sizing:border-box;min-height:90px;margin-top:8px;padding:10px}',
  '.cosOwnerDailyModal .cosOwnerDailyOptions label{display:flex;align-items:flex-start;gap:9px;margin:13px 0;line-height:1.5}',
  '.cosOwnerDailyModal .cosOwnerDailyOptions input{flex:0 0 auto;margin-top:4px}',
  '.cosOwnerDailyModal [data-cos-owner-daily-submit]{width:100%;min-height:45px;border-radius:7px;font-weight:700}',
  '.cosOwnerDailyModal [data-cos-owner-daily-status]{font-size:13px;line-height:1.5;margin:12px 0}',
  '.cosOwnerDailyStatus{display:block;padding:7px 10px;margin:6px 0;font-size:12px;border:1px solid #e2a238;border-radius:6px}',
  '.cosOwnerDailyTrigger{margin-top:8px}'
].join('\n');
document.head.appendChild(style);

function inject(){
  if(!owner())return;
  for(const card of document.querySelectorAll('.ownerCmdTechCard')){
    const edit=card.querySelector('[data-owner-truck-edit]');
    if(!edit)continue;
    const id=String(edit.dataset.ownerTruckEdit||'');
    if(!id || card.querySelector('[data-cos-owner-daily-open]'))continue;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='ownerCmdInventoryEditBtn cosOwnerDailyTrigger';
    btn.dataset.cosOwnerDailyOpen=id;
    btn.textContent='COMPLETE DAILY REPORT AS OWNER';
    btn.setAttribute('aria-label','Owner daily closeout for this Service technician');
    edit.before(btn);
  }
  const panel=document.querySelector('.ownerSimpleControlOverlay.open .ownerSimpleControlPanel');
  if(panel && !panel.querySelector('[data-cos-owner-daily-open]')){
    const manage=panel.querySelector('button[onclick*="ownerTechManageTruck"]');
    if(manage){
      const matched=manage.getAttribute('onclick')?.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
      if(matched){
        const btn=document.createElement('button');
        btn.type='button';
        btn.dataset.cosOwnerDailyOpen=matched[0];
        btn.innerHTML='<b>COMPLETE DAILY AS OWNER</b><span>Document an Owner closeout without the technician signature</span>';
        manage.before(btn);
      }
    }
  }
  if(cache?.service_techs)decorateOwnerStatuses(cache);
}
function schedule(){
  if(scheduled)return;scheduled=true;
  queueMicrotask(()=>{scheduled=false;inject();});
}
async function fetchBoard(force=false){
  if(!owner())throw new Error('Sign in as the active Owner to complete this daily report.');
  if(!force && cache && Date.now()-lastRead<20000)return cache;
  if(reading)return reading;
  reading=(async()=>{
    const c=context();
    const {data,error}=await c.db.rpc('owner_tech_command_board_v2',{p_date:today()});
    if(error)throw new Error(error.message||'Owner Team Board is unavailable.');
    if(!owner())throw new Error('Owner session changed. Sign in again.');
    if(!Array.isArray(data?.service_techs))throw new Error('Owner Team Board returned incomplete technician records.');
    cache=data;lastRead=Date.now();
    decorateOwnerStatuses(cache);
    return data;
  })();
  try{return await reading;}finally{reading=null;}
}
function decorateOwnerStatuses(board){
  if(!owner())return;
  for(const tech of board?.service_techs||[]){
    if(!tech.owner_authorized || tech.inventory_check?.ready)return;
    const id=String(tech.service_tech_id||tech.user_id||'');
    const card=[...document.querySelectorAll('.ownerCmdTechCard')].find(node=>
      node.querySelector('[data-owner-truck-edit]')?.dataset.ownerTruckEdit===id);
    if(!card)continue;
    if(card.querySelector('.cosOwnerDailyStatus'))continue;
    const info=document.createElement('strong');
    info.className='cosOwnerDailyStatus';
    info.textContent='OWNER AUTHORIZED — Daily inventory NOT physically verified';
    const head=card.querySelector('.ownerCmdTechHead');
    (head||card).after(info);
  }
}
function dismiss(){
  if(busy)return;
  currentModal?.remove();
  currentModal=null;
  document.body.classList.remove('ownerTruckInventoryEditing');
}
function row(name,value){
  return '<span><b>'+esc(name)+':</b> '+esc(value||'Missing')+'</span>';
}
function renderReportPanel(tech){
  const i=tech.inspection||{},v=tech.inventory_check||{},unit=tech.units||[],sim=tech.sims||[],stock=tech.stock||{};
  const title=esc(tech.name||'Service Technician');
  const block=(heading,body)=>'<section class="cosOwnerDailyBlock"><h3>'+heading+'</h3><p>'+body+'</p></section>';
  const units=unit.map(x=>row(x.equipment_type,x.unit_tag)+' · ').join('');
  const sims=sim.map(x=>row('SIM '+x.slot_no,x.sim_number)+' · ').join('');
  const inventory=units+' '+sims+'<p>'+esc('Battery counts: Recon '+(stock.recon_battery_qty??'?')+
      '; AGM 12V 110Ah '+(stock.agm_12v_110ah_qty??'?')+
      '; LiTime 12V 100Ah '+(stock.litime_12v_100ah_qty??'?')+
      '; 12V 35Ah '+(stock.battery_12v_35ah_qty??'?'))+'</p>';
  return '<div class="ownerTruckInventoryBackdrop" data-cos-owner-daily-close></div>'+
    '<section class="ownerTruckInventoryWorkspace" role="dialog" aria-modal="true" aria-label="Owner daily report closeout">'+
    '<div class="ownerTruckEditorHead"><div><b>COMPLETE DAILY REPORT AS OWNER</b><span>'+
    title+' · '+esc(today())+' · Owner-only decision</span></div>'+
    '<button type="button" data-cos-owner-daily-close>✕ CLOSE</button></div>'+
    '<div class="cosOwnerDailyWarn"><b>This is NOT Josh’s or another technician’s signature.</b> The recorded truck inventory has not been physically verified today. Closing an administrative report does not change or claim to verify stock, equipment IDs or SIM numbers.</div>'+
    block('Saved safety inspection',
      'Truck: '+(i.truck_complete?'PASS':'NOT COMPLETE')+
      ' · Trailer: '+(i.trailer_state==='not_taking'?'NOT TAKING':i.trailer_complete?'PASS':'NOT COMPLETE')+
      ' · Service inventory check: '+(v.ready?'COMPLETE':'NOT VERIFIED'))+
    block('Last recorded assignments and quantities (not today’s physical inventory)',inventory)+
    '<label class="cosOwnerDailyField"><b>Reason for Owner takeover (required)</b>'+
      '<textarea data-cos-owner-daily-reason maxlength="2000" minlength="12" placeholder="Explain why the technician cannot finish the daily package and your Owner decision."></textarea></label>'+
    '<div class="cosOwnerDailyOptions">'+
    '<label><input type="checkbox" data-cos-owner-daily-departure><span><b>Also authorize departure for today as Owner</b> (optional). This is an explicit exception only when the saved safety check passed and recorded inventory meets minimums. It expires at the end of the day or when truck stock or inspection changes. Inventory stays unverified.</span></label>'+
    '<label><input type="checkbox" data-cos-owner-daily-ack><span>I am approving this as the signed-in Owner, not impersonating the technician. I understand these recorded counts have not been physically verified today.</span></label>'+
    '</div>'+
    '<p role="status" data-cos-owner-daily-status>Closing the report queues its Owner-labeled PDF, Drive archive and email.</p>'+
    '<button type="button" data-cos-owner-daily-submit>COMPLETE AND SEND AS OWNER</button>'+
    '</section>';
}
async function open(userId){
  if(!owner())return;
  const id=String(userId||'');
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))return;
  const existing=document.getElementById('cosOwnerDailyTakeoverModal');
  if(existing){if(existing.dataset.techId===id)return;dismiss();}
  const modal=document.createElement('div');
  modal.id='cosOwnerDailyTakeoverModal';
  modal.className='ownerTruckInventoryModal cosOwnerDailyModal';
  modal.dataset.techId=id;
  modal.dataset.checkDate=today();
  modal.innerHTML='<div class="ownerTruckInventoryBackdrop"></div><section class="ownerTruckInventoryWorkspace" role="status">Loading the actual Owner Team Board...</section>';
  document.querySelector('.ownerSimpleControlOverlay.open')?.classList.remove('open');
  document.body.appendChild(modal);
  document.body.classList.add('ownerTruckInventoryEditing');
  currentModal=modal;
  try{
    const board=await fetchBoard(true),t=board.service_techs.find(x=>String(x.service_tech_id||x.user_id)===id);
    if(!t)throw new Error('This Service technician is no longer active or available to this Owner.');
    if(currentModal!==modal)return;
    modal.innerHTML=renderReportPanel(t);
    modal.querySelector('[data-cos-owner-daily-reason]')?.focus();
  }catch(error){
    if(currentModal===modal)modal.innerHTML='<section class="ownerTruckInventoryWorkspace"><b>Owner takeover unavailable</b><p>'+esc(error.message)+'</p><button type="button" data-cos-owner-daily-close>Close</button></section>';
  }
}
async function submit(){
  const m=currentModal;
  if(busy||!m||!owner())return;
  const reason=m.querySelector('[data-cos-owner-daily-reason]')?.value.trim()||'';
  const ack=m.querySelector('[data-cos-owner-daily-ack]')?.checked===true;
  const departure=m.querySelector('[data-cos-owner-daily-departure]')?.checked===true;
  const status=m.querySelector('[data-cos-owner-daily-status]');
  if(reason.length<12){status.textContent='Explain your reason in at least 12 characters.';return;}
  if(!ack){status.textContent='Acknowledge that you are signing as Owner and not verifying physical stock.';return;}
  if(today()!==m.dataset.checkDate){status.textContent='The work day changed. Reopen to inspect today’s records.';return;}
  if(!m.dataset.reportId)m.dataset.reportId=crypto.randomUUID();
  busy=true;const button=m.querySelector('[data-cos-owner-daily-submit]');button.disabled=true;
  status.textContent='Recording Owner decision; original technician records will not be changed...';
  try{
    const {data,error}=await context().db.rpc('owner_takeover_service_daily_v1',{
      p_report_id:m.dataset.reportId,p_service_tech_id:m.dataset.techId,
      p_check_date:m.dataset.checkDate,p_reason:reason,
      p_authorize_departure:departure,p_owner_acknowledged:true
    });
    if(!owner())throw new Error('Owner session changed. Please sign in again to verify.');
    if(error)throw new Error(error.message||'Owner takeover was rejected by the server.');
    if(!data?.id)throw new Error('Owner completion requires a verified report ID.');
    status.textContent='Saved as Owner · Report '+data.id+' · '+(data.owner_authorized?'Owner-authorized departure exception, inventory STILL UNVERIFIED. ':'Departure not authorized. ')+
      'Drive/email delivery is queued for the existing scheduled service.';
    button.remove();cache=null;lastRead=0;
    void fetchBoard(true).catch(()=>{});
    window.refreshData?.();
  }catch(error){
    status.textContent='Not completed: '+(error.message||'Unknown error')+' — retry without changing the entered reason.';
    button.disabled=false;
  }finally{busy=false;}
}
document.addEventListener('click',event=>{
  if(!owner())return;
  const trigger=event.target.closest?.('[data-cos-owner-daily-open]');
  if(trigger){event.preventDefault();event.stopPropagation();void open(trigger.dataset.cosOwnerDailyOpen);return;}
  if(event.target.closest?.('[data-cos-owner-daily-close]')){
    event.preventDefault();event.stopPropagation();dismiss();return;
  }
  if(event.target.closest?.('[data-cos-owner-daily-submit]')){
    event.preventDefault();event.stopPropagation();void submit();
  }
},true);
new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true});
for(const e of ['pageshow','techcheck:data-refreshed','techcheck:view-changed']){
  window.addEventListener(e,()=>{cache=null;schedule();});
}
schedule();
