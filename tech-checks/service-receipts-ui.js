import {transferReadiness} from './transfers/readiness.js';
import {createDailySignoff,SIGNOFF_STATEMENT} from './service-signoff-ui.js';
export const RECEIPT_SIGNOFF_STATEMENT='I confirm that I physically checked the truck, trailer if applicable, equipment, SIM cards and battery quantities. I reviewed the linked equipment receipt IDs and revisions shown in this report. The answers, images and linked receipts accurately record my checks.';
export const receiptRefs=rows=>rows.map(r=>({event_id:r.event_id,receipt_revision:r.receipt_revision,transfer_id:r.transfer_id,transfer_revision:r.transfer_revision}));
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function mountDailyReceiptReview(root,{context,draft,isCurrent,isBusy,onChange}) {
 let mode='loading',refs=[],reviewed=false;
 root.append(node('p','Checking linked equipment receipts…'));
 const changed=()=>{draft.signature.confirmed=false;const c=root.querySelector('.cos-daily-signoff input[type=checkbox]');if(c)c.checked=false;onChange();};
 const signoff=statement=>createDailySignoff({state:draft.signature,actorName:context.getProfile()?.full_name||context.getProfile()?.username||'Technician',statementText:statement,isBusy,onChange});
 const load=async()=>{
  try{
   const ready=await transferReadiness(context,'service');if(!isCurrent())return;
   if(!ready.ready){mode='legacy';root.replaceChildren(signoff(SIGNOFF_STATEMENT));return;}
   const {data,error}=await context.db.rpc('techcheck_daily_receipts_v5');if(!isCurrent())return;
   if(error||data?.version!==5||data.actor_id!==ready.actor||!Array.isArray(data.receipts))throw Error('Equipment receipts could not be verified. Reload before completing.');
   refs=receiptRefs(data.receipts);mode='linked';root.replaceChildren(node('h3','Equipment receipts included in this sign-off'));
   root.append(node('p','Review these accepted handoffs and the equipment still assigned to you. Complete your truck inspection and inventory separately.'));
   if(!data.receipts.length)root.append(node('p','No accepted equipment receipts are currently assigned to you.'));
   for(const r of data.receipts){
    const item=node('article','');item.append(node('h4',r.snapshot.it_name+' → '+r.snapshot.service_name),node('p','Receipt '+r.event_id+' · receipt revision '+r.receipt_revision+' · current handoff revision '+r.transfer_revision));
    for(const equipment of r.remaining)item.append(node('p',equipment.family+' '+equipment.unit_tag+' ['+equipment.equipment_key+'] · SIMs: '+equipment.sims.join(', ')+' · batteries: '+equipment.battery_count+' · parts: '+equipment.parts.map(p=>p.name+' × '+p.quantity).join(', ')));
    item.append(node('p','Service sign-off: '+r.snapshot.signature.name+' · '+r.snapshot.signature.signed_at));root.append(item);
   }
   const same=JSON.stringify(draft.receiptRefs)===JSON.stringify(refs);
   if(!same){draft.receiptRefs=refs;draft.receiptsReviewed=false;draft.signature.confirmed=false;onChange();}
   reviewed=same&&draft.receiptsReviewed===true;
   const label=node('label',''),check=document.createElement('input');check.type='checkbox';check.checked=reviewed;check.setAttribute('aria-label','I reviewed the linked equipment receipts');
   check.onchange=()=>{if(isBusy())return;reviewed=check.checked;draft.receiptsReviewed=reviewed;changed();};label.append(check,' I reviewed the linked equipment receipt IDs, revisions and remaining equipment above.');
   root.append(label,signoff(RECEIPT_SIGNOFF_STATEMENT));
  }catch{
   if(!isCurrent())return;mode='unavailable';root.replaceChildren(node('p','Equipment receipts could not be verified. Reload before completing.'));
   const retry=node('button','Reload equipment receipts');retry.type='button';retry.onclick=()=>{if(!isBusy()){mode='loading';void load();}};root.append(retry);
  }
 };
 void load();
 return {submission(){
  if(!isCurrent())throw Error('Your account changed. Reopen your daily check.');
  if(mode==='loading'||mode==='unavailable')throw Error('Wait for the equipment receipt review or reload it before completing.');
  if(mode==='legacy')return {endpoint:'complete_service_daily_report_v4',args:{}};
  if(!reviewed)throw Error('Review and confirm the linked equipment receipts before signing.');
  return {endpoint:'complete_service_daily_report_v5',args:{p_receipts:structuredClone(refs),p_receipts_reviewed:true}};
 }};
}
