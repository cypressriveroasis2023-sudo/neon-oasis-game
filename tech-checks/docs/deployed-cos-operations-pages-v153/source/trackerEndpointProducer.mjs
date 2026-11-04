// LOCAL REVIEW PROTOTYPE. No network, database, deployment or default adapters.
// Adapters must be trusted server code; this contract is never client-supplied.
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]{0,14}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const rev = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
const canonical = v => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const digest = async v => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(b=>b.toString(16).padStart(2,'0')).join('');
// Deliberately IPv4-only and conservative. Production must reuse reviewed SSRF validation.
function publicIPv4(ip) {
 if(typeof ip!=='string'||!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
 const a=ip.split('.').map(Number);if(a.some((n,i)=>n>255||String(n)!==ip.split('.')[i]))return false;
 const [x,y,z]=a;return !(x===0||x===10||x===127||x>=224||x===100&&y>=64&&y<=127||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&(y===168||y===0||y===2)||x===198&&(y===18||y===19||y===51&&z===100)||x===203&&y===0&&z===113);
}
const unknown = reason => ({contract:'COS_TRACKER_ENDPOINT_RESULT_PROTOTYPE_V1',status:'unknown',scope:'assigned_endpoint_only',reason,cameraHealth:'unverified'});
export async function admit(source, productId, now) {
 const fail=()=>{throw Error('authority_unavailable');};
 if(!ID.test(productId)||!source||source.contract!=='COS_TRACKER_ENDPOINT_AUTHORITY_PROTOTYPE_V1'||source.complete!==true||source.collisionSetComplete!==true||!HASH.test(source.sourceSha256)||!HASH.test(source.trackerSha256)||!rev(source.trackerRevision)||!HASH.test(source.assignmentEpoch)||!HASH.test(source.collisionEpoch)||source.expectedMhelpSourceSha256!==source.sourceSha256||!Number.isFinite(source.readAt)||source.readAt>now||now-source.readAt>26000||!Array.isArray(source.products)||!Array.isArray(source.endpoints)||!Array.isArray(source.retainedClaims)||source.retainedClaims.length>10000||source.products.length>10000||source.endpoints.length>10000)fail();
 if(new Set(source.products.map(p=>p.productId)).size!==source.products.length||new Set(source.endpoints.map(e=>e.id)).size!==source.endpoints.length)fail();
 const p=source.products.find(p=>p.productId===productId),b=p?.binding;
 if(!p||p.placement!=='FIELD'||p.lifecycle!=='UNFLAGGED'||p.support!==false||p.holds?.length!==0||p.reviewReasons?.length!==0||!b||b.current!==true||b.nativeUnitId!==null||!UUID.test(b.trackerId)||!HASH.test(b.guard)||b.state!=='linked'||b.readOnlyTracker!==true||b.representedIds?.length!==1||b.representedIds[0]!==b.trackerId||!publicIPv4(p.ip))fail();
 // Complete adapter includes active, SHOP, missing, archived and retained claims.
 if(source.products.filter(v=>v.ip===p.ip).length!==1||source.retainedClaims.some(v=>v.ip===p.ip))fail();
 const matches=source.endpoints.filter(e=>e.ip===p.ip);if(matches.length!==1)fail();
 const e=matches[0];if(!ID.test(e.id)||!rev(e.revision)||e.active!==true||e.enabled!==true||e.holds?.length!==0||!Array.isArray(e.ports)||e.ports.length<1||e.ports.length>32||new Set(e.ports).size!==e.ports.length||e.ports.some(v=>!Number.isInteger(v)||v<1||v>65535))fail();
 const authority={productId,trackerId:b.trackerId,bindingGuard:b.guard,sourceSha256:source.sourceSha256,trackerSha256:source.trackerSha256,trackerRevision:source.trackerRevision,assignmentEpoch:source.assignmentEpoch,collisionEpoch:source.collisionEpoch,endpointId:e.id,endpointRevision:e.revision,ip:e.ip,ports:[...e.ports].sort((a,b)=>a-b)};
 // Hash whole claim/config universe: timestamp-only re-reads do not invalidate.
 return {...authority,authorityGuard:await digest({authority,products:source.products,endpoints:source.endpoints,retainedClaims:source.retainedClaims})};
}
export async function produce(productId, adapters, {signal,now=Date.now,budgetMs=5000}={}) {
 const started=now(),deadline=started+Math.min(5000,Math.max(1,budgetMs));
 const controller=new AbortController();let timer;let stop;
 const cancelled=new Promise((_,reject)=>{stop=()=>{controller.abort();reject(Error('cancelled_or_deadline'));};timer=setTimeout(stop,deadline-started);});
 signal?.addEventListener('abort',stop,{once:true});
 const check=()=>{if(signal?.aborted||controller.signal.aborted||now()<started||now()>=deadline)throw Error('cancelled_or_deadline');};
 const call=async fn=>{check();const r=await Promise.race([Promise.resolve().then(()=>{check();return fn(controller.signal);}),cancelled]);check();return r;};
 let writing=false;
 try {
  const firstSource=await call(adapters.readAuthority);const before=await admit(firstSource,productId,now());check();
  const checkStartedAt=now();
  const outcome=await call(s=>adapters.checkEndpoint(before,s));
  if(!outcome||outcome.error||outcome.technicalError||outcome.cancelled||outcome.complete!==true||outcome.authorityGuard!==before.authorityGuard||outcome.ip!==before.ip||outcome.endpointRevision!==before.endpointRevision||!Number.isFinite(outcome.startedAt)||outcome.startedAt<checkStartedAt||!Number.isFinite(outcome.completedAt)||outcome.completedAt<outcome.startedAt||outcome.completedAt>now()||!Array.isArray(outcome.ports)||outcome.ports.length!==before.ports.length)throw Error('incomplete_check');
  const ports=new Map(outcome.ports.map(p=>[p.port,p]));
  if(ports.size!==before.ports.length||before.ports.some(p=>!ports.has(p))||outcome.ports.some(p=>p.attempted!==true||!['responded','refused','network_timeout'].includes(p.outcome)||p.technicalError||p.cancelled))throw Error('incomplete_check');
  const lastSource=await call(adapters.readAuthority);const after=await admit(lastSource,productId,now());
  if(firstSource.readAt>outcome.startedAt||lastSource.readAt<outcome.completedAt||before.authorityGuard!==after.authorityGuard)throw Error('authority_changed');
  const receipt={contract:'COS_TRACKER_ENDPOINT_RECEIPT_PROTOTYPE_V1',...before,sourceObservedAt:firstSource.readAt,sourceRecheckedAt:lastSource.readAt,startedAt:outcome.startedAt,checkedAt:outcome.completedAt,expiresAt:outcome.completedAt+600000,status:outcome.ports.some(p=>p.outcome==='responded')?'responded':'no_response',portOutcomes:outcome.ports,scope:'assigned_endpoint_only',assignmentContinuity:'observed_snapshots_only'};
  check();writing=true;
  // REQUIRED: transactional compare-and-append using ALL authority guards/epochs,
  // deadline and cancellation fence. A plain insert is NOT a compliant adapter.
  const result=await call(s=>adapters.commitIfCurrent({receipt,expected:after,deadline},s));
  if(result?.committed!==true)return unknown('commit_not_current');
  return {contract:'COS_TRACKER_ENDPOINT_RESULT_PROTOTYPE_V1',productId,status:receipt.status,scope:receipt.scope,checkedAt:receipt.checkedAt,cameraHealth:'unverified'};
 } catch {return unknown(writing?'commit_unconfirmed_no_retry':'authority_or_check_unavailable');}
 finally {clearTimeout(timer);signal?.removeEventListener('abort',stop);controller.abort();}
}
