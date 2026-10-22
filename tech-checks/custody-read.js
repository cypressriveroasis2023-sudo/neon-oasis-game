// Fixed read-only projections of existing Owner RPCs. No credentials or raw snapshots cross the frame.
const text=value=>typeof value==='string'?value:'';
const list=value=>{if(!Array.isArray(value))throw new Error('Incomplete source');return value;};
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const unit=row=>({key:text(row.equipment_key),family:text(row.family||row.equipment_type),tag:text(row.unit_tag),state:text(row.status),sims:Array.isArray(row.sims)?row.sims.map(text):[],batteries:count(row.battery_count),parts:Array.isArray(row.parts)?row.parts.map(part=>({name:text(part.name),quantity:count(part.quantity)})):[]});
export function projectCustodySource(source,value){
 if(source==='trucks')return list(value).map(row=>({id:text(row.service_tech_id||row.user_id),name:text(row.name),units:list(row.units).map(unit),sims:list(row.sims).map(sim=>({slot:count(sim.slot_no),number:text(sim.sim_number),state:text(sim.status)})),stock:Object.fromEntries(['recon_battery_qty','agm_12v_110ah_qty','litime_12v_100ah_qty','battery_12v_35ah_qty'].map(key=>[key,count(row.stock?.[key])]))}));
 if(value?.version!==1)throw new Error('Unsupported source');
 if(source==='handoffs')return {limited:list(value.transfers).length>=100,items:value.transfers.map(row=>({id:text(row.id),sender:text(row.it_name),receiver:text(row.service_name),receiverId:text(row.service_actor),state:text(row.state),createdAt:text(row.created_at),updatedAt:text(row.updated_at),units:list(row.manifest).map(unit)}))};
 if(source==='returns'){
  if(count(value.pending_count)===null)throw new Error('Missing pending count');
  return {pending:value.pending_count,items:list(value.returns).map(row=>({id:text(row.id),receiverId:text(row.service_tech_id),receiver:text(row.service_tech_name),state:text(row.state),submittedAt:text(row.submitted_at),receivedAt:text(row.received_at),unit:unit({...row,equipment_key:row.returned_key})}))};
 }
 throw new Error('Unsupported source');
}
export async function readOwnerCustody(db,isCurrent){
 if(!isCurrent())throw new Error('Session changed');
 const sources=[['trucks','owner_service_truck_inventory_v1'],['handoffs','techcheck_transfer_context_v1'],['returns','techcheck_ticketfree_context_v1']];
 const results=await Promise.all(sources.map(async([source,rpc])=>{
  try{const result=await db.rpc(rpc);if(result.error)throw new Error('Source unavailable');return [source,{value:projectCustodySource(source,result.data)}];}
  catch{return [source,{error:'Saved '+source+' records unavailable or incomplete.'}];}
 }));
 if(!isCurrent())throw new Error('Session changed');
 return {readAt:new Date().toISOString(),sources:Object.fromEntries(results)};
}
