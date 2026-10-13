import {validateCameraHealth,canonicalCameraUnit,type Health,type FieldHealthUnit} from './fieldCameraHealth';
import {resolveVerifiedUnitIdentity} from './verifiedUnitIdentity';
import {checkedFieldMap} from './gpsPersistence';
export type FleetSnapshot={health:Health;fieldMap:ReturnType<typeof checkedFieldMap>;readAt:string};
type Unit=FieldHealthUnit&{currentLocationType?:string;placement?:string;placementSource?:string};
export function inventoryPlacement(unit:Unit):'field'|'shop'|'unknown'{
 const value=String(unit.placement||unit.currentLocationType||'').toLowerCase();
 return value==='shop'?'shop':['field','site'].includes(value)?'field':'unknown';
}
/** Only complete saved resource identities carry the current placement onto devices.
 * Exact unique inventory labels can classify synthetic tracker placeholders only.
 * This never changes a health observation, a source identity, or a saved location. */
export function reconcileFleetSnapshot(rawHealth:unknown,rawMap:unknown,now=Date.now()):FleetSnapshot{
 const health=validateCameraHealth(rawHealth),fieldMap=checkedFieldMap(rawMap);
 const inventory=(Array.isArray((fieldMap as any).inventoryItems)?(fieldMap as any).inventoryItems:fieldMap.items) as Unit[];
 const changes=new Map<string,'field'|'shop'>();
 for(const unit of inventory){
  const placement=inventoryPlacement(unit),key=canonicalCameraUnit(unit.unitNumber);
  if(placement==='unknown'||inventory.filter(r=>r.id===unit.id).length!==1)continue;
  const association=resolveVerifiedUnitIdentity(unit,health,now);
  if(association.state==='verified'){
   const proof=association.identity,rows=health.rows.filter(r=>proof.unitKeys.includes(r.unit));
   if(rows.length===proof.deviceIds.length&&rows.every(r=>proof.deviceIds.includes(String(r.id))))for(const row of rows)if(row.scope!=='inactive')changes.set(String(row.id),placement);
  }
  if(!key||inventory.filter(r=>canonicalCameraUnit(r.unitNumber)===key).length!==1)continue;
  const placeholders=health.rows.filter(r=>r.trackerOnly&&r.type==='tracker_unit'&&canonicalCameraUnit(r.unit)===key);
  if(placeholders.length===1&&placeholders[0].scope!=='inactive'&&health.rows.filter(r=>canonicalCameraUnit(r.unit)===key).every(r=>r.trackerOnly))changes.set(String(placeholders[0].id),placement);
 }
 const rows=health.rows.map(r=>changes.has(String(r.id))?{...r,scope:changes.get(String(r.id))!}:r);
 const count=(scope:string)=>rows.filter(r=>r.scope===scope).length;
 const next=health.evidenceVersion===2?{...health,rows,online:rows.filter(r=>r.scope==='field'&&r.status==='online').length,offline:rows.filter(r=>r.scope==='field'&&r.status==='offline').length,review:rows.filter(r=>r.scope==='field'&&r.status==='review').length,fieldDevices:count('field'),shopRoot:count('shop'),inventory:{allRecords:rows.length,activeFieldRecords:count('field'),activeShopRecords:count('shop'),inactiveRecords:count('inactive'),unknownScopeRecords:count('unknown')}}:health;
 validateCameraHealth(next);
 return {health:{...next,fleetFieldUnits:inventory},fieldMap,readAt:new Date(now).toISOString()};
}
