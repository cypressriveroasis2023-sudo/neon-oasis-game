type Row=Record<string,any>;
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const safe=(v:unknown,max=600)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
/** Current guarded service locations; no inventory, GPS, or provider writes. */
export function projectMhelpFleetLocations(snapshot:Row,receipt:Row|null,now=Date.now()):Row{
 if(!receipt||receipt.contract!=='COS_MHELP_FLEET_LOCATIONS_V1'||!Array.isArray(receipt.items)||receipt.items.length>2000)return snapshot;
 const byId=new Map<string,Row>();
 for(const r of receipt.items){
  if(!uuid(r.unitId)||!safe(r.unitNumber,160)||byId.has(r.unitId)||!['confirmed','held'].includes(r.state))throw Error('Invalid location inventory');
  byId.set(r.unitId,r);
 }
 const inventory=(snapshot.inventoryItems||snapshot.items).map((unit:Row)=>{
  const r=byId.get(unit.id);if(!r||r.unitNumber!==unit.unitNumber)return unit;
  const time=Date.parse(r.observedAt),current=r.guardCurrent===true&&Number.isFinite(time)&&time<=now&&now-time<=40*60*1000&&(receipt.errorCode==null||time>=Date.parse(receipt.lastAttemptAt));
  if(!current||r.state!=='confirmed')return {...unit,mhelpLocationReviewReason:!current?'Current mHelpDesk location evidence is unavailable':String(r.reason||'mHelpDesk equipment identity needs review').replaceAll('_',' ')};
  if(!['FIELD','SHOP'].includes(r.placement)||!safe(r.customer,250)||!safe(r.site,250)||r.address!==null&&!safe(r.address))throw Error('Invalid service location');
  if(r.point!==null&&(!Array.isArray(r.point)||r.point.length!==2||r.point.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(r.point[0])>90||Math.abs(r.point[1])>180))throw Error('Invalid service point');
  const assignmentAt=Date.parse(unit.mhelpObservedAt);
  if(unit.placementSource==='mhelpdesk'&&Number.isFinite(assignmentAt)&&assignmentAt>time
    &&(unit.placement!==r.placement||unit.customer!==r.customer||unit.site!==r.site))
    return {...unit,mhelpLocationReviewReason:'A newer mHelpDesk assignment supersedes this saved service location. Refresh its address evidence.'};
  const evidence={contract:receipt.contract,placement:r.placement,customer:r.customer,site:r.site,unitId:unit.id,unitNumber:unit.unitNumber,address:r.address,point:r.point,coordinateSource:r.coordinateSource,observedAt:r.observedAt,verified:false};
  // Explicit Owner installation/placement remains protected. The current vendor
  // address is still shown for review instead of being silently discarded.
  if(unit.placementSource==='owner'||unit.hasUnitGps||unit.installedSiteId||unit.placementAuditId||unit.placementStatus==='needs_identity_review')return {...unit,mhelpLocation:evidence,mhelpCurrentPlacement:r.placement,mhelpLocationReviewReason:r.address&&unit.address!==r.address?'mHelpDesk service address differs from the protected saved installation':null};
  const changed=unit.address!==r.address;
  return {...unit,placement:r.placement,placementSource:'mhelpdesk',currentLocationType:r.placement.toLowerCase(),status:r.placement==='FIELD'?'field':unit.status,customer:r.customer,site:r.site,address:r.address,
   addressSource:'mHelpDesk service location',mhelpObservedAt:r.observedAt,mhelpLocation:evidence,mhelpLocationReviewReason:r.reason||null,mhelpLocationReview:!r.address,
   ...(changed||r.placement==='SHOP'?{historicalLatitude:unit.latitude??unit.historicalLatitude,historicalLongitude:unit.longitude??unit.historicalLongitude,latitude:null,longitude:null,coordinateSource:null,importedInstallation:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null,locationVerification:'address_only'}:{})};
 });
 const fieldIds=new Set(snapshot.items.map((r:Row)=>r.id));
 const items=inventory.filter((r:Row)=>r.placementSource==='mhelpdesk'?r.placement==='FIELD':fieldIds.has(r.id));
 return {...snapshot,inventoryItems:inventory,items,mhelpLocationSync:{readAt:receipt.lastSuccessAt,review:inventory.filter((r:Row)=>r.mhelpLocationReviewReason).length},summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length}};
}
