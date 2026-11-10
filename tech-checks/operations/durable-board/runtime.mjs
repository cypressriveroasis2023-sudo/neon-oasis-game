/** Durable Fleet board runtime. Called only after the existing fleet account
 * authorization. Opening and polling are read-only; only an explicit refresh
 * (manual or the visible client cadence) can claim the database lease. */

// The database lease is 180 seconds from the moment the lease was granted,
// not from when a worker starts. The claim reports how much of it is left and
// every deadline below is measured against that, so time spent handing the
// run over is never counted twice. The batch gives up before the lease ends
// so a slow run records a real failure instead of an unexplained interruption.
export const FLEET_LEASE_MS=180000;
// Used only if the claim did not report the remaining lease.
export const FLEET_BATCH_BUDGET_MS=165000;
// Source reads must end this long before the lease does, leaving time to
// project and publish.
export const COMMIT_RESERVE_MS=35000;
// The publish request is cut off at this length, and always before the lease.
export const COMMIT_REQUEST_MAX_MS=30000;
const LEASE_MARGIN_MS=3000,COMMIT_MIN_MS=5000;
const PAYLOAD_MARK='"@@COS_SAVED_FLEET_BOARD_PAYLOAD@@"';
const SAFE=/^[a-z0-9_]{1,48}$/;
const SOURCES=[
 // The map and connection endpoints both assemble the mHelp inventory.
 // Reads stay sequential so they do not compete on the same database.
 ['map','/api/fleet-map-source',70000],
 ['connections','/api/product-connections',45000],
 ['health','/api/camera-health/summary-v3',35000],
];

// One completed payload is immutable for its run. Keeping its serialized text
// lets polls and reopen return the stored board without re-reading or
// re-encoding the whole board from the database every few seconds.
let completed=null;
export function forgetSavedFleetPayload(){completed=null;}

const safe=value=>typeof value==='string'&&SAFE.test(value)?value:null;
// The transport turns an unreadable or truncated 200 into an empty object, so
// a reply only counts when it has the exact shape the database returns.
// Anything else is "unknown", never "no" and never "yes".
const UNKNOWN=Symbol('unknown');
const RUN_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const leaseAnswer=value=>value===null?null:value&&typeof value==='object'&&typeof value.id==='string'&&RUN_ID.test(value.id)?value:UNKNOWN;
const claimAnswer=value=>!value||typeof value!=='object'?UNKNOWN:value.claimed===false?false:value.claimed===true&&Number.isFinite(value.leaseRemainingMs)&&value.leaseRemainingMs>=0?value.leaseRemainingMs:UNKNOWN;
const statusAnswer=value=>value&&typeof value==='object'&&value.contract==='COS_DURABLE_FLEET_RESPONSE_V1'&&(value.latest===null||value.latest===undefined||typeof value.latest==='object')?value:UNKNOWN;
const whole=value=>Number.isFinite(value)?Math.max(0,Math.round(value)):null;
/** Only bounded categories leave a failed step. Never messages or bodies. */
function failureDetail(cause){
 const d=cause?.detail,out={};
 if(d&&typeof d==='object'){
  if(safe(d.kind))out.kind=d.kind;
  if(Number.isInteger(d.status)&&d.status>=100&&d.status<600)out.status=d.status;
  if(Number.isInteger(d.attempts)&&d.attempts>=0&&d.attempts<10)out.attempts=d.attempts;
  if(safe(d.stage))out.stage=d.stage;
  if(safe(d.code))out.code=d.code;
 }
 if(!out.kind)out.kind=safe(cause?.message)||'error';
 return out;
}

/** Stored board plus current refresh status, as response text. */
export async function savedFleetResponse({rpc,payloadText}){
 for(let attempt=0;attempt<2;attempt++){
  const status=statusAnswer(await rpc('cos_fleet_board_status',{}));
  // Never answer with an empty or partial record as if no board existed.
  if(status===UNKNOWN)continue;
  const id=status.latest?.id;
  if(!id){return JSON.stringify(status);}
  if(completed?.id!==id){
   const text=String(await payloadText(id)??'').trim();
   // The board was replaced between the two reads; read the new status.
   if(!text.startsWith('{')||!text.endsWith('}'))continue;
   completed={id,text};
  }
  const text=completed.text;
  return JSON.stringify({...status,latest:{...status.latest,payload:'@@COS_SAVED_FLEET_BOARD_PAYLOAD@@'}}).replace(PAYLOAD_MARK,()=>text);
 }
 throw Error('saved_board_unavailable');
}

/** One background batch for a lease this producer has claimed. Every write
 * carries the producer token, so only the claimant can record, commit or fail
 * the run. Never throws. */
export async function produceFleetBoard({run,producer=null,leaseEndAt,rpc,read,now=Date.now,project,abort,timeoutSignal=ms=>AbortSignal.timeout(ms)}){
 const started=now(),budget=Number.isFinite(leaseEndAt)?Math.max(0,Math.min(FLEET_LEASE_MS,leaseEndAt-started)):FLEET_BATCH_BUDGET_MS;
 // End of the database lease on this worker's clock (see claimFleetBatch).
 const leaseEnd=started+budget,deadline=leaseEnd-LEASE_MARGIN_MS;
 const diagnostics={version:1,budgetMs:whole(budget),steps:[]};
 let current='start';
 const mark=()=>rpc('cos_fleet_board_progress',{p_run:run,p_producer:producer,p_diagnostics:{...diagnostics,reached:current,elapsedMs:whole(now()-started)}}).catch(()=>{});
 const step=async(name,work,describe)=>{
  current=name;const at=now();
  try{const value=await work();diagnostics.steps.push({step:name,ok:true,ms:whole(now()-at),...(describe?describe(value):{})});return value;}
  catch(cause){diagnostics.steps.push({step:name,ok:false,ms:whole(now()-at),...failureDetail(cause)});throw cause;}
 };
 try{
  const values={};
  for(const [name,path,attemptMs] of SOURCES){
   const receipt=await step(name,()=>{
    if(now()>=leaseEnd-COMMIT_RESERVE_MS)throw Object.assign(Error('source_read_failed'),{detail:{kind:'batch_deadline',attempts:0}});
    return read(path,{attemptMs,until:leaseEnd-COMMIT_RESERVE_MS});
   },value=>({attempts:whole(value?.attempts)??1}));
   values[name]=receipt?.value;
   await mark();
  }
  const capturedAt=now();
  const value=await step('project',async()=>project(values.health,values.map,values.connections,null,capturedAt));
  await step('commit',async()=>{
   const remaining=deadline-now();
   if(remaining<COMMIT_MIN_MS)throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:'batch_deadline'}});
   let published;
   // Bounded so the request cannot outlive the lease. If it is cut off, the
   // failure below is refused by the database when the board was in fact
   // published, and recorded when it was not.
   try{published=await rpc('cos_fleet_board_finish',{p_run:run,p_producer:producer,p_payload:value,p_diagnostics:{...diagnostics,reached:'commit',elapsedMs:whole(now()-started)}},timeoutSignal(Math.min(COMMIT_REQUEST_MAX_MS,remaining)));}
   catch(cause){throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:cause?.name==='TimeoutError'||cause?.name==='AbortError'?'commit_timeout':'commit_error'}});}
   // Only a literal true confirms publication. A literal false is a definite
   // refusal; any other reply leaves the outcome unknown.
   if(published===false)throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:'lease_lost'}});
   if(published!==true)throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:'commit_unreadable'}});
  });
  return true;
 }catch(cause){
  abort?.();
  const code=['checks_incomplete','connection_source_incomplete','inventory_source_incomplete'].includes(cause?.message)?cause.message:'source_read_failed';
  await rpc('cos_fleet_board_fail',{p_run:run,p_producer:producer,p_code:code,p_products:Array.isArray(cause?.products)?cause.products.slice(0,1000):[],p_diagnostics:{...diagnostics,reached:current,failedStep:current,elapsedMs:whole(now()-started)}}).catch(()=>{});
  return false;
 }
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const newToken=()=>globalThis.crypto.randomUUID();
// After a hand-off whose delivery is unknown, give a worker that did start
// time to record its claim before this request tries to claim the run.
export const UNCERTAIN_DELIVERY_GRACE_MS=4000;
const dispatchFailure=(kind,attempts)=>({version:1,steps:[{step:'dispatch',ok:false,kind,attempts}],reached:'dispatch',failedStep:'dispatch'});

/** Ask for a lease. The request token makes the call repeatable: if the
 * database granted the lease but the reply was lost, asking again with the
 * same token returns that same lease instead of leaving it without an owner. */
async function beginLease({rpc,force,request,sleep}){
 let last=Error('lease_unconfirmed');
 for(let attempt=0;attempt<3;attempt++){
  try{
   const answer=leaseAnswer(await rpc('cos_fleet_board_begin',{p_force:force,p_request:request}));
   // null is a definite "no lease"; an object with a run id is the lease.
   if(answer!==UNKNOWN)return answer;
   last=Error('lease_unconfirmed');
  }catch(cause){last=cause;}
  if(attempt<2)await sleep(1000);
 }
 throw last;
}

/** One claim request. Resolves to {claimed:true,leaseEndAt}, {claimed:false}
 * or {claimed:null} (not answered, or answered unreadably).
 *
 * The database reports the lease remaining at the moment it handled the
 * request, which is no earlier than the moment the request was sent. Counting
 * that remainder from the send time therefore never places the end of the
 * lease later than it really is, however slow the reply was. */
async function claimOnce({rpc,run,producer,now}){
 const sentAt=now();
 let answer;
 try{answer=claimAnswer(await rpc('cos_fleet_board_claim',{p_run:run,p_producer:producer}));}catch{answer=UNKNOWN;}
 if(answer===UNKNOWN)return {claimed:null};
 if(answer===false)return {claimed:false};
 return {claimed:true,leaseEndAt:sentAt+answer};
}

/** Attach `producer` to the run. The claim is repeatable for the same token,
 * so a lost or unreadable reply is resolved by asking again. Resolves to
 * {claimed:true,leaseEndAt}, {claimed:false} when another producer or no
 * active lease holds the run, or {claimed:null} when no readable answer could
 * be obtained; in that case the run is released with the attempted token,
 * which frees it whether this token holds it or nobody does. Never throws. */
export async function claimFleetBatch({rpc,run,producer,now=Date.now,sleep=pause,attempts=4}){
 for(let attempt=0;attempt<attempts;attempt++){
  const claim=await claimOnce({rpc,run,producer,now});
  if(claim.claimed!==null)return claim;
  if(attempt<attempts-1)await sleep(1500);
 }
 await rpc('cos_fleet_board_fail',{p_run:run,p_producer:producer,p_code:'source_read_failed',p_products:[],p_diagnostics:dispatchFailure('claim_unconfirmed',attempts)}).catch(()=>{});
 return {claimed:null};
}

/** Start one granted lease exactly once.
 *
 * Each target returns 'accepted' (a worker claimed the run), 'rejected' (it
 * definitely did not start) or 'uncertain' (the request may have been
 * delivered). A thrown target is uncertain. Whatever the targets report, the
 * database claim decides ownership: only one producer token can ever be
 * attached to a run, so a late or duplicate producer stops before reading a
 * source and cannot fail or publish the run.
 *
 * Resolves to 'handed', 'owned_elsewhere', 'ran_here' or 'failed'. Never throws. */
export async function startFleetBatch({run,rpc,read,now=Date.now,project,abort,targets=[],followTargets=[],inline=false,sleep=pause,token=newToken,timeoutSignal}){
 // The token is kept from before the claim is sent, so a claim whose reply
 // was lost can still be reconciled or released by the request that made it.
 let attempted=null,uncertain=false,attempts=0;
 try{
  for(const target of targets){
   if(!target)continue;
   let outcome;try{outcome=await target(run);}catch{outcome='uncertain';}
   attempts++;
   if(outcome==='accepted')return 'handed';
   if(outcome!=='rejected')uncertain=true;
  }
  if(uncertain)await sleep(UNCERTAIN_DELIVERY_GRACE_MS);
  attempted=token();
  const claim=await claimFleetBatch({rpc,run,producer:attempted,now,sleep});
  if(claim.claimed===null)return 'failed';
  if(!claim.claimed)return 'owned_elsewhere';
  if(inline){await runFleetBatch({run,producer:attempted,leaseEndAt:claim.leaseEndAt,rpc,read,now,project,abort,followTargets,sleep,token,timeoutSignal});return 'ran_here';}
  await rpc('cos_fleet_board_fail',{p_run:run,p_producer:attempted,p_code:'source_read_failed',p_products:[],p_diagnostics:dispatchFailure(uncertain?'delivery_uncertain':'delivery_rejected',attempts)});
  return 'failed';
 }catch{
  await rpc('cos_fleet_board_fail',{p_run:run,p_producer:attempted,p_code:'source_read_failed',p_products:[],p_diagnostics:dispatchFailure('dispatch_error',attempts)}).catch(()=>{});
  return 'failed';
 }
}

/** Worker entry. Resolves to 'accepted' only when this worker holds the run,
 * 'refused' when it definitely does not, and 'unknown' when the claim was
 * sent but not answered. In the unknown case the worker keeps its token and
 * reconciles in the background: it runs the batch if the claim did commit,
 * and stands down if another producer has the run. */
export async function acceptFleetBatch({run,rpc,read,now=Date.now,project,abort,followTargets=[],waitUntil,sleep=pause,token=newToken,timeoutSignal}){
 const producer=token();
 const work=claim=>runFleetBatch({run,producer,leaseEndAt:claim.leaseEndAt,rpc,read,now,project,abort,followTargets,sleep,token,timeoutSignal});
 const first=await claimOnce({rpc,run,producer,now});
 if(first.claimed===true){waitUntil(work(first));return 'accepted';}
 if(first.claimed===false)return 'refused';
 waitUntil((async()=>{const claim=await claimFleetBatch({rpc,run,producer,now,sleep});if(claim.claimed===true)await work(claim);})());
 return 'unknown';
}

/** A refresh that arrives while a batch is running, or inside the 60-second
 * spacing after one, is recorded as queued. Start that single follow-up once
 * the spacing has passed. Any number of requests may call this; the database
 * grants the follow-up lease to one of them. Never throws. */
export async function continueQueuedFleetBoard({rpc,read,project,abort,targets=[],inline=false,startedAt,now=Date.now,sleep=pause,token=newToken,timeoutSignal}){
 try{
  if(!inline&&!targets.some(Boolean))return false;
  // An unreadable status is asked once more before concluding nothing is owed.
  let status=statusAnswer(await rpc('cos_fleet_board_status',{}));
  if(status===UNKNOWN){await sleep(1000);status=statusAnswer(await rpc('cos_fleet_board_status',{}));}
  if(status===UNKNOWN||status.refresh?.state!=='queued')return false;
  const recorded=Date.parse(status.refresh.startedAt);
  const since=Number.isFinite(recorded)?recorded:startedAt??now();
  const wait=Math.min(61000,61000-(now()-since));
  if(wait>0)await sleep(wait);
  // One request token for every attempt: a follow-up lease that was granted
  // but whose reply was lost is returned again rather than orphaned.
  const request=token();
  let lease=null;
  for(let attempt=0;attempt<3&&!lease?.id;attempt++){
   if(attempt){await sleep(2000);const again=statusAnswer(await rpc('cos_fleet_board_status',{}));if(again!==UNKNOWN&&again.refresh?.state!=='queued')return false;}
   lease=await beginLease({rpc,force:false,request,sleep});
  }
  if(!lease?.id)return false;
  const outcome=await startFleetBatch({run:lease.id,rpc,read,now,project,abort,targets,followTargets:targets,inline,sleep,token,timeoutSignal});
  return outcome!=='failed';
 }catch{return false;}
}

/** One claimed batch, then its queued follow-up if one was requested. The
 * follow-up always starts as a new request: this worker has spent its budget. */
export async function runFleetBatch({run,producer=null,leaseEndAt,rpc,read,now=Date.now,project,abort,followTargets=[],sleep=pause,token=newToken,timeoutSignal}){
 const startedAt=now();
 const ok=await produceFleetBoard({run,producer,leaseEndAt,rpc,read,now,project,abort,timeoutSignal});
 await continueQueuedFleetBoard({rpc,targets:followTargets,inline:false,startedAt,now,sleep,token,timeoutSignal});
 return ok;
}

/** Refresh claims the lease and starts it once: on a dedicated worker when one
 * accepts it, otherwise here. If the request was queued instead, this request
 * makes sure the queued refresh is processed. The response is always the
 * stored board; a failed or running batch never replaces or re-dates it. */
export async function savedFleetBoard({rpc,payloadText,read,force=false,waitUntil,now=Date.now,project,abort,targets=[],followTargets=[],sleep=pause,token=newToken,timeoutSignal}){
 const lease=force?await beginLease({rpc,force:true,request:token(),sleep}):null;
 if(lease?.id)waitUntil(startFleetBatch({run:lease.id,rpc,read,now,project,abort,targets,followTargets,inline:true,sleep,token,timeoutSignal}));
 else if(force)waitUntil(continueQueuedFleetBoard({rpc,read,project,abort,targets:followTargets,inline:true,now,sleep,token,timeoutSignal}));
 return savedFleetResponse({rpc,payloadText});
}
