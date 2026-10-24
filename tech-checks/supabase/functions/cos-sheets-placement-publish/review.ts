// Review-only: no database, network or Sheet writes.
import {equal,cellText,desiredCustomer,tabLayout} from './model.ts';
type Row=Record<string,any>;
export function reviewBindings(input:Row){
 const {bindings,firstRows,secondRows,index,records}=input;
 if(!equal(firstRows,secondRows))throw Error('Sheet changed between reads');
 if(!/^[a-f0-9]{64}$/.test(input.sourceSha256)||!Array.isArray(bindings)||bindings.length>434||new Set(bindings.map((b:Row)=>b.equipmentId)).size!==bindings.length)throw Error('Invalid binding review');
 const norm=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
 const items=bindings.map((b:Row)=>{
  const reasons:string[]=[],matches=index.filter((x:Row)=>x.productId===b.equipmentId),sources=records.filter((x:Row)=>x.productId===b.equipmentId),source=sources[0];
  if(matches.length!==1||sources.length!==1)reasons.push('exact_product_id_not_unique');
  if(source?.holdReason)reasons.push('source_review_held');
  if(b.guardCurrent!==true)reasons.push('native_guard_changed');
  if(b.operationalOverride!==false)reasons.push('operational_override_or_unknown');
  if(b.pending)reasons.push('pending_write');
  const key=matches[0]?.key,targets=firstRows.filter((r:Row)=>key===tabLayout(r.sheetId).title+'|'+r.label),target=targets[0];
  if(targets.length!==1||!target?.unique)reasons.push('target_not_unique');
  if(source&&matches[0]&&(norm(matches[0].name)!==norm(source.apiAssignment?.fullLabel??'')||norm(matches[0].customerSite)!==norm(source.customer??'')))reasons.push('index_source_changed');
  const before={sheetId:b.sheetId,row:b.row,label:b.label,cells:b.baseline,customerStyle:b.customerStyle??'plain'};
  let after:Row|null=null;
  if(target){
   const texts=target.cells.map(cellText),o=b.observation;
   if(texts.some((x:any)=>x===null)||target.cells.some((x:Row)=>x.rich))reasons.push('unsupported_cell');
   if(target.cells.some((x:Row,i:number)=>!equal({...x,entered:{}},{...b.baseline[i],entered:{}})))reasons.push('metadata_changed');
   let style=before.customerStyle;
   if(o?.state==='confirmed'&&texts[1]==='FIELD'&&norm(texts[2]??'')===norm(o.customerLabel+': '+o.siteLabel))style='combined';
   after={sheetId:target.sheetId,row:target.row,label:target.label,cells:target.cells,customerStyle:style};
   if(o?.state!=='confirmed')reasons.push('source_not_confirmed');
   else {
    if(texts[1]!==o.placement||desiredCustomer({baseline:target.cells,customerStyle:style},o)!==texts[2])reasons.push('target_assignment_differs');
    if(norm(texts[3]??'')!==norm(o.siteLabel??'')&&!(o.placement==='SHOP'&&['shop','main cos shop','cameras onsite shop'].includes(norm(texts[3]??''))))reasons.push('target_site_differs');
   }
  }
  return {equipmentId:b.equipmentId,before,after,observation:b.observation,reasons,sourceCurrent:b.sourceCurrent===true,status:reasons.length?'held':equal(before,after)?'unchanged':'review_required'};
 });
 let changed=true;while(changed){changed=false;for(const item of items.filter((x:Row)=>x.status==='review_required')){
  const occupant=items.find((x:Row)=>x.equipmentId!==item.equipmentId&&(x.before.sheetId===item.after!.sheetId&&x.before.row===item.after!.row||x.before.label===item.after!.label)&&x.status!=='review_required');
  if(occupant){item.status='held';item.reasons.push('retained_destination:'+occupant.equipmentId);changed=true;}
 }}
 const pending=items.filter((x:Row)=>x.status==='review_required'),positions=new Map<string,Row>(items.map((x:Row)=>[x.equipmentId,x.before])),ordered:Row[]=[];
 while(pending.length){const i=pending.findIndex((x:Row)=>![...positions].some(([id,p])=>id!==x.equipmentId&&(p.sheetId===x.after.sheetId&&p.row===x.after.row||p.label===x.after.label)));
  if(i<0){for(const x of pending){x.status='held';x.reasons.push('cyclic_destination');}break;}
  const [x]=pending.splice(i,1);ordered.push(x);positions.set(x.equipmentId,x.after!);
 }
 return {sourceSha256:input.sourceSha256,sheetReadAt:input.sheetReadAt,approvalRequired:true,executable:false,items,proposedOrder:ordered.map(x=>x.equipmentId),freshnessBlocked:ordered.filter(x=>!x.sourceCurrent).map(x=>x.equipmentId)};
}
