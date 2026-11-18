import {admit} from './trackerEndpointProducer.mjs';
// Optional saved-data attachment. Never invokes the check/producer adapter.
export async function attachTrackerEndpoints(base,{packet,source,census,signal,now=Date.now()}) {
 const empty={contract:'COS_TRACKER_ENDPOINT_DISPLAY_V1',sourceSha256:base.sourceSha256,items:[]};
 const unchanged=()=>({...base,trackerEndpoints:empty});
 try {
  if(signal?.aborted||!packet?.authority||!Array.isArray(packet.receipts)||packet.receipts.length>10000||source.complete!==true||!Number.isFinite(Date.parse(source.verifiedAt))||now-Date.parse(source.verifiedAt)>26000||Date.parse(source.verifiedAt)>now) return unchanged();
  const a=packet.authority;
  if(a.sourceSha256!==base.sourceSha256||a.sourceSha256!==source.upload.sourceSha256||a.trackerSha256!==source.tracker.trackerSourceSha256||census.sourceSha256!==base.sourceSha256)return unchanged();
  const devices=source.identitySources.devices;
  if(new Set(devices.map(d=>String(d.id))).size!==devices.length||new Set(packet.receipts.map(r=>r.productId)).size!==packet.receipts.length)return unchanged();
  const items=[];
  for(const r of packet.receipts){
   const raw=source.upload.records.find(p=>p.productId===r.productId),projected=census.records.find(p=>p.productId===r.productId),b=raw?.binding;
   const t=source.tracker.records.filter(p=>p.productId===r.productId),p=a.products.find(p=>p.productId===r.productId);
   if(!b||b.nativeUnitId!==null||b.guardCurrent!==true||b.trackerId!==p?.binding?.trackerId||b.expectedGuard!==p.binding.guard||raw.placement!=='FIELD'||raw.lifecycle!=='UNFLAGGED'||projected?.binding?.state!=='linked'||projected.binding.reason||projected.binding.placementHeld||projected.binding.candidateUnitIds?.length||projected.binding.unitIds?.length!==1||projected.binding.unitIds[0]!==b.trackerId||t.length!==1||t[0].publicIp!==p.ip||t[0].reviewReasons?.length)continue;
   if(source.tracker.records.filter(t=>t.publicIp===p.ip).length!==1)continue;
   const ds=devices.filter(d=>d.public_ip===p.ip);
   if(ds.length!==1)continue;
   const d=ds[0],saved=a.endpoints.filter(e=>e.ip===p.ip);
   if([d.device_name,d.unit_key,d.activation_state,d.organization].some(v=>typeof v==='string'&&/(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v)))continue;
   if(saved.length!==1||String(d.id)!==saved[0].id||String(d.connection_revision)!==saved[0].revision||d.monitoring_enabled!==true||d.activation_state!=='active'||JSON.stringify([...d.expected_ports].sort((a,b)=>a-b))!==JSON.stringify([...saved[0].ports].sort((a,b)=>a-b)))continue;
   // Fresh protected reads corroborate the saved admitted authority. Never refresh observation time.
   const current=await admit({...a,readAt:now},r.productId,now);
   if(signal?.aborted)return unchanged();
   if(r.contract!=='COS_TRACKER_ENDPOINT_RECEIPT_PROTOTYPE_V1'||r.scope!=='assigned_endpoint_only'||r.assignmentContinuity!=='observed_snapshots_only'||r.authorityGuard!==current.authorityGuard||r.assignmentEpoch!==a.assignmentEpoch||r.collisionEpoch!==a.collisionEpoch||!['responded','no_response'].includes(r.status)||!Number.isFinite(r.checkedAt)||!Number.isFinite(r.startedAt)||r.startedAt>r.checkedAt||r.checkedAt>now||now-r.checkedAt>600000||r.expiresAt!==r.checkedAt+600000||r.expiresAt<=now)continue;
   if(Object.keys(current).some(k=>JSON.stringify(r[k])!==JSON.stringify(current[k])))continue;
   if(!Array.isArray(r.portOutcomes)||r.portOutcomes.length!==current.ports.length||new Set(r.portOutcomes.map(o=>o.port)).size!==current.ports.length||r.portOutcomes.some(o=>!current.ports.includes(o.port)||o.attempted!==true||!['responded','refused','network_timeout'].includes(o.outcome)||o.error||o.technicalError||o.cancelled))continue;
   if(r.status!==(r.portOutcomes.some(o=>o.outcome==='responded')?'responded':'no_response'))continue;
   if(!Number.isFinite(r.sourceObservedAt)||!Number.isFinite(r.sourceRecheckedAt)||r.sourceObservedAt>r.startedAt||r.sourceRecheckedAt<r.checkedAt||r.sourceRecheckedAt>now)continue;
   items.push({assignmentContinuity:'observed_snapshots_only',sourceObservedAt:r.sourceObservedAt,sourceRecheckedAt:r.sourceRecheckedAt,productId:r.productId,status:r.status,scope:'assigned_endpoint_only',checkedAt:r.checkedAt,expiresAt:r.expiresAt,cameraHealth:'unverified'});
  }
  return {...base,trackerEndpoints:{...empty,items}};
 }catch{return unchanged();}
}
