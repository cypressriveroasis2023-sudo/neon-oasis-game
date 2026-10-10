/** Local-only orchestration. No secrets, vendor URLs, user identities or transport are accepted by HTTP callers. */
import {isRetryAfterSeconds} from './mhelpIntakeRetry.ts';
export const INTAKE_CONTRACT='cos-mhelp-ticket-intake-run-v1';
export const BATCH_CONTRACT='cos-mhelp-ticket-operational-batch-v1';
export const INTAKE_LIMITS=Object.freeze({cadenceSeconds:300,leaseSeconds:180,deadlineMs:120000,pageSize:50,maxTickets:500,maxPages:10,overlapMs:600000,maxForwardMs:900000,maxWindowMs:1500001,maxResponseBytes:3*1048576});
export type FaultCode='SOURCE_UNAVAILABLE'|'SOURCE_INVALID'|'BATCH_LIMIT'|'WRITE_UNAVAILABLE'|'RECEIPT_INVALID'|'DEADLINE'|'CONFIGURATION'|'INTERNAL';
export class IntakeFault extends Error {
  public readonly retryAfterSeconds?:number;
  constructor(public readonly code:FaultCode, public readonly retryable=false,retryAfterSeconds?:number) {super(code);if(isRetryAfterSeconds(retryAfterSeconds))this.retryAfterSeconds=retryAfterSeconds;}
}
type Row=Record<string,unknown>;
export type Window={createdAfter:string;createdBefore:string};
export type Lease=Window&{state:'leased';leaseId:string;portalId:string;schemaContract:string;activationFloor:string;leaseUntil:string};
/** Output of a source-verified operational mapper, not a raw vendor row. SQL revalidates every field. */
export type IntakeTicket=Row&{contract:'cos-mhelp-legacy-intake-v1';schemaContract:string;source:Row&{portalId:string;ticketId:string;createdAt:string}};
export type OperationalBatch={contract:typeof BATCH_CONTRACT;portalId:string;schemaContract:string;window:Window;totalRows:number;partial:false;tickets:IntakeTicket[]};
export type Rpc=(input:Row,signal:AbortSignal)=>Promise<unknown>;
export type RunResult={contract:typeof INTAKE_CONTRACT;state:'disabled'|'busy'|'backoff'|'idle'|'complete'|'failed';scanned:number;created:number;existing:number;reviewNeeded:number;watermarkAdvanced:boolean;completionUncertain?:true;code?:FaultCode};
export const row=(v:unknown):Row=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new IntakeFault('SOURCE_INVALID');return v as Row;};
export const exact=(v:Row,keys:readonly string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw new IntakeFault('SOURCE_INVALID');};
export function utc(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value.replace(/Z$/,value.includes('.')?'Z':'.000Z'))throw new IntakeFault('SOURCE_INVALID');
  return value;
}
export const identity=(value:unknown):string=>{if(typeof value!=='string'||!/^[1-9]\d{0,14}$/.test(value))throw new IntakeFault('SOURCE_INVALID');return value;};
export const sourceKey=(portalId:string,ticketId:string)=>JSON.stringify(['mhelpdesk',identity(portalId),identity(ticketId)]);
export function parseLease(value:unknown,now:number):Lease {
  const r=row(value); exact(r,['state','leaseId','portalId','schemaContract','activationFloor','createdAfter','createdBefore','leaseUntil']);
  if(r.state!=='leased'||typeof r.leaseId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(r.leaseId)||typeof r.schemaContract!=='string'||!r.schemaContract||r.schemaContract.length>128)throw new IntakeFault('CONFIGURATION');
  const floor=Date.parse(utc(r.activationFloor)),after=Date.parse(utc(r.createdAfter)),before=Date.parse(utc(r.createdBefore)),until=Date.parse(utc(r.leaseUntil));identity(r.portalId);
  if(floor>now||after<floor-1||before<=after||before>now||before-after>INTAKE_LIMITS.maxWindowMs||until<=now||until-now>INTAKE_LIMITS.leaseSeconds*1000+1000)throw new IntakeFault('CONFIGURATION');
  return r as Lease;
}
const ticketKeys=['contract','schemaContract','source','departmentAssignments','ticketLead','sourceEvidence','request'];
const sourceKeys=['portalId','ticketId','ticketNumber','typeId','statusId','customStatusId','deleted','assignment','createdAt'];
const requestKeys=['ticket_no','site','work_type','targets','requested_unit_count','unit_summary','job_description','notes','equipment_manifest','scheduled_for','scheduled_time','solar_panel_qty','battery_replacement_qty','camera_replacement_qty','sim_replacement_qty','micro_sd_qty'];
const nested=(value:unknown,keys:string[])=>{if(value!==null&&value!==undefined)exact(row(value),keys);};
const primitive=(value:unknown)=>value==null||['string','number','boolean'].includes(typeof value);
function terminalFields(value:unknown,containerKeys:string[]=[]){if(value==null)return;for(const [key,v]of Object.entries(row(value))){if(!containerKeys.includes(key)&&!primitive(v))throw new IntakeFault('SOURCE_INVALID');}}
function assignmentFields(value:unknown){if(value==null)return;const v=row(value);terminalFields(v,['identities']);if(v.identities!==undefined&&(!Array.isArray(v.identities)||v.identities.length>50||v.identities.some(x=>typeof x!=='string'||x.length>128)))throw new IntakeFault('SOURCE_INVALID');}

/** Reject unknown nested fields rather than forwarding contact, billing, attachments or raw bodies. */
export function validateOperationalTicket(value:unknown,scope:{portalId:string;schemaContract:string;activationFloor:string}&Window):IntakeTicket {
  const r=row(value);exact(r,ticketKeys);const s=row(r.source);exact(s,sourceKeys);
  if(r.contract!=='cos-mhelp-legacy-intake-v1'||r.schemaContract!==scope.schemaContract||s.portalId!==scope.portalId)throw new IntakeFault('SOURCE_INVALID');
  identity(s.ticketId);const created=Date.parse(utc(s.createdAt));
  if(created<Date.parse(scope.activationFloor)||created<=Date.parse(scope.createdAfter)||created>=Date.parse(scope.createdBefore))throw new IntakeFault('SOURCE_INVALID');
  terminalFields(r,['source','departmentAssignments','ticketLead','sourceEvidence','request']);terminalFields(s,['assignment']);
  nested(s.assignment,['state','identities','evidence']);assignmentFields(s.assignment);
  nested(r.ticketLead,['sourceIdentity','evidence','policy']);nested(r.sourceEvidence,['equipment','parts','site','description','schedule','complete']);terminalFields(r.ticketLead);terminalFields(r.sourceEvidence);
  if(r.ticketLead!==undefined&&r.ticketLead!==null){const lead=row(r.ticketLead);if(Object.hasOwn(lead,'policy')&&(lead.policy!=='reviewed_local_unassigned_v1'||Object.keys(lead).length!==1))throw new IntakeFault('SOURCE_INVALID');}
  if(r.departmentAssignments!==null&&r.departmentAssignments!==undefined){if(!Array.isArray(r.departmentAssignments)||r.departmentAssignments.length>2)throw new IntakeFault('SOURCE_INVALID');for(const a of r.departmentAssignments){nested(a,['department','state','identities','evidence']);assignmentFields(a);}}
  if(r.request!==null&&r.request!==undefined){const request=row(r.request);exact(request,requestKeys);terminalFields(request,['targets','equipment_manifest']);for(const [field,keys,max] of [['targets',['role','assignee_user_id','requires_it_handoff'],2],['equipment_manifest',['category','label','qty'],100]] as const){if(request[field]!==undefined){if(!Array.isArray(request[field])||(request[field] as unknown[]).length>max)throw new IntakeFault('SOURCE_INVALID');for(const item of request[field] as unknown[]){nested(item,[...keys]);terminalFields(item);}}}}
  const encoded=JSON.stringify(r);if(new TextEncoder().encode(encoded).byteLength>100000)throw new IntakeFault('SOURCE_INVALID');
  return structuredClone(r) as IntakeTicket;
}
export function validateBatch(value:unknown,lease:Lease):OperationalBatch {
  const r=row(value);exact(r,['contract','portalId','schemaContract','window','totalRows','partial','tickets']);const w=row(r.window);exact(w,['createdAfter','createdBefore']);
  if(r.contract!==BATCH_CONTRACT||r.portalId!==lease.portalId||r.schemaContract!==lease.schemaContract||r.partial!==false||w.createdAfter!==lease.createdAfter||w.createdBefore!==lease.createdBefore||!Number.isSafeInteger(r.totalRows)||Number(r.totalRows)<0||!Array.isArray(r.tickets)||r.tickets.length!==r.totalRows)throw new IntakeFault('SOURCE_INVALID');
  if(r.tickets.length>INTAKE_LIMITS.maxTickets)throw new IntakeFault('BATCH_LIMIT');
  const tickets=r.tickets.map(v=>validateOperationalTicket(v,lease)),keys=tickets.map(t=>sourceKey(t.source.portalId,t.source.ticketId));
  if(new Set(keys).size!==keys.length)throw new IntakeFault('SOURCE_INVALID');
  return {contract:BATCH_CONTRACT,portalId:lease.portalId,schemaContract:lease.schemaContract,window:{createdAfter:lease.createdAfter,createdBefore:lease.createdBefore},totalRows:tickets.length,partial:false,tickets};
}
export async function deadline<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)throw new IntakeFault('DEADLINE',true);
  let onAbort:()=>void=()=>{};const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new IntakeFault('DEADLINE',true));signal.addEventListener('abort',onAbort,{once:true});});
  try{return await Promise.race([work(),aborted]);}finally{signal.removeEventListener('abort',onAbort);}
}
export async function runMhelpIntake(options:{enabled:boolean;rpc:Rpc;readSource:(window:Window,signal:AbortSignal)=>Promise<unknown>;now?:()=>number;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;random?:()=>number;deadlineMs?:number}):Promise<RunResult>{
  const result:RunResult={contract:INTAKE_CONTRACT,state:'disabled',scanned:0,created:0,existing:0,reviewNeeded:0,watermarkAdvanced:false};
  if(options.enabled!==true)return result;
  const now=options.now??Date.now,controller=new AbortController(),duration=Math.min(INTAKE_LIMITS.deadlineMs,Math.max(1,options.deadlineMs??INTAKE_LIMITS.deadlineMs));
  const timer=setTimeout(()=>controller.abort(),Math.max(1,duration-2000));let lease:Lease|undefined,finishAttempted=false;
  const sleep=options.sleep??((ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{const id=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);const abort=()=>{clearTimeout(id);reject(new IntakeFault('DEADLINE',true));};signal.addEventListener('abort',abort,{once:true});}));
  const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempt=0;;attempt++){try{return await deadline(work,controller.signal);}catch(error){if(controller.signal.aborted)throw new IntakeFault('DEADLINE',true);if(!(error instanceof IntakeFault)||!error.retryable||error.retryAfterSeconds!==undefined||attempt>=2)throw error;await deadline(()=>sleep(250*2**attempt+Math.floor(Math.max(0,Math.min(1,(options.random??Math.random)()))*125),controller.signal),controller.signal);}}};
  try {
    const started=row(await retry(()=>options.rpc({action:'begin'},controller.signal)));
    if(['disabled','busy','backoff','idle'].includes(String(started.state))){result.state=started.state as RunResult['state'];return result;}
    lease=parseLease(started,now());
    const batch=validateBatch(await retry(()=>options.readSource({createdAfter:lease!.createdAfter,createdBefore:lease!.createdBefore},controller.signal)),lease);
    result.scanned=batch.totalRows;
    for(const ticket of batch.tickets){
      const receipt=row(await retry(()=>options.rpc({action:'record',leaseId:lease!.leaseId,ticket},controller.signal)));
      if(receipt.state==='created')result.created++;
      else if(receipt.state==='existing')result.existing++;
      else if(receipt.state==='review_needed')result.reviewNeeded++;
      else throw new IntakeFault('RECEIPT_INVALID');
      // SQL, not the worker's counts, verifies every durable receipt again at finish.
    }
    finishAttempted=true;
    const finished=row(await retry(()=>options.rpc({action:'finish',leaseId:lease!.leaseId,expectedTicketIds:batch.tickets.map(t=>t.source.ticketId),total:batch.totalRows},controller.signal)));
    if(finished.state!=='complete'||finished.total!==batch.totalRows||finished.watermarkAdvanced!==true)throw new IntakeFault('RECEIPT_INVALID');
    result.state='complete';result.watermarkAdvanced=true;return result;
  }catch(error){
    const failure=error instanceof IntakeFault?error:new IntakeFault('INTERNAL');result.state='failed';result.code=failure.code;if(finishAttempted)result.completionUncertain=true;
    if(lease){const cleanup=new AbortController(),limit=setTimeout(()=>cleanup.abort(),2000);try{await deadline(()=>options.rpc({action:'fail',leaseId:lease!.leaseId,code:failure.code,retryable:failure.retryable,...(failure.retryAfterSeconds!==undefined?{retryAfterSeconds:failure.retryAfterSeconds}:{})},cleanup.signal),cleanup.signal);}catch{/* Lost cleanup must never advance a watermark; the fenced lease expires. */}finally{clearTimeout(limit);}}
    return result;
  }finally{clearTimeout(timer);controller.abort();}
}
