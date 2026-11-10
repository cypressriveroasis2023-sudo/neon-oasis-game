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

/** One background batch for an already claimed lease. Never throws. */
export async function produceFleetBoard({run,rpc,read,now=Date.now,project,abort}){
 const started=now(),deadline=started+FLEET_BATCH_BUDGET_MS;
 const diagnostics={version:1,budgetMs:FLEET_BATCH_BUDGET_MS,steps:[]};
 let current='start';
 const mark=()=>rpc('cos_fleet_board_progress',{p_run:run,p_diagnostics:{...diagnostics,reached:current,elapsedMs:whole(now()-started)}}).catch(()=>{});
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
   if(!await rpc('cos_fleet_board_finish',{p_run:run,p_payload:value,p_diagnostics:{...diagnostics,reached:'commit',elapsedMs:whole(now()-started)}}))throw Object.assign(Error('commit_unconfirmed'),{detail:{kind:'lease_lost'}});
  });
  return true;
 }catch(cause){
  abort?.();
  const code=['checks_incomplete','connection_source_incomplete','inventory_source_incomplete'].includes(cause?.message)?cause.message:'source_read_failed';
  await rpc('cos_fleet_board_fail',{p_run:run,p_code:code,p_products:Array.isArray(cause?.products)?cause.products.slice(0,1000):[],p_diagnostics:{...diagnostics,reached:current,failedStep:current,elapsedMs:whole(now()-started)}}).catch(()=>{});
  return false;
 }
}

/** A refresh requested while a batch was running is recorded as queued.
 * Start that single follow-up once the batch has ended and the 60-second
 * spacing has passed, always as a new request. Never throws. */
export async function continueQueuedFleetBoard({rpc,dispatch,startedAt,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 try{
  if(!dispatch)return false;
  if((await rpc('cos_fleet_board_status',{}))?.refresh?.state!=='queued')return false;
  const wait=Math.min(61000,61000-(now()-startedAt));
  if(wait>0)await sleep(wait);
  const lease=await rpc('cos_fleet_board_begin',{p_force:false});
  if(!lease?.id)return false;
  if(await dispatch(lease.id)===true)return true;
  await rpc('cos_fleet_board_fail',{p_run:lease.id,p_code:'source_read_failed',p_products:[],p_diagnostics:{version:1,steps:[],reached:'dispatch',failedStep:'dispatch'}}).catch(()=>{});
  return false;
 }catch{return false;}
}

/** One claimed batch, then its queued follow-up if one was requested. */
export async function runFleetBatch({run,rpc,read,now=Date.now,project,abort,redispatch,sleep}){
 const startedAt=now();
 const ok=await produceFleetBoard({run,rpc,read,now,project,abort});
 await continueQueuedFleetBoard({rpc,dispatch:redispatch,startedAt,now,sleep});
 return ok;
}

/** Refresh claims the lease, then hands the batch to `dispatch` (a dedicated
 * worker when available) or runs it here. The response is always the stored
 * board; a failed or running batch never replaces or re-dates it. */
export async function savedFleetBoard({rpc,payloadText,read,force=false,waitUntil,now=Date.now,project,abort,dispatch,redispatch,sleep}){
 const lease=force?await rpc('cos_fleet_board_begin',{p_force:true}):null;
 if(lease?.id){
  const work=(async()=>{
   let handed=false;
   if(dispatch){try{handed=await dispatch(lease.id)===true;}catch{handed=false;}}
   if(!handed)await runFleetBatch({run:lease.id,rpc,read,now,project,abort,redispatch,sleep});
  })();
  waitUntil(work);
 }
 return savedFleetResponse({rpc,payloadText});
}
