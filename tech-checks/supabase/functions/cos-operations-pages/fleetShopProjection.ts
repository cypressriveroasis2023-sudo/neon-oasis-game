type Row=Record<string,any>;
export type ManualShop={unitId:string;unitNumber:string;auditId:string;recordedAt:string;placement:'SHOP';sourceBindings?:{productId:string;sourceSha256:string;sourceUnitNumber?:string}[]};
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function manualShopItems(value:any):ManualShop[]{
 if(value?.contract!=='COS_FLEET_SHOP_OVERRIDES_V1'||!Array.isArray(value.items)||value.items.length>10000||value.items.some((r:any)=>!uuid(r.unitId)||!uuid(r.auditId)||typeof r.unitNumber!=='string'||!r.unitNumber.trim()||r.placement!=='SHOP'||!Number.isFinite(Date.parse(r.recordedAt)))||value.items.some((r:any)=>r.sourceBindings!==undefined&&(!Array.isArray(r.sourceBindings)||r.sourceBindings.length>10000||r.sourceBindings.some((b:any)=>! /^(?:[1-9]\d*)$/.test(b.productId)||! /^(?:[a-f0-9]{64})$/.test(b.sourceSha256))))||new Set(value.items.map((r:any)=>r.unitId)).size!==value.items.length)throw Error('Manual Shop placement is unavailable.');
 return value.items;
}
export function projectManualShop(snapshot:Row,receipt:any):Row{
 const upload=snapshot.uploadInventory,uploaded=upload?.source!=='mhelpdesk_api'?Date.parse(upload?.receivedAt):NaN;
 const applied=manualShopItems(receipt).filter(move=>{
  const matches=(snapshot.inventoryItems||[]).filter((r:Row)=>r.id===move.unitId&&r.unitNumber===move.unitNumber);
  return matches.length===1&&!(Number.isFinite(uploaded)&&uploaded>Date.parse(move.recordedAt))&&!(matches[0].placementSource==='owner'&&Date.parse(matches[0].placementUpdatedAt)>Date.parse(move.recordedAt));
 });
 const byId=new Map(applied.map(r=>[r.unitId,r]));
 const productIds=new Set<string>(applied.flatMap(m=>(m.sourceBindings||[]).filter(b=>b.sourceSha256===upload?.sourceSha256||(upload?.source==='mhelpdesk_api'&&upload.records.some((r:Row)=>r.productId===b.productId&&r.unitNumber===b.sourceUnitNumber))).map(b=>b.productId)));
 for(const r of upload?.records||[])if(r.binding?.state==='linked'&&r.binding.unitIds?.length===1&&byId.has(r.binding.unitIds[0]))productIds.add(r.productId);
 const isShop=(r:Row)=>byId.has(r.id)||byId.has(r.unitId)||r.kind!=='identity_review'&&(r.productIds?.some((p:string)=>productIds.has(p))||r.productId&&productIds.has(r.productId));
 const change=(row:Row)=>{const move=byId.get(row.id)||byId.get(row.unitId);return isShop(row)?{...row,placement:'SHOP',currentLocationType:'shop',status:'available',effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'shop',source:'cos_manual_shop',observedAt:move?.recordedAt||null,freshness:'recorded',reason:null},placementSource:'cos_manual_shop',manualShopAuditId:move?.auditId||null}:row;};
 const inventoryItems=(snapshot.inventoryItems||[]).map(change),items=(snapshot.items||[]).filter((r:Row)=>!isShop(r));
 let fleetRoster=snapshot.fleetRoster;
 if(fleetRoster?.contract&&Array.isArray(fleetRoster.items)){
  const changed=fleetRoster.items.map((r:Row)=>isShop(r)&&r.kind!=='identity_review'?{...r,placement:'shop',...(r.unit?{unit:change(r.unit)}:{})}:r),summary={...fleetRoster.summary};
  for(const field of ['field','shop','unknown'])if(field in summary)summary[field]=changed.filter((r:Row)=>r.active&&r.placement===field).length;
  summary.review=changed.filter((r:Row)=>r.active&&r.placement==='unknown').length;
  fleetRoster={...fleetRoster,items:changed,summary};
 }
 return {...snapshot,items,inventoryItems,...(fleetRoster?{fleetRoster}:{}),manualPlacementOverrides:{contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:applied},summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,unitGps:items.filter((r:Row)=>r.hasUnitGps===true).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length},...(snapshot.placementSummary?{placementSummary:{...snapshot.placementSummary,fieldUnits:items.length,reviewUnits:inventoryItems.filter((r:Row)=>r.activeInventoryEligible!==false&&r.effectivePlacement?.state==='unknown').length,shopUnits:inventoryItems.filter((r:Row)=>r.activeInventoryEligible!==false&&(r.effectivePlacement?.state==='shop'||String(r.placement).toLowerCase()==='shop')).length}}:{})};
}
/** UI derivation only: preserve the accepted upload and its digests unchanged. */
export function manualShopInventory(upload:any,receipt:any):any{
 if(!upload?.records||!receipt)return upload;
 const moves=new Map(manualShopItems(receipt).map(r=>[r.unitId,r]));
 let count=0;const records=upload.records.map((r:Row)=>{const m=[...moves.values()].find(m=>(m.sourceBindings||[]).some(b=>b.productId===r.productId&&(b.sourceSha256===upload.sourceSha256||upload.source==='mhelpdesk_api'&&b.sourceUnitNumber===r.unitNumber)))||(r.binding?.state==='linked'&&r.binding.unitIds?.length===1?moves.get(r.binding.unitIds[0]):null);if(!m||r.placement==='SHOP')return r;count++;return {...r,placement:'SHOP',cosManualShopAuditId:m.auditId};});
 if(!count)return upload;
 const summary={...upload.summary,fieldRecords:records.filter((r:Row)=>r.placement==='FIELD').length,shopRecords:records.filter((r:Row)=>r.placement==='SHOP').length,unflaggedFieldRecords:records.filter((r:Row)=>r.placement==='FIELD'&&r.uploadLifecycle==='UNFLAGGED').length,unflaggedShopRecords:records.filter((r:Row)=>r.placement==='SHOP'&&r.uploadLifecycle==='UNFLAGGED').length};
 return {...upload,records,summary,cosManualShopCount:count,cosPlacementBasis:'Accepted mHelp inventory plus confirmed COS Shop moves'};
}
export function manualShopAddresses(result:any,effectiveUpload:any):any{
 if(!result||!effectiveUpload?.cosManualShopCount)return result;
 const shops=new Set(effectiveUpload.records.filter((r:Row)=>r.placement==='SHOP').map((r:Row)=>r.productId));
 const pins=result.pins.filter((r:Row)=>!shops.has(r.productId)),reviews=result.reviews.filter((r:Row)=>!shops.has(r.productId));
 return {...result,pins,reviews,totalField:pins.length+reviews.length,matched:pins.filter((r:Row)=>r.state==='matched').length,addressReview:pins.filter((r:Row)=>r.state==='address_review').length,unlocated:reviews.length};
}
