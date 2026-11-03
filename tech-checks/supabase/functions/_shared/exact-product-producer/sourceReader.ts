import {validateOwnerIdentitySnapshot} from '../../cos-operations-pages/ownerIdentityCrosswalk.ts';
import {currentMhelpProductConnectionCensus} from '../../cos-operations-pages/mhelpProductConnectionSource.ts';
import {digest} from './model.ts';
import type {FullSource} from './fullSource.ts';
import {boundedRequest} from '../scheduledDirectService.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
/** Supply ONLY closures already bound to the authenticated existing server
 * principal. This adapter never accepts an actor, token, URL or role from a body.
 * platformRpc must use the existing actor/organization authorization envelope. */
export type ProtectedSourceIO={
 platformRpc:(name:'cos_mhelp_placement_snapshot'|'cos_owner_identity_snapshot'|'appdeploy_field_map_snapshot',signal:AbortSignal)=>Promise<Row>;
 platformRead:(path:string,signal:AbortSignal)=>Promise<Row[]>;
 legacyRead:(path:string,signal:AbortSignal)=>Promise<Row[]>;
 legacyEpochs:(keys:string[],signal:AbortSignal)=>Promise<unknown[]>;
 placementAudits:(signal:AbortSignal)=>Promise<Row[]>;
 tracker:(candidate:readonly any[],sourceSha256:string,signal:AbortSignal)=>Promise<Row>;
};
const DEVICE_FIELDS='id,external_device_id,device_serial,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,activation_state,monitoring_enabled,monitoring_profile';
export function createProtectedSourceReader(io:ProtectedSourceIO,now=Date.now){
 return async(signal:AbortSignal):Promise<FullSource>=>{
  const deadline=now()+20_000;
  const call=<T>(fn:(s:AbortSignal)=>Promise<T>)=>boundedRequest(async s=>{
   if(signal.aborted)throw Error('Cancelled');
   const controller=new AbortController();const cancel=()=>controller.abort();
   signal.addEventListener('abort',cancel,{once:true});s.addEventListener('abort',cancel,{once:true});
   try{return await fn(controller.signal);}finally{signal.removeEventListener('abort',cancel);s.removeEventListener('abort',cancel);controller.abort();}
  },deadline,now,20_000);
  const all=async(read:ProtectedSourceIO['legacyRead'],path:string)=>{
   const rows:Row[]=[];
   for(let offset=0;offset<10000;offset+=1000){
    const page=await call(s=>read(path+'&limit=1000&offset='+offset,s));
    if(!Array.isArray(page)||page.length>1000||page.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Incomplete source');
    rows.push(...page);if(page.length<1000)return rows;
   }
   throw Error('Truncated source');
  };
  const [beforeReceipt,crosswalk]=await Promise.all([call(s=>io.platformRpc('cos_mhelp_placement_snapshot',s)),call(s=>io.platformRpc('cos_owner_identity_snapshot',s))]);
  validateOwnerIdentitySnapshot(crosswalk);
  const before=beforeReceipt.upload;
  const census=currentMhelpProductConnectionCensus(before,now());
  const seed=await all(io.legacyRead,'camera_devices?select='+DEVICE_FIELDS+'&order=id.asc');
  const sourceKeys=(rows:Row[])=>[...new Set([...crosswalk.claims.map((c:Row)=>c.legacy_unit_key),...rows.map(d=>d.unit_key).filter(k=>typeof k==='string'&&k.length>0)])].sort() as string[];
  const keys=sourceKeys(seed);
  if(keys.length>1000||keys.some(k=>k!==k.trim()||k.length>250))throw Error('Unbounded identity epoch source');
  const epochsBefore=keys.length?await call(s=>io.legacyEpochs(keys,s)):[];
  const [devices,units,matches,providers,audits,map,tracker]=await Promise.all([
   all(io.legacyRead,'camera_devices?select='+DEVICE_FIELDS+'&order=id.asc'),
   all(io.platformRead,'equipment_units?select=id,organization_id,unit_number,status&organization_id=eq.'+ORG+'&order=id.asc'),
   all(io.platformRead,'vision_vigilant_unit_matches?select=id,organization_id,equipment_unit_id,vigilant_device_id,camera_key,match_method,confidence&organization_id=eq.'+ORG+'&order=id.asc'),
   all(io.platformRead,'vision_vigilant_devices?select=id,organization_id,external_device_id,device_name,device_type,source&organization_id=eq.'+ORG+'&order=id.asc'),
   call(s=>io.placementAudits(s)),call(s=>io.platformRpc('appdeploy_field_map_snapshot',s)),
   call(s=>io.tracker(census.candidate,census.sourceSha256,s))
  ]);
  const [afterReceipt,afterCrosswalk,epochsAfter]=await Promise.all([call(s=>io.platformRpc('cos_mhelp_placement_snapshot',s)),call(s=>io.platformRpc('cos_owner_identity_snapshot',s)),keys.length?call(s=>io.legacyEpochs(keys,s)):Promise.resolve([])]);
  validateOwnerIdentitySnapshot(afterCrosswalk);
  if(JSON.stringify(keys)!==JSON.stringify(sourceKeys(devices)))throw Error('Identity membership changed during source read');
  if(await digest(before)!==await digest(afterReceipt.upload)||await digest(crosswalk)!==await digest(afterCrosswalk)||await digest(epochsBefore)!==await digest(epochsAfter))throw Error('Source changed during complete read');
  if(signal.aborted||now()>=deadline)throw Error('Source deadline');
  return {complete:true,upload:before,map,tracker,verifiedAt:new Date(now()).toISOString(),identitySources:{devices,units,matches,providers,audits,ownerCrosswalk:crosswalk as any,ownerEpochs:epochsAfter as any}};
 };
}
