/** Presentation-only overlay of exact Product-ID Owner transfers.
 * Never mutates the reviewed source upload, cameras, GPS, geocode receipts,
 * native inventory, identity claims or original historical coordinates. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const id=(v:unknown)=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const safe=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const p=(v:unknown)=>String(v).toLowerCase();
const active=(r:Row)=>r.lifecycle==='active'&&r.active===true;
export function projectOperationalFleet(snapshot:Row,overrides:unknown):Row{
 if(!object(snapshot)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.fleetRoster?.items)||!object(snapshot.uploadInventory))
  throw Error('Verified combined Fleet roster unavailable for operational placement');
 if(!object(overrides)||overrides.contract!=='COS_OPERATIONAL_OVERRIDES_V1'
  ||!hash(overrides.sourceSha256)||overrides.sourceSha256!==snapshot.uploadInventory.sourceSha256
  ||!Number.isSafeInteger(overrides.held)||overrides.held<0||!Array.isArray(overrides.items)||overrides.items.length>10000)
  throw Error('Operational placement source changed; reload the Fleet roster');
 const source=Array.isArray(snapshot.uploadInventory.records)?snapshot.uploadInventory.records:[];
 const sourceById=new Map<string,Row>();for(const r of source){
  if(!object(r)||!id(r.productId)||sourceById.has(r.productId))throw Error('Duplicated mHelp Product ID in Fleet source');
  sourceById.set(r.productId,r);
 }
 const unique=new Map<string,Row>();
 for(const row of overrides.items){
  if(!object(row)||!id(row.productId)||unique.has(row.productId)
   ||!safe(row.unitNumber,250)||!['FIELD','SHOP'].includes(row.placement)
   ||!safe(row.customer,250)||!safe(row.site,250)||!safe(row.address,600)
   ||!Number.isSafeInteger(row.revision)||row.revision<1
   ||!['pending','published','conflict','failed'].includes(row.syncState)
   ||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))
   throw Error('Malformed operational owner decision');
  const match=sourceById.get(row.productId);
  if(!match||match.unitNumber!==row.unitNumber)throw Error('Operational Product ID identity changed');
  unique.set(row.productId,row);
 }
 if(!unique.size)return {...snapshot,operationalOverrides:overrides};
 const records:Row[]=snapshot.fleetRoster.items;
 for(const productId of unique.keys())if(records.filter(r=>Array.isArray(r.productIds)&&r.productIds.includes(productId)).length!==1)
  throw Error('Operational Product ID is not uniquely represented in the Fleet roster');
 const updated=records.map((r:Row)=>{
  if(!Array.isArray(r.productIds)||r.productIds.length!==1||!unique.has(r.productIds[0]))return {...r};
  const move=unique.get(r.productIds[0])!,placement=p(move.placement);
  if(!active(r))return r; // Lifecycle is never overridden.
  const detail={
   operationalPlacement:move.placement,operationalRevision:move.revision,
   operationalSyncState:move.syncState,operationalChangedAt:move.updatedAt,
   recordedSourceAddress:r.sourceAddress??null
  };
  if(r.kind!=='unit'){
   // The Product ID may move without a verified camera identity; never invent
   // a native unit or attach provider resources to it.
   const {recordedSourcePlacement:_old,...base}=r;
   return {...base,...detail,kind:'source_equipment',source:'owner',
    placement,customer:move.customer,site:move.site,
    sourceAddress:{street:move.address,city:'',state:'',zip:''}};
  }
  if(!object(r.unit)||!uuid(r.unitId)||r.unit.id!==r.unitId||r.unit.unitNumber!==r.unitNumber)
   throw Error('Operational placement cannot change a nonmatching COS unit identity');
  const unit={...r.unit,placement:move.placement,currentLocationType:placement,
   customer:move.customer,site:move.site,address:move.address,
   effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:placement,
    source:'owner_operational',observedAt:move.updatedAt,freshness:'current',reason:null},
   // A changed physical site invalidates DISPLAYED live points, but all
   // stored GPS/history/source records remain completely untouched.
   latitude:null,longitude:null,coordinateSource:null,hasUnitGps:false,
   locationVerification:'address_changed',locationVerifiedAt:null,
   locationHistoryId:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null,
   locationImportedGeocode:null,locationSourceRecorded:null
  };
  return {...r,...detail,unit,placement,source:'owner',customer:move.customer,site:move.site,
   sourceAddress:{street:move.address,city:'',state:'',zip:''},
   reviewReason:r.reviewReason};
 });
 const inventoryItems=updated.filter(r=>r.kind==='unit').map(r=>({...r.unit,activeInventoryEligible:r.active}));
 const byId=new Map(inventoryItems.map(r=>[r.id,r]));
 for(const r of updated)if(r.kind==='unit')r.unit=byId.get(r.unitId); // Local cloned records only.
 const items=inventoryItems.filter(r=>r.effectivePlacement?.state==='field'&&r.activeInventoryEligible!==false);
 const count=(predicate:(r:Row)=>boolean)=>updated.filter(predicate).length;
 const rosterSummary={
  totalRecords:updated.length,activeRecords:count(r=>r.active),
  field:count(r=>r.active&&r.placement==='field'),
  shop:count(r=>r.active&&r.placement==='shop'),
  review:count(r=>r.active&&r.placement==='unknown'),
  excludedLifecycle:count(r=>!r.active),
  sourceOnlyRecords:count(r=>r.kind!=='unit'),
  linkedUnitRecords:count(r=>r.kind==='unit')
 };
 return {...snapshot,operationalOverrides:overrides,
  inventoryItems,items,
  fleetRoster:{...snapshot.fleetRoster,items:updated,summary:rosterSummary},
  placementSummary:{...snapshot.placementSummary,fieldUnits:items.length,
    shopUnits:inventoryItems.filter(r=>r.activeInventoryEligible!==false&&r.effectivePlacement?.state==='shop').length,
    reviewUnits:inventoryItems.filter(r=>r.activeInventoryEligible!==false&&r.effectivePlacement?.state==='unknown').length},
  summary:{...snapshot.summary,fieldUnits:items.length,
    mappedUnits:items.filter(r=>r.latitude!=null&&r.longitude!=null).length,
    unitGps:items.filter(r=>r.hasUnitGps===true).length,
    missingGps:items.filter(r=>r.latitude==null||r.longitude==null).length,
    addressUnits:items.filter(r=>typeof r.address==='string'&&r.address.trim()).length}
 };
}
