/** Durable Fleet board runtime. Called only after the existing fleet account
 * authorization. Opening and polling are read-only; only an explicit refresh
 * (manual or the visible client cadence) can claim the database lease. */

// The database lease is 180 seconds. The batch gives up before it expires so
// a slow run records a real failure instead of an unexplained interruption.
export const FLEET_BATCH_BUDGET_MS=165000;
const COMMIT_RESERVE_MS=25000;
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
  const status=await rpc('cos_fleet_board_status',{});
  const id=status?.latest?.id;
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
export async function produceFleetBoard({run,producer=null,rpc,read,now=Date.now,project,abort}){
 const started=now(),deadline=started+FLEET_BATCH_BUDGET_MS;
 const diagnostics={version:1,budgetMs:FLEET_BATCH_BUDGET_MS,steps:[]};
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
    if(now()>=deadline-COMMIT_RESERVE_MS)throw Object.assign(Error('source_read_failed'),{detail:{kind:'batch_deadline',attempts:0}});
    return read(path,{attemptMs,until:deadline-COMMIT_RESERVE_MS});
   },value=>({attempts:whole(value?.attempts)??1}));
   values[name]=receipt?.value;
   await mark();
  }
  const capturedAt=now();
  const value=await step('project',async()=>project(values.health,values.map,values.connections,null,capturedAt));
  await step('commit',async()=>{
   if(now()>=deadline)throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:'batch_deadline'}});
   if(!await rpc('cos_fleet_board_finish',{p_run:run,p_producer:producer,p_payload:value,p_diagnostics:{...diagnostics,reached:'commit',elapsedMs:whole(now()-started)}}))throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:'lease_lost'}});
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

/** Start one claimed lease exactly once.
 *
 * Each target returns 'accepted' (a worker claimed the run), 'rejected' (it
 * definitely did not start) or 'uncertain' (the request may have been
 * delivered). A thrown target is uncertain. Whatever the targets report, the
 * database claim decides ownership: only one producer token can ever be
 * attached to a run, so a late or duplicate producer stops before reading a
 * source and cannot fail or publish the run.
 *
 * Resolves to 'handed', 'owned_elsewhere', 'ran_here' or 'failed'; a lease is
 * never left unowned. Never throws. */
export async function startFleetBatch({run,rpc,read,now=Date.now,project,abort,targets=[],followTargets=[],inline=false,sleep=pause,token=newToken}){
 let producer=null,uncertain=false,attempts=0;
 try{
  for(const target of targets){
   if(!target)continue;
   let outcome;try{outcome=await target(run);}catch{outcome='uncertain';}
   attempts++;
   if(outcome==='accepted')return 'handed';
   if(outcome!=='rejected')uncertain=true;
  }
  if(uncertain)await sleep(UNCERTAIN_DELIVERY_GRACE_MS);
  const mine=token();
  if(await rpc('cos_fleet_board_claim',{p_run:run,p_producer:mine})!==true)return 'owned_elsewhere';
  producer=mine;
  if(inline){await runFleetBatch({run,producer,rpc,read,now,project,abort,followTargets,sleep,token});return 'ran_here';}
  await rpc('cos_fleet_board_fail',{p_run:run,p_producer:producer,p_code:'source_read_failed',p_products:[],p_diagnostics:dispatchFailure(uncertain?'delivery_uncertain':'delivery_rejected',attempts)});
  return 'failed';
 }catch{
  // Could not confirm ownership (for example the database was unreachable).
  // Release the lease if this request owns it or nobody does; the database
  // ignores this for a run another producer has claimed.
  await rpc('cos_fleet_board_fail',{p_run:run,p_producer:producer,p_code:'source_read_failed',p_products:[],p_diagnostics:dispatchFailure('dispatch_error',attempts)}).catch(()=>{});
  return 'failed';
 }
}

/** A refresh that arrives while a batch is running, or inside the 60-second
 * spacing after one, is recorded as queued. Start that single follow-up once
 * the spacing has passed. Any number of requests may call this; the database
 * grants the follow-up lease to one of them. Never throws. */
export async function continueQueuedFleetBoard({rpc,read,project,abort,targets=[],inline=false,startedAt,now=Date.now,sleep=pause,token=newToken}){
 try{
  if(!inline&&!targets.some(Boolean))return false;
  const status=await rpc('cos_fleet_board_status',{});
  if(status?.refresh?.state!=='queued')return false;
  const recorded=Date.parse(status.refresh.startedAt);
  const since=Number.isFinite(recorded)?recorded:startedAt??now();
  const wait=Math.min(61000,61000-(now()-since));
  if(wait>0)await sleep(wait);
  let lease=null;
  for(let attempt=0;attempt<3&&!lease?.id;attempt++){
   if(attempt){await sleep(2000);if((await rpc('cos_fleet_board_status',{}))?.refresh?.state!=='queued')return false;}
   lease=await rpc('cos_fleet_board_begin',{p_force:false});
  }
  if(!lease?.id)return false;
  const outcome=await startFleetBatch({run:lease.id,rpc,read,now,project,abort,targets,followTargets:targets,inline,sleep,token});
  return outcome!=='failed';
 }catch{return false;}
}

/** One claimed batch, then its queued follow-up if one was requested. The
 * follow-up always starts as a new request: this worker has spent its budget. */
export async function runFleetBatch({run,producer=null,rpc,read,now=Date.now,project,abort,followTargets=[],sleep=pause,token=newToken}){
 const startedAt=now();
 const ok=await produceFleetBoard({run,producer,rpc,read,now,project,abort});
 await continueQueuedFleetBoard({rpc,targets:followTargets,inline:false,startedAt,now,sleep,token});
 return ok;
}

/** Refresh claims the lease and starts it once: on a dedicated worker when one
 * accepts it, otherwise here. If the request was queued instead, this request
 * makes sure the queued refresh is processed. The response is always the
 * stored board; a failed or running batch never replaces or re-dates it. */
export async function savedFleetBoard({rpc,payloadText,read,force=false,waitUntil,now=Date.now,project,abort,targets=[],followTargets=[],sleep=pause,token=newToken}){
 const lease=force?await rpc('cos_fleet_board_begin',{p_force:true}):null;
 if(lease?.id)waitUntil(startFleetBatch({run:lease.id,rpc,read,now,project,abort,targets,followTargets,inline:true,sleep,token}));
 else if(force)waitUntil(continueQueuedFleetBoard({rpc,read,project,abort,targets:followTargets,inline:true,now,sleep,token}));
 return savedFleetResponse({rpc,payloadText});
}
