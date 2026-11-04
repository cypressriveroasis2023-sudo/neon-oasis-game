// Scheduled source contract from deployed publisher v17. Only its tracker-reader
// dependency changes: use the same tested recorded-production reader as v154.
import {existingNativeProductSourceContext} from '../../fleet-provenance-repair-20261104/source/productTcpRuntime.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
const baselineFlights=new Map();
function sharedBaselineRead(load){const key=NATIVE+'/rest/v1/rpc/cos_mhelp_inventory_baseline';const pending=baselineFlights.get(key);if(pending)return pending;const flight=Promise.resolve().then(load);baselineFlights.set(key,flight);flight.finally(()=>{if(baselineFlights.get(key)===flight)baselineFlights.delete(key);}).catch(()=>{});return flight;}
const VERIFY='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness';
const H=/^[a-f0-9]{64}$/,ID=/^[1-9][0-9]{0,14}$/;
async function json(response,signal,max){
 if(!response.ok||!response.body||Number(response.headers.get('content-length'))>max)throw Error('Read unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
 try{for(;;){if(signal.aborted)throw Error('Cancelled');const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max)throw Error('Read exceeds bound');text+=decoder.decode(r.value,{stream:true});}return JSON.parse(text+decoder.decode());}
 finally{void reader.cancel().catch(()=>{});}
}
function baseline(value,now){
 if(value?.contract!=='COS_MHELP_API_V1'||value.origin!=='mhelpdesk_api'||value.complete!==true||value.reviewed!==true||!H.test(value.sourceSha256)||value.apiSync?.enabled!==true||!Number.isFinite(Date.parse(value.apiSync.lastSuccessAt))||Date.parse(value.apiSync.lastSuccessAt)>now||now-Date.parse(value.apiSync.lastSuccessAt)>2700000||!Array.isArray(value.records)||!value.records.length||value.records.length>10000)throw Error('Current complete inventory required');
 const proof=value.trackerEndpointMembership;
 if(proof?.contract!=='COS_TRACKER_ENDPOINT_MEMBERSHIP_V1'||proof.sourceSha256!==value.sourceSha256||!Array.isArray(proof.records)||proof.records.length!==value.records.length||new Set(proof.records.map(r=>r.productId)).size!==proof.records.length||new Set(value.records.map(r=>r.productId)).size!==value.records.length)throw Error('Complete tracker membership required');
 return value;
}
export async function readScheduledNativeEndpointSource({readBaseline,readTracker,signal,now=Date.now}){
 if(signal.aborted)throw Error('Cancelled');
 const source=baseline(await readBaseline(signal),now());
 if(!Array.isArray(source.apiMissingRecords)||source.apiMissingRecords.length>10000)throw Error('Complete absence evidence required');
 const absentProductIds=source.apiMissingRecords.map(r=>r.productId);
 if(absentProductIds.some(id=>typeof id!=='string'||!ID.test(id)||source.records.some(r=>r.productId===id))||new Set(absentProductIds).size!==absentProductIds.length)throw Error('Invalid absence evidence');
 const tracker=await readTracker(source.records,source.sourceSha256,signal,absentProductIds);
 if(signal.aborted||tracker.expectedMhelpSourceSha256!==source.sourceSha256||!H.test(tracker.trackerSourceSha256)||!Array.isArray(tracker.records)||tracker.records.length!==source.records.length||new Set(tracker.records.map(r=>r.productId)).size!==tracker.records.length)throw Error('Source changed');
 const terminal=v=>typeof v==='string'&&/(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
 const products=source.records.map(raw=>{
  const t=tracker.records.find(t=>t.productId===raw.productId),proof=source.trackerEndpointMembership.records.find(p=>p.productId===raw.productId),b=raw.binding;
  if(!ID.test(raw.productId)||!t||!proof||!Array.isArray(t.reviewReasons)||!['FIELD','SHOP'].includes(raw.placement))throw Error('Incomplete Product census');
  const held=!!raw.holdReason||!!raw.placementHeld||!!raw.possibleAliasUnitIds?.length||terminal(raw.unitNumber)||t.placement!==raw.placement||b&&proof.bindingGuard!==b.expectedGuard||b&&proof.trackerId!==b.trackerId;
  return {productId:raw.productId,placement:raw.placement,lifecycle:raw.lifecycle,support:/(stand|pole|skid)/i.test(raw.category||''),ip:t.publicIp,holds:held?['existing_source_hold']:[],reviewReasons:t.reviewReasons,binding:b?{current:b.guardCurrent===true,nativeUnitId:b.nativeUnitId,trackerId:b.trackerId,guard:b.expectedGuard,state:'linked',readOnlyTracker:proof.readOnlyTracker===true,representedIds:[b.trackerId]}:null};
 }).sort((a,b)=>a.productId.localeCompare(b.productId));
 return {contract:'COS_SCHEDULED_TRACKER_ENDPOINT_SOURCE_V1',complete:true,sourceSha256:source.sourceSha256,trackerSha256:tracker.trackerSourceSha256,observedAt:now(),products};
}
export function createScheduledNativeEndpointSourceRuntime({enabled=false,snapshotSource=false,getEnv,fetch:fetcher=fetch,signAssertion,now=Date.now}){
 return async request=>{
  const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(!enabled)return reply({error:'Endpoint source disabled'},503);
  if(request.method!=='POST'||new URL(request.url).search||request.headers.has('origin')||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return reply({error:'Scheduled read required'},405);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(30000)]);
  try{
   if(getEnv('SUPABASE_URL')!==NATIVE)throw Error('Wrong backend');
   const secret=request.headers.get('x-camera-cron-secret');
   if(!secret||secret.length>1024||/\s/.test(secret))return reply({error:'Forbidden'},403);
   const verified=await json(await fetcher(VERIFY,{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':secret},body:'{"action":"authenticate"}',redirect:'error',cache:'no-store',signal}),signal,128);
   if(verified?.authenticated!==true||Object.keys(verified).length!==1)return reply({error:'Forbidden'},403);
   const body=await json(new Response(request.body),signal,64);
   if(!body||body.action!=='read'||Object.keys(body).length!==1)return reply({error:'Invalid source request'},400);
   const readBaseline=async()=>{
    const key=getEnv('SUPABASE_SERVICE_ROLE_KEY');if(!key)throw Error('Backend unavailable');
    return sharedBaselineRead(async()=>json(await fetcher(NATIVE+'/rest/v1/rpc/cos_mhelp_inventory_baseline',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',redirect:'error',cache:'no-store',signal}),signal,4194304));
   };
   if(snapshotSource){
    const last=baseline(await readBaseline(),now());
    const identity=last.cameraSnapshotSources;
    if(!identity||![identity.units,identity.matches,identity.providers,identity.trackerUnits].every(a=>Array.isArray(a)&&a.length<=100000)||!Array.isArray(identity.ownerCrosswalk?.claims))throw Error('Identity source unavailable');
    const fields=['productId','unitNumber','category','customer','customerId','placement','lifecycle','binding','holdReason','placementHeld','possibleAliasUnitIds'];
    const minimal={contract:last.contract,origin:last.origin,complete:last.complete,reviewed:last.reviewed,sourceSha256:last.sourceSha256,apiSync:last.apiSync,records:last.records.map(r=>Object.fromEntries(fields.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])))};
    return reply({contract:'COS_CAMERA_SNAPSHOT_SOURCE_V1',complete:true,baseline:minimal,identitySources:{units:identity.units,matches:identity.matches,providers:identity.providers,ownerCrosswalk:identity.ownerCrosswalk},trackerUnits:identity.trackerUnits});
   }
   const io=existingNativeProductSourceContext({source:{},googleSheets:{getServiceAccountJson:()=>getEnv('COS_GOOGLE_SERVICE_ACCOUNT_JSON'),signAssertion,fetch:fetcher},now});
   return reply(await readScheduledNativeEndpointSource({readBaseline,readTracker:io.tracker,signal,now}));
  }catch(error){console.error('Scheduled endpoint source failure',error?.name,error?.message);return reply({error:'Scheduled endpoint source unavailable'},503);}
 };
}
