/** Placement presentation only. No provider status, native equipment, GPS or address writes. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const safe=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=250&&!/[\x00-\x1f\x7f<>]/.test(v);
const concern=(v:unknown)=>typeof v==='string'?v.toLowerCase().replace(/[^a-z0-9]/g,''):'';
export function checkedMhelpPlacements(value:unknown,now=Date.now()):Row[] {
 if(!object(value)||value.contract!=='COS_MHELP_PLACEMENT_V1'||!Array.isArray(value.items)||value.items.length>1000)throw Error('Invalid placement receipt');
 const seen=new Set<string>();
 for(const r of value.items){
  if(!object(r)||!uuid(r.trackerId)||!(r.nativeUnitId===null||uuid(r.nativeUnitId))||!safe(r.trackerLabel)||!(r.nativeLabel===null||safe(r.nativeLabel))||!['confirmed','held'].includes(r.state)||seen.has(r.trackerId))throw Error('Invalid placement identity');
  seen.add(r.trackerId);
  if(r.state==='confirmed'&&(!['FIELD','SHOP'].includes(r.placement)||!safe(r.customerLabel)||!safe(r.siteLabel)||typeof r.locationReview!=='boolean'||typeof r.observedAt!=='string'||!Number.isFinite(Date.parse(r.observedAt))))throw Error('Invalid placement observation');
 }
 const native=value.items.filter((r:Row)=>r.nativeUnitId!==null).map((r:Row)=>r.nativeUnitId);
 if(new Set(native).size!==native.length)throw Error('Duplicate placement identity');
 if(value.enabled===false)return [];
 return value.items.filter((r:Row)=>r.state==='confirmed'&&Date.parse(r.observedAt)<=now&&now-Date.parse(r.observedAt)<=40*60*1000);
}
function protectedByHistory(r:Row,audits:Row[],identity?:Row){
 const proof=[...(identity?.unitIdentities||[]),...(identity?.ownerConfirmedUnitIdentities||[])].filter(p=>p.unitId===r.nativeUnitId);
 const labels=[r.nativeLabel,r.trackerLabel,...proof.flatMap(p=>p.unitKeys||[])].filter(Boolean).map(concern);
 const devices=proof.flatMap(p=>p.deviceIds||[]);
 return audits.some(a=>labels.includes(concern(a.unit_key))||uuid(a.control_id)&&(a.control_id===r.nativeUnitId||a.control_id===r.trackerId)||Array.isArray(a.device_ids)&&a.device_ids.some((id:unknown)=>devices.includes(String(id))));
}
export function projectMhelpFieldPlacement(snapshot:Row,receipt:unknown,audits:Row[],identity?:Row,now=Date.now()):Row {
 const links=checkedMhelpPlacements(receipt,now);
 if(!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!object(snapshot.summary)||!Array.isArray(audits))throw Error('Invalid placement inputs');
 const byId=new Map<string,Row>();
 for(const link of links){if(protectedByHistory(link,audits,identity))continue;byId.set(link.trackerId,link);if(link.nativeUnitId)byId.set(link.nativeUnitId,link);}
 // An unavailable/stale source must not resurrect an older imported field pin.
 if((receipt as Row).enabled!==false)for(const r of (receipt as Row).items){
  if(r.guardCurrent!==true||links.includes(r)||protectedByHistory(r,audits,identity))continue;
  const held={...r,uncertain:true};byId.set(r.trackerId,held);if(r.nativeUnitId)byId.set(r.nativeUnitId,held);
 }
 const fieldIds=new Set(snapshot.items.map((r:Row)=>r.id));
 const inventoryItems=snapshot.inventoryItems.map((row:Row)=>{
  const link=byId.get(row.id),label=link&&(row.id===link.nativeUnitId?link.nativeLabel:link.trackerLabel);
  if(!link||row.unitNumber!==label||row.placementSource==='owner'||row.placementReviewReason||row.hasUnitGps||row.installedSiteId)return row;
  if(link.uncertain)return {...row,placement:'UNKNOWN',placementSource:'mhelpdesk',currentLocationType:'unknown',mhelpPlacementReview:'Current mHelpDesk assignment is unavailable; verify placement',latitude:null,longitude:null,coordinateSource:null,importedInstallation:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null};
  const locationReview=link.locationReview;
  return {...row,placement:link.placement,placementSource:'mhelpdesk',currentLocationType:link.placement.toLowerCase(),
   site:link.siteLabel,customer:link.customerLabel,mhelpObservedAt:link.observedAt,mhelpLocationReview:locationReview,
   _sourceField:link.placement==='FIELD',...(locationReview?{address:null,addressSource:'mHelpDesk assignment changed; verify installation address',latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_changed',locationVerifiedAt:null,locationHistoryId:null,importedInstallation:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null}:{}),
   ...(link.placement==='SHOP'?{latitude:null,longitude:null,coordinateSource:null}:{} )};
 });
 const items=inventoryItems.filter((r:Row)=>r.placementSource==='mhelpdesk'?r.placement==='FIELD':fieldIds.has(r.id)).map((r:Row)=>{const{_sourceField,_placementProof,...item}=r;return item;});
 return {...snapshot,inventoryItems,items,mhelpPlacementSync:{contract:'COS_MHELP_PLACEMENT_V1',confirmedLinks:links.length,lastSuccessAt:(receipt as Row).lastSuccessAt,sheetsPublisher:false},
  summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length}};
}
/** Only complete, current provider/native UUID proofs can carry placement onto camera cards. */
export function projectMhelpCameraPlacement(devices:Row[],receipt:unknown,audits:Row[],identity:Row,now=Date.now()):Row[] {
 const links=checkedMhelpPlacements(receipt,now),changes=new Map<string,Row>();
 const proofs=[...(identity.unitIdentities||[]),...(identity.ownerConfirmedUnitIdentities||[])];
 for(const link of links){
  if(!link.nativeUnitId||protectedByHistory(link,audits,identity)||(identity.identityWarnings||[]).some((w:Row)=>w.unitId===link.nativeUnitId))continue;
  const matches=proofs.filter(p=>p.unitId===link.nativeUnitId&&p.unitNumber===link.nativeLabel&&['native_provider','owner_confirmed_native'].includes(p.kind));
  if(matches.length!==1)continue;
  const proof=matches[0],ids=proof.deviceIds;
  if(!Array.isArray(ids)||!ids.length||!Array.isArray(proof.unitKeys)||proofs.some(p=>p!==proof&&p.deviceIds.some((id:string)=>ids.includes(id))))continue;
  const group=devices.filter(d=>proof.unitKeys.includes(d.unit_key));
  if(group.length!==ids.length||new Set(group.map(d=>String(d.id))).size!==ids.length||group.some(d=>!ids.includes(String(d.id))))continue;
  for(const d of group)if(d.activation_state==='active'&&!/^(?:RETIRED|STOLEN|NOT IN USE)$/i.test(d.organization||''))changes.set(String(d.id),link);
 }
 return devices.map(d=>{const link=changes.get(String(d.id));return link?{...d,organization:link.placement==='SHOP'?'ROOT':'mHelpDesk Field · '+link.siteLabel,__ownerPlacement:link.placement}:d;});
}
