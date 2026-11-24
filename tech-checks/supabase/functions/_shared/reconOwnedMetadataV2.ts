/** Bounded Recon owner operations. Credentials never enter fingerprints or receipts. */
export const RECON_V2_LIMITS = Object.freeze({schema_version:2,inventory_attempt_seconds:120,provider_total_seconds:45,
 receiver_attempt_seconds:60,receiver_http_seconds:30,webhook_metadata_seconds:5,archive_seconds:6,
 replay_retention_seconds_from_begin:600,inventory_domain_records:128,receiver_domain_records:32,
 attempt_record_utf8_bytes:4096,attempt_state_utf8_bytes:1048576,inventory_resources_min:1,inventory_resources_max:100000,
 diagnostics_utf8_bytes:524288,diagnostic_counter_min:0,diagnostic_counter_max:100000,missing_labels_per_family:1000,
 missing_label_utf8_bytes:128,reason_code_ascii_chars:64,safe_error_text_chars:256,receipt_max_audit_lag_seconds:120,
 wire_integer_max:9007199254740991});
export type ReconKind = 'inventory_connect'|'inventory_sync'|'inventory_reconcile'|'receiver_test';
export type ReconReason = 'provider_unavailable'|'provider_rejected'|'partial_inventory'|'invalid_inventory'|'source_read_failed'|
 'save_failed'|'receiver_timeout'|'receiver_rejected'|'internal_error'|'superseded'|'configuration_changed';
export type ReconDb = {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Row = Record<string,unknown>;
export type ReconBegin = {schema_version:2;outcome:'begun'|'duplicate'|'absent';request_id:string;kind:ReconKind;
 attempt_id:string|null;ordinal:number|null;observed_at:string;expires_at:string;retain_until:string;expected_config_revision:number|null};
export type ReconAttempt = ReconBegin & {attempt_id:string;ordinal:number;expected_config_revision:number};
export type ReconFinish = {schema_version:2;attempt_id:string;kind:ReconKind;ordinal:number;observed_at:string;
 outcome:'applied'|'duplicate'|'superseded';applied:boolean;terminal_outcome:'success'|'failure'|null;current:boolean;
 input_fingerprint:string|null;reason_code:ReconReason|null;result:Row|null};
export type ReconResult = {schema_version:2;attempt_id:string;kind:ReconKind|null;ordinal:number|null;observed_at:string|null;
 state:'pending'|'success'|'failure'|'superseded'|'expired'|'unknown';current:boolean;terminal:ReconFinish|null};
const object = (v:unknown):v is Row => Boolean(v && typeof v==='object' && !Array.isArray(v));
const exact = (v:unknown,keys:string[]):v is Row => object(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const uuid = (v:unknown):v is string => typeof v==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const hash = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v:unknown,min:number=0,max:number=RECON_V2_LIMITS.wire_integer_max):v is number => typeof v==='number' && Number.isSafeInteger(v) && v>=min && v<=max;
const count = (v:unknown) => integer(v,0,RECON_V2_LIMITS.diagnostic_counter_max);
const kinds:readonly string[] = ['inventory_connect','inventory_sync','inventory_reconcile','receiver_test'];
const reasons:readonly string[] = ['provider_unavailable','provider_rejected','partial_inventory','invalid_inventory','source_read_failed',
 'save_failed','receiver_timeout','receiver_rejected','internal_error','superseded','configuration_changed'];
export function isReconTimestamp(v:unknown):v is string {
 if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(v))return false;
 const time=Date.parse(v);
 return Number.isFinite(time) && time>0 && new Date(time).toISOString().slice(0,19)===v.slice(0,19);
}
export class ReconOwnedConflict extends Error {
 readonly code='PT409'; readonly status=409;
 constructor(kind:ReconKind='inventory_sync') {super(kind==='receiver_test'?'Reconeyez receiver test was superseded.':'Reconeyez inventory refresh was superseded.');this.name='ReconOwnedConflict';}
}
export class ReconOwnedUnknown extends Error {
 readonly status=502;
 constructor(readonly kind:ReconKind='inventory_sync',readonly databaseCode:string|null=null) {
  super(kind==='receiver_test'?'Reconeyez receiver test completion could not be verified.':'Reconeyez inventory completion could not be verified.');this.name='ReconOwnedUnknown';
 }
}
const safeText:Record<ReconReason,string>={provider_unavailable:'Reconeyez inventory is unavailable.',provider_rejected:'Reconeyez rejected the inventory request.',
 partial_inventory:'Reconeyez returned a partial inventory response; identity proof was not renewed.',invalid_inventory:'Reconeyez complete inventory identities are unavailable.',
 source_read_failed:'Reconeyez inventory sources could not be read.',save_failed:'Reconeyez inventory could not be saved atomically.',
 receiver_timeout:'Reconeyez receiver test timed out.',receiver_rejected:'Reconeyez receiver test was not acknowledged.',internal_error:'Reconeyez operation could not be completed.',
 superseded:'Reconeyez inventory refresh was superseded.',configuration_changed:'Reconeyez configuration changed during the operation.'};
export class ReconSourceFailure extends Error {
 constructor(readonly reason:ReconReason) {super(safeText[reason]||safeText.internal_error);this.name='ReconSourceFailure';}
}
export function assertReconDeadline(attempt:ReconBegin,reserveMs=0) {
 if(Date.now()+reserveMs>=Date.parse(attempt.expires_at))throw new ReconOwnedConflict(attempt.kind);
}
export function knownReconAttempt(attempt:ReconBegin):ReconAttempt {
 if(!uuid(attempt.attempt_id)||!integer(attempt.ordinal,1)||!integer(attempt.expected_config_revision))throw new ReconOwnedUnknown(attempt.kind);
 return attempt as ReconAttempt;
}
/** Exactly the supplement's canonical JSON; no bigint coercion, preview or normalization. */
export function canonicalReconJson(value:unknown):string {
 const seen=new Set<object>();
 const encode=(v:unknown,depth:number):string=>{
  if(depth>64)throw new ReconSourceFailure('invalid_inventory');
  if(v===null)return 'null';
  if(typeof v==='string')return JSON.stringify(v);
  if(typeof v==='boolean')return v?'true':'false';
  if(typeof v==='number'&&Number.isSafeInteger(v))return JSON.stringify(v);
  if(!object(v)&&!Array.isArray(v))throw new ReconSourceFailure('invalid_inventory');
  if(seen.has(v as object))throw new ReconSourceFailure('invalid_inventory');
  seen.add(v as object);
  let result:string;
  if(Array.isArray(v)) {
   if(Object.keys(v).length!==v.length||Reflect.ownKeys(v).length!==v.length+1)throw new ReconSourceFailure('invalid_inventory');
   result='['+v.map(item=>encode(item,depth+1)).join(',')+']';
  } else {
   const row=v as Row;
   if(Object.getPrototypeOf(row)!==Object.prototype&&Object.getPrototypeOf(row)!==null)throw new ReconSourceFailure('invalid_inventory');
   const keys=Object.keys(row).sort();
   if(Reflect.ownKeys(row).length!==keys.length||keys.some(k=>!/^[\x00-\x7f]*$/.test(k)))throw new ReconSourceFailure('invalid_inventory');
   result='{'+keys.map(k=>JSON.stringify(k)+':'+encode(row[k],depth+1)).join(',')+'}';
  }
  seen.delete(v as object);return result;
 };
 return encode(value,0);
}
export async function reconOwnedFingerprint(value:unknown):Promise<string> {
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalReconJson(value)));
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
export function validateReconBegin(value:unknown,expected:{requestId:string;kind:ReconKind}):ReconBegin {
 const keys=['schema_version','outcome','request_id','kind','attempt_id','ordinal','observed_at','expires_at','retain_until','expected_config_revision'];
 if(!exact(value,keys)||value.schema_version!==2||value.request_id!==expected.requestId||!uuid(value.request_id)||value.kind!==expected.kind||
  !['begun','duplicate','absent'].includes(String(value.outcome))||!isReconTimestamp(value.observed_at)||!isReconTimestamp(value.expires_at)||!isReconTimestamp(value.retain_until))throw new ReconOwnedUnknown(expected.kind);
 const lifetime=expected.kind==='receiver_test'?RECON_V2_LIMITS.receiver_attempt_seconds:RECON_V2_LIMITS.inventory_attempt_seconds;
 if(Date.parse(value.expires_at)-Date.parse(value.observed_at)!==lifetime*1000 ||
  Date.parse(value.retain_until)-Date.parse(value.observed_at)!==RECON_V2_LIMITS.replay_retention_seconds_from_begin*1000)throw new ReconOwnedUnknown(expected.kind);
 if(value.outcome==='absent') {
  if(expected.kind!=='inventory_connect'||value.attempt_id!==null||value.ordinal!==null||value.expected_config_revision!==null)throw new ReconOwnedUnknown(expected.kind);
 } else if(!uuid(value.attempt_id)||!integer(value.ordinal,1)||!integer(value.expected_config_revision))throw new ReconOwnedUnknown(expected.kind);
 return value as ReconBegin;
}
function validateQ(value:unknown,kind:ReconKind) {
 let keys:string[];
 if(kind==='receiver_test') {
  if(!exact(value,['receiver_ready','ack_event_id','receiver_tested_at'])||value.receiver_ready!==true||!integer(value.ack_event_id,1)||!isReconTimestamp(value.receiver_tested_at))throw new ReconOwnedUnknown(kind);
  return;
 }
 keys=kind==='inventory_reconcile'?['inventory_total','detectors','matched_local_detectors','unmatched_provider_detectors','local_active','local_shop','diagnostics_sha256']:
  ['imported','active','shop','skipped_non_detectors'];
 if(!exact(value,keys)||keys.filter(k=>k!=='diagnostics_sha256').some(k=>!count(value[k]))||kind==='inventory_reconcile'&&!hash(value.diagnostics_sha256))throw new ReconOwnedUnknown(kind);
 if(kind==='inventory_reconcile') {
  if((value.matched_local_detectors as number)+(value.unmatched_provider_detectors as number)!==value.detectors||
   (value.detectors as number)>(value.inventory_total as number)||
   (value.local_active as number)+(value.local_shop as number)<(value.matched_local_detectors as number))throw new ReconOwnedUnknown(kind);
 } else if((value.imported as number)+(value.skipped_non_detectors as number)>RECON_V2_LIMITS.inventory_resources_max||
  (value.active as number)+(value.shop as number)<(value.imported as number))throw new ReconOwnedUnknown(kind);
}
export type ReconFinishExpectation={attempt:ReconBegin;fingerprint?:string;validateResult?:(result:Row)=>void};
export function validateReconFinish(value:unknown,expected:ReconFinishExpectation):ReconFinish {
 const a=knownReconAttempt(expected.attempt),keys=['schema_version','attempt_id','kind','ordinal','observed_at','outcome','applied','terminal_outcome','current','input_fingerprint','reason_code','result'];
 if(!exact(value,keys)||value.schema_version!==2||value.attempt_id!==a.attempt_id||value.kind!==a.kind||value.ordinal!==a.ordinal||value.observed_at!==a.observed_at||
  !['applied','duplicate','superseded'].includes(String(value.outcome))||typeof value.applied!=='boolean'||typeof value.current!=='boolean')throw new ReconOwnedUnknown(a.kind);
 if(value.outcome==='superseded') {
  if(value.applied||value.current||value.terminal_outcome!==null||value.input_fingerprint!==null||value.result!==null||!['superseded','configuration_changed'].includes(String(value.reason_code)))throw new ReconOwnedUnknown(a.kind);
 } else {
  if(value.applied!==(value.outcome==='applied')||value.outcome==='applied'&&!value.current||!hash(value.input_fingerprint)||!['success','failure'].includes(String(value.terminal_outcome)))throw new ReconOwnedUnknown(a.kind);
  if(value.terminal_outcome==='success') {
   if(value.reason_code!==null||expected.fingerprint!==undefined&&value.input_fingerprint!==expected.fingerprint)throw new ReconOwnedUnknown(a.kind);
   validateQ(value.result,a.kind);
   if(a.kind==='receiver_test') {
    const tested=Date.parse(String((value.result as Row).receiver_tested_at));
    if(tested<Date.parse(a.observed_at)||tested>Date.parse(a.expires_at))throw new ReconOwnedUnknown(a.kind);
   }
   expected.validateResult?.(value.result as Row);
  } else if(value.result!==null||!reasons.includes(String(value.reason_code))||['superseded','configuration_changed'].includes(String(value.reason_code)))throw new ReconOwnedUnknown(a.kind);
 }
 return value as ReconFinish;
}
export function validateReconResult(value:unknown,attempt:ReconBegin):ReconResult {
 const a=knownReconAttempt(attempt),keys=['schema_version','attempt_id','kind','ordinal','observed_at','state','current','terminal'];
 if(!exact(value,keys)||value.schema_version!==2||value.attempt_id!==a.attempt_id||typeof value.current!=='boolean'||!['pending','success','failure','superseded','expired','unknown'].includes(String(value.state)))throw new ReconOwnedUnknown(a.kind);
 if(value.state==='unknown') {
  if(value.kind!==null||value.ordinal!==null||value.observed_at!==null||value.terminal!==null||value.current)throw new ReconOwnedUnknown(a.kind);
 } else {
  if(value.kind!==a.kind||value.ordinal!==a.ordinal||value.observed_at!==a.observed_at)throw new ReconOwnedUnknown(a.kind);
  if(value.state==='success'||value.state==='failure') {
   const terminal=validateReconFinish(value.terminal,{attempt:a});
   if(terminal.outcome!=='duplicate'||terminal.terminal_outcome!==value.state||terminal.current!==value.current)throw new ReconOwnedUnknown(a.kind);
  } else if(value.terminal!==null||value.current)throw new ReconOwnedUnknown(a.kind);
 }
 return value as ReconResult;
}
const errorCode=(e:unknown):string|null=>object(e)&&typeof e.code==='string'&&/^[A-Z0-9]{5}$/.test(e.code)?e.code:null;
async function boundedRpc(db:ReconDb,name:string,args:Row,kind:ReconKind,budgetMs:number) {
 if(budgetMs<=0)throw new ReconOwnedUnknown(kind);
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  return await Promise.race([Promise.resolve(db.rpc(name,args)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ReconOwnedUnknown(kind)),budgetMs);})]);
 } catch(error) {if(error instanceof ReconOwnedUnknown)throw error;throw new ReconOwnedUnknown(kind,errorCode(error));}
 finally {if(timer!==undefined)clearTimeout(timer);}
}
export async function beginReconAttempt(db:ReconDb,kind:ReconKind,requestId=crypto.randomUUID()):Promise<ReconBegin> {
 if(!uuid(requestId)||!kinds.includes(kind))throw new ReconOwnedUnknown(kind);
 const args={p_request_id:requestId,p_kind:kind};let originalCode:string|null=null;
 try {
  const {data,error}=await boundedRpc(db,'recon_begin_attempt_v2',args,kind,5000);
  if(error) {originalCode=errorCode(error);if(originalCode==='PT409')throw new ReconOwnedConflict(kind);throw new ReconOwnedUnknown(kind,originalCode);}
  return validateReconBegin(data,{requestId,kind});
 } catch(error) {
  if(error instanceof ReconOwnedConflict)throw error;
  originalCode=originalCode||(error instanceof ReconOwnedUnknown?error.databaseCode:null);
  if(originalCode==='40001')throw new ReconOwnedUnknown(kind,'40001');
 }
 // Recover only an already-stored request. Repeating BEGIN could mint a new
 // absent-row observation; this read-only operation can never do that.
 const {data,error}=await boundedRpc(db,'recon_recover_begin_v2',args,kind,5000);
 if(error) {if(errorCode(error)==='PT409')throw new ReconOwnedConflict(kind);throw new ReconOwnedUnknown(kind,originalCode||errorCode(error));}
 const recovered=validateReconBegin(data,{requestId,kind});
 if(recovered.outcome!=='duplicate')throw new ReconOwnedUnknown(kind,originalCode);
 return recovered;
}
export async function lookupReconAttempt(db:ReconDb,attempt:ReconBegin):Promise<ReconResult> {
 const a=knownReconAttempt(attempt);
 const {data,error}=await boundedRpc(db,'recon_attempt_result_v2',{p_attempt_id:a.attempt_id},a.kind,5000);
 if(error) {if(errorCode(error)==='PT409')throw new ReconOwnedConflict(a.kind);throw new ReconOwnedUnknown(a.kind,errorCode(error));}
 return validateReconResult(data,a);
}
/** Publication errors are uncertainty: lookup, then retry the EXACT token/input once.
 * This operation never issues a replacement attempt or invents a terminal failure. */
export async function recoverReconMutation(db:ReconDb,attempt:ReconBegin,rpcName:string,args:Row,
 options:{fingerprint?:string;validateResult?:(result:Row)=>void;allowUnknownResult?:boolean}={}):Promise<ReconFinish> {
 const a=knownReconAttempt(attempt),expected={attempt:a,fingerprint:options.fingerprint,validateResult:options.validateResult};
 let databaseCode:string|null=null;
 const invoke=async()=>{
  const {data,error}=await boundedRpc(db,rpcName,args,a.kind,Math.min(5000,Date.parse(a.expires_at)-Date.now()));
  if(error) {const code=errorCode(error);if(code==='PT409')throw new ReconOwnedConflict(a.kind);databaseCode=code;throw new ReconOwnedUnknown(a.kind,code);}
  const finish=validateReconFinish(data,expected);
  if(options.fingerprint!==undefined&&finish.terminal_outcome==='failure')throw new ReconOwnedConflict(a.kind);
  return finish;
 };
 const recover=async():Promise<ReconFinish|null>=>{
  const result=await lookupReconAttempt(db,a);
  if(result.terminal) {
   if(options.fingerprint!==undefined&&result.terminal.terminal_outcome==='failure')throw new ReconOwnedConflict(a.kind);
   return validateReconFinish(result.terminal,expected);
  }
  if(result.state==='expired'||result.state==='superseded'||result.state==='unknown'&&!options.allowUnknownResult)throw new ReconOwnedConflict(a.kind);
  return null;
 };
 if(Date.now()>=Date.parse(a.expires_at)) {
  const saved=await recover();if(saved)return saved;throw new ReconOwnedConflict(a.kind);
 }
 for(let call=0;call<2;call++) {
  try {return await invoke();}catch(error) {if(error instanceof ReconOwnedConflict)throw error;}
  try {const saved=await recover();if(saved)return saved;}catch(error) {if(error instanceof ReconOwnedConflict)throw error;}
  if(Date.now()>=Date.parse(a.expires_at))throw new ReconOwnedUnknown(a.kind,databaseCode);
 }
 throw new ReconOwnedUnknown(a.kind,databaseCode);
}
export async function failReconAttempt(db:ReconDb,attempt:ReconBegin,reason:ReconReason):Promise<ReconFinish> {
 if(!reasons.includes(reason)||reason==='superseded'||reason==='configuration_changed')throw new ReconOwnedUnknown(attempt.kind);
 return await recoverReconMutation(db,attempt,'recon_fail_attempt_v2',{p_attempt_id:knownReconAttempt(attempt).attempt_id,p_reason_code:reason});
}
export function requireReconSuccess(finish:ReconFinish):Row {
 if(finish.outcome==='superseded')throw new ReconOwnedConflict(finish.kind);
 if(finish.terminal_outcome!=='success'||finish.result===null)throw new ReconSourceFailure(finish.reason_code||'internal_error');
 return finish.result;
}
export function createReconAttempt(absent:ReconBegin):ReconAttempt {
 if(absent.outcome!=='absent'||absent.kind!=='inventory_connect')throw new ReconOwnedUnknown(absent.kind);
 return {...absent,outcome:'begun',attempt_id:absent.request_id,ordinal:1,expected_config_revision:0};
}
