/** Direct attempts use the existing service publisher capability; no v1 fallback. */
type Row=Record<string,any>;
export type AttemptCandidate={device:Row;master:Row;host:string;ports:number[];key:string};
export type AttemptPort={port:number;state:'connected'|'refused'|'unverified';latency_ms:number|null;reason:'connection_refused'|'probe_unverified'|'not_attempted'|null};
export type AttemptResult={completed_at:string|null;ports:AttemptPort[]};
export type AttemptRequest=<T>(make:(signal:AbortSignal)=>PromiseLike<T>)=>Promise<T>;
export type AttemptTicket={attempt_id:string;sequence:string;binding:Row;candidate:AttemptCandidate;source:'automatic_tcp_sweep'|'manual_tcp_check'};
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sequence=(value:unknown)=>typeof value==='string'&&/^[1-9][0-9]*$/.test(value);
const same=(a:unknown,b:unknown):boolean=>{
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 if(object(a)||object(b))return object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
 return a===b;
};

export function directAttemptBinding(c:AttemptCandidate):Row {
 const d=c.device,m=c.master;
 return {unit_key:d.unit_key,source:d.source,device_name:d.device_name??null,organization:d.organization??null,
  activation_state:d.activation_state,master:{canonical_family:m.canonical_family,unit_tag:m.unit_tag,source_label:m.source_label,tracker_state:m.tracker_state}};
}

async function call(db:any,c:AttemptCandidate,source:AttemptTicket['source'],operation:Row,request:AttemptRequest):Promise<Row> {
 const response:any=await request(signal=>db.rpc('publish_camera_connection_v1',{
  p_device_id:c.device.id,p_revision:c.device.connection_revision,p_public_ip:c.device.public_ip,
  p_expected_ports:c.device.expected_ports,p_monitoring_profile:c.device.monitoring_profile,
  p_source:source,p_health:{direct_attempt:operation}
 }).abortSignal(signal));
 if(response?.error||!object(response?.data))throw Error('Direct attempt publication unverified');
 return response.data;
}

export async function beginDirectAttempt(db:any,c:AttemptCandidate,source:AttemptTicket['source'],request:AttemptRequest,makeId:()=>string=()=>crypto.randomUUID()):Promise<AttemptTicket|null> {
 const attempt_id=makeId();
 if(!uuid.test(attempt_id))return null;
 const binding=directAttemptBinding(c);
 try {
  const receipt=await call(db,c,source,{version:1,op:'begin',attempt_id,binding},request);
  // A replayed completed or superseded registration never authorizes another
  // physical probe. Every later transport must obtain a new registration.
  if(receipt.ok!==true||receipt.is_current!==true||receipt.phase!=='pending'||receipt.attempt_id!==attempt_id
   ||!sequence(receipt.sequence)||!same(receipt.binding,binding))return null;
  return {attempt_id,sequence:receipt.sequence,binding,candidate:c,source};
 }catch{return null;}
}

function currentCompletion(receipt:Row,ticket:AttemptTicket):boolean {
 return receipt.ok===true&&receipt.is_current===true&&receipt.phase==='completed'
  &&receipt.attempt_id===ticket.attempt_id&&receipt.sequence===ticket.sequence&&same(receipt.binding,ticket.binding)
  &&['connected','refused','unverified'].includes(receipt.validity)
  &&['online','verifying','offline','unknown'].includes(receipt.status)
  &&Number.isInteger(receipt.consecutive_failures)&&receipt.consecutive_failures>=0&&receipt.consecutive_failures<=3
  &&typeof receipt.health_published==='boolean';
}

export async function completeDirectAttempt(db:any,ticket:AttemptTicket,result:AttemptResult,request:AttemptRequest):Promise<Row|null> {
 // Detach a single frozen payload before awaiting delivery. Neither a retry
 // nor an uncertain-response lookup may regenerate the socket completion time.
 const operation=JSON.parse(JSON.stringify({version:1,op:'complete',attempt_id:ticket.attempt_id,
  sequence:ticket.sequence,binding:ticket.binding,result}));
 try {
  const receipt=await call(db,ticket.candidate,ticket.source,operation,request);
  return currentCompletion(receipt,ticket)?receipt:null;
 }catch {
  try {
   const receipt=await call(db,ticket.candidate,ticket.source,{version:1,op:'read',attempt_id:ticket.attempt_id,
    sequence:ticket.sequence,binding:ticket.binding},request);
   return currentCompletion(receipt,ticket)?receipt:null;
  }catch{return null;}
 }
}
