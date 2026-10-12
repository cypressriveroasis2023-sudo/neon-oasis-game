import {mhelpUnitIdentity} from '../../../operations/shared/mhelpUnitIdentity.ts';
type Row=Record<string,any>;
const safe=(v:unknown,max=250)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
export async function collectFleetLocations(candidates:Row[],equipment:Row[],read:(equipment:Row,previous:Row|null)=>Promise<Row>){
 if(!Array.isArray(candidates)||candidates.length>2000||!Array.isArray(equipment)||equipment.length>10000||new Set(equipment.map(r=>r.equipmentId)).size!==equipment.length)throw Error('Invalid complete fleet inventory');
 const groups=new Map<string,Row[]>();for(const r of equipment){const id=mhelpUnitIdentity(r.name);if(id)groups.set(id.key,[...(groups.get(id.key)||[]),r]);}
 const result=new Array(candidates.length);let next=0;
 await Promise.all(Array.from({length:Math.min(3,candidates.length)},async()=>{for(;;){const index=next++;if(index>=candidates.length)return;const unit=candidates[index],id=mhelpUnitIdentity(unit.unitNumber),base={unitId:unit.unitId,kind:unit.kind,unitNumber:unit.unitNumber,guard:unit.guard};
  const held=(reason:string)=>({...base,state:'held',reason});
  if(!id){result[index]=held('not_numbered_field_equipment');continue;}
  if(unit.inactive){result[index]=held('inactive_equipment');continue;}
  const same=candidates.filter(r=>mhelpUnitIdentity(r.unitNumber)?.key===id.key);
  if(same.length!==1){result[index]=held('duplicate_inventory_identity');continue;}
  const matches=(groups.get(id.key)||[]).filter(r=>r.active!==false&&!/\b(?:DO NOT USE|MISSING|RETIRED|DECOMMISSIONED|STOLEN)\b/i.test(r.name));
  if(matches.length!==1){result[index]=held(matches.length?'duplicate_mhelp_identity':'mhelp_equipment_not_found');continue;}
  try{
   const location=await read(matches[0],unit.previous||null);
   if(!['FIELD','SHOP'].includes(location.placement)||!safe(location.customer)||!safe(location.site)||location.address!==null&&!safe(location.address,600)
    ||location.point!==null&&(!Array.isArray(location.point)||location.point.length!==2||location.point.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(location.point[0])>90||Math.abs(location.point[1])>180))throw Error('Invalid location');
   result[index]={...base,state:'confirmed',equipmentId:matches[0].equipmentId,equipmentUpdatedAt:matches[0].updatedAt||null,...location};
  }catch{result[index]=held('mhelp_location_read_unavailable');}
 }}));return result;
}
