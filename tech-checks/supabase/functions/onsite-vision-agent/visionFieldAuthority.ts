/* Cameras Onsite Vision — placement-verified Field classification.
 * Provider organizations and folder names are not physical placement.
 * A source can be OFFLINE without being deployed; no provider evidence is
 * allowed to move equipment or establish a Field service address.
 */
type Row=Record<string,any>;
const obj=(x:unknown):x is Row=>!!x&&typeof x==='object'&&!Array.isArray(x);
const str=(x:unknown)=>typeof x==='string'?x.trim():'';
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
const norm=(x:unknown)=>str(x).toUpperCase().replace(/[^A-Z0-9]/g,'');
const hash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const statuses=new Set(['online','offline','unverified']);
const classify=(items:Row[])=>({total:items.length,online:items.filter(x=>x.status==='online').length,
  offline:items.filter(x=>x.status==='offline').length,unverified:items.filter(x=>x.status==='unverified').length});
const kinds=(items:Row[])=>({
  cameras:classify(items.filter(x=>x.kind==='camera')),
  detectors:classify(items.filter(x=>x.kind==='detector')),
  recorders:classify(items.filter(x=>x.kind==='recorder')),
  servicePorts:classify(items.filter(x=>x.kind==='IP/port connection (not camera-video verification)')),
});
const locationInfo=(unit:Row)=>({
  customer:str(unit.customer)||null,site:str(unit.site)||null,address:str(unit.address)||null,
  source:'COS Field Map verified linked equipment placement (not live GPS)',
  matching_method:'complete verified equipment-to-camera resource identity + current COS Field Map unit',
});
function placement(unit:Row, version:number|undefined):'field'|'shop'|'inactive'|'unknown'{
  if(unit.activeInventoryEligible===false)return 'inactive';
  if(version===1){
    const effective=unit.effectivePlacement;
    if(!obj(effective)||effective.contract!=='COS_EFFECTIVE_FLEET_PLACEMENT_V1'||
      !['field','shop','unknown'].includes(effective.state))return 'unknown';
    return effective.state;
  }
  const p=str(unit.placement||unit.currentLocationType).toLowerCase();
  return ['field','site'].includes(p)?'field':['shop','root','warehouse','yard'].includes(p)?'shop':'unknown';
}
function mapAuthority(fieldMap:unknown,now:number){
  if(!obj(fieldMap)||!Array.isArray(fieldMap.items)||!obj(fieldMap.summary)||
    !Number.isSafeInteger(fieldMap.summary.fieldUnits)||fieldMap.items.length!==fieldMap.summary.fieldUnits||
    !Number.isFinite(Date.parse(fieldMap.generatedAt))||Date.parse(fieldMap.generatedAt)>now)return null;
  const inventory=Array.isArray(fieldMap.inventoryItems)?fieldMap.inventoryItems:fieldMap.items;
  if(!Array.isArray(inventory)||inventory.length>10000||inventory.some(x=>!obj(x)||!uuid(x.id)||!str(x.unitNumber)))return null;
  if(new Set(inventory.map(x=>x.id)).size!==inventory.length)return null;
  const fields=new Map<string,Row>();
  for(const u of fieldMap.items){
    if(!obj(u)||!uuid(u.id)||!str(u.unitNumber)||fields.has(u.id))return null;
    fields.set(u.id,u);
  }
  const version=fieldMap.effectivePlacementVersion;
  if(version!==undefined&&version!==1)return null;
  const byId=new Map<string,Row>(inventory.map(x=>[x.id,x]));
  if(fields.size>inventory.length||[...fields].some(([id,u])=>byId.get(id)?.unitNumber!==u.unitNumber))return null;
  // A v1 envelope commits that active Field inventory and the map's Field list
  // are the same population. Reject a conflicting read rather than inventing Field status.
  if(version===1){
    for(const u of inventory)if(!obj(u.effectivePlacement)||u.effectivePlacement.contract!=='COS_EFFECTIVE_FLEET_PLACEMENT_V1'||
      !['field','shop','unknown'].includes(u.effectivePlacement.state))return null;
    const effectiveFields=inventory.filter(u=>placement(u,version)==='field');
    if(effectiveFields.length!==fields.size||effectiveFields.some(u=>!fields.has(u.id)))return null;
  }
  return {byId,fields,version};
}
function verifiedAssociations(health:Row,authority:ReturnType<typeof mapAuthority>,now:number){
  const out=new Map<string,{unit:Row;place:'field'|'shop'|'inactive';fieldUnit:Row|null}>();
  if(!authority||health.identityVersion!==1||!Array.isArray(health.rows)||
    !Array.isArray(health.unitIdentities)||!Array.isArray(health.identityWarnings))return out;
  const sets=[health.unitIdentities,health.ownerConfirmedUnitIdentities||[],health.reconProviderUnitIdentities||[]];
  if(sets.some(s=>!Array.isArray(s)||s.length>2000))return out;
  const claims=sets.flat();
  if(health.ownerConfirmedIdentityVersion!==undefined&&health.ownerConfirmedIdentityVersion!==1||
     health.reconProviderIdentityVersion!==undefined&&health.reconProviderIdentityVersion!==1)return out;
  const unitUses=new Map<string,number>();
  for(const claim of claims)if(obj(claim)&&uuid(claim.unitId))
    unitUses.set(claim.unitId,(unitUses.get(claim.unitId)||0)+1);
  const overlaps=new Map<string,number>();
  for(const claim of claims){
    if(!obj(claim)||!Array.isArray(claim.deviceIds))continue;
    for(const id of claim.deviceIds)overlaps.set(String(id),(overlaps.get(String(id))||0)+1);
  }
  const byId=new Map(health.rows.map((r:Row)=>[String(r.id),r]));
  for(const claim of claims){
    if(!obj(claim)||!uuid(claim.unitId)||unitUses.get(claim.unitId)!==1||!hash(claim.proof)||
       !['native_provider','owner_placement','owner_confirmed_native','reconeyez_area'].includes(claim.kind)||
       !Array.isArray(claim.deviceIds)||!claim.deviceIds.length||!Array.isArray(claim.unitKeys)||!claim.unitKeys.length||
       claim.deviceIds.some((id:unknown)=>typeof id!=='string'||!/^[1-9]\d*$/.test(id)||overlaps.get(id)!==1)||
       new Set(claim.deviceIds).size!==claim.deviceIds.length||
       claim.unitKeys.some((key:unknown)=>!str(key))||new Set(claim.unitKeys).size!==claim.unitKeys.length)continue;
    const unit=authority.byId.get(claim.unitId);
    if(!unit||claim.unitNumber!==unit.unitNumber)continue;
    const rows=claim.deviceIds.map((id:string)=>byId.get(id));
    if(rows.some(row=>!row||row.trackerOnly===true||!claim.unitKeys.includes(row.unit)))continue;
    const matching=health.rows.filter((row:Row)=>claim.unitKeys.includes(row.unit));
    if(matching.length!==claim.deviceIds.length||matching.some((row:Row)=>!claim.deviceIds.includes(String(row.id))))continue;
    if(health.identityWarnings.some((warning:Row)=>warning.unitId===claim.unitId||
      warning.deviceIds?.some((id:string)=>claim.deviceIds.includes(id))||
      warning.unitKeys?.some((key:string)=>claim.unitKeys.includes(key))))continue;
    if(claim.kind==='owner_placement'&&
      (claim.placementAuditId!==unit.placementAuditId||claim.unitNumber!==unit.placementUnitKey))continue;
    if(claim.kind==='native_provider'&&rows.some(row=>row.evidence?.source!=='Star4Live'||row.evidence?.kind!=='provider'))continue;
    if(claim.kind==='reconeyez_area'&&
      (!Number.isFinite(Date.parse(claim.providerArea?.inventoryObservedAt))||
      now<Date.parse(claim.providerArea.inventoryObservedAt)||
      now-Date.parse(claim.providerArea.inventoryObservedAt)>20*60000||
      rows.some(row=>row.evidence?.source!=='Reconeyez')))continue;
    const state=placement(unit,authority.version);
    if(!['field','shop','inactive'].includes(state))continue;
    const fieldUnit=authority.fields.get(unit.id)||null;
    if(state==='field'&&(!fieldUnit||fieldUnit.unitNumber!==unit.unitNumber))continue;
    if(state==='shop'&&fieldUnit)continue;
    for(const id of claim.deviceIds)out.set(id,{unit,place:state,fieldUnit});
  }
  return out;
}
function matches(value:Row,q:Row){
  const wanted=norm(q.unit_reference),area=str(q.location_query).toLowerCase();
  if(wanted&&norm(value.unit)!==wanted)return false;
  if(area&&![value.location?.customer,value.location?.site,value.location?.address,
    value.provider_customer_folder].some(v=>str(v).toLowerCase().includes(area)))return false;
  return true;
}
function subset(rows:Row[],scope:string,q:Row,limit:number){
  const accepted=rows.filter(row=>matches(row,q)&&(scope==='offline'?row.status==='offline':
    scope==='online'?row.status==='online':scope==='attention'?row.status!=='online':true));
  const order=(a:Row,b:Row)=>(a.status==='offline'?0:a.status==='unverified'?1:2)-
    (b.status==='offline'?0:b.status==='unverified'?1:2)||
    str(a.unit).localeCompare(str(b.unit),undefined,{numeric:true});
  accepted.sort(order);
  return {items:accepted.slice(0,limit),total:accepted.length,truncated:accepted.length>limit};
}
/** This is the Owner's Field outage contract. The larger source counts are
 * retained as separate provider observations, never as deployed outages. */
export function verifiedVisionFieldFleet(raw:Row,health:Row,fieldMap:unknown,question:Row,now=Date.now()){
  const authority=mapAuthority(fieldMap,now),claims=verifiedAssociations(health,authority,now);
  const byId=new Map(health.rows.map((r:Row)=>[String(r.id),r]));
  const rawItems=[...(raw.items||[]),...(raw.service_items||[])];
  if(rawItems.some(row=>!obj(row)||!statuses.has(row.status)||!byId.has(String(row.resource_id)))||
    new Set(rawItems.map(row=>String(row.resource_id))).size!==rawItems.length)
    throw Error('Source record identity could not be reconciled.');
  const field:Row[]=[],shop:Row[]=[],review:Row[]=[];
  for(const item of rawItems){
    const source=byId.get(String(item.resource_id))!;
    const proof=claims.get(String(item.resource_id));
    const folder=str(source.organization);
    const reportedFolder=folder&&!['ROOT','SHOP','SHOP EQUIPMENT'].includes(folder.toUpperCase())?folder:null;
    const record={...item,location:null,provider_customer_folder:reportedFolder,
      provider_folder_note:reportedFolder?'Star4Live customer folder; not verified current deployment':null};
    if(proof?.place==='field'&&proof.fieldUnit){
      field.push({...record,location:locationInfo(proof.fieldUnit),
        placement:'field_verified',placement_source:'COS Field Map and complete verified resource identity',
        equipment_unit_id:proof.unit.id,equipment_unit_number:proof.unit.unitNumber});
    }else if(proof?.place==='shop'||proof?.place==='inactive'||source.scope==='inactive'){
      shop.push({...record,placement:proof?.place==='inactive'?'inactive_verified':
        proof?.place==='shop'?'shop_verified':'inactive_source',
        placement_source:proof?'Verified COS equipment identity and placement':'Source inactive marker'});
    }else{
      review.push({...record,placement:'needs_review',
        placement_review_reason:authority?
          'No complete current COS Field/Shop placement and resource-identity proof for this camera. Provider customer folder is not Field authority.':
          'COS Field Map placement authority is unavailable; provider location cannot prove Field status.'});
    }
  }
  const scope=str(question.scope)||'summary';
  const limit=Math.max(1,Math.min(Number(question.limit)||30,100));
  const a=subset(field,scope,question,limit),b=subset(review,scope,question,limit);
  const fieldKind=kinds(field),reviewKind=kinds(review),shopKind=kinds(shop),sourceKind=kinds(rawItems);
  return {
    ...raw,
    data_source:'COS saved provider Camera Health + verified equipment identity + protected Field Map placement; read-only',
    field_placement_verified:!!authority&&health.identityVersion===1,
    field_placement_note:authority?
      'Only complete verified equipment-to-provider resource links with current Field placement count as Field outages. Source-only provider folders and unsupported aliases require review.':
      'COS Field Map could not be verified. No provider resource is counted as a confirmed Field outage.',
    provider_source_counts:sourceKind,
    monitored_cameras:fieldKind.cameras,monitored_detectors:fieldKind.detectors,
    monitored_recorders:fieldKind.recorders,service_port_checks:fieldKind.servicePorts,
    field_resource_census:{...raw.field_resource_census,
      notice:'Legacy Camera Health provider-scope classification only; not a verified Field deployment census'},
    placement_review_counts:reviewKind,shop_or_inactive_counts:shopKind,
    confirmed_field_resource_count:field.length,unverified_placement_resource_count:review.length,
    shop_or_inactive_resource_count:shop.length,
    unmatched_field_resource_locations:field.filter(x=>!x.location?.address).length,
    location_data:authority?'Current COS equipment inventory and Field Map, verified by exact resource identities':
      'unavailable — current Field Map and equipment identities not verified',
    items:a.items,items_returned:a.items.length,items_total_matching:a.total,items_truncated:a.truncated,
    review_items:b.items,review_items_returned:b.items.length,review_total_matching:b.total,review_items_truncated:b.truncated,
    service_items:[],
    limitations:[
      'Star4Live customer folder does not certify where the equipment is deployed; it may be left assigned after a return to Shop.',
      'Only COS equipment identity + current placement can mark Field. Conflicts and incomplete linkage are separate placement review, not confirmed Field outages.',
      'Provider status is a saved observation, not independently verified video or continuous outage duration.',
      'SHOP and inactive equipment never enter confirmed Field outages.',
      'No provider probes, service requests, inventory changes, or customer contact occurred.',
    ],
  };
}
