// Explicit Owner/IT checks. Targets come only from the same protected source
// and classifier used by the saved Fleet read, never from browser addresses.
type Device={id:number|string;unit_key:string;public_ip:string;expected_ports:number[];connection_revision:number|string;monitoring_enabled:boolean;activation_state?:string};
export type VerifySource={census:any;tracker:any;devices:Device[];endpoints:any[]};
type Verdict={productId:string;status:string;reason:string;checkedAt?:string|null};
type Options={read:(signal:AbortSignal)=>Promise<VerifySource>;classify:(source:VerifySource)=>{items:Verdict[]}|null;check:(device:Device,signal:AbortSignal)=>Promise<unknown>;signal?:AbortSignal};
const missingCheck='No fresh, completed check covers every enabled service-port configuration at this tracker IP.';
const fingerprint=(s:VerifySource)=>JSON.stringify({census:{sourceSha256:s.census.sourceSha256,records:s.census.records.map((r:any)=>[r.productId,r.unitNumber,r.placement,r.uploadLifecycle,r.binding])},tracker:s.tracker.records.map((r:any)=>[r.productId,r.placement,r.publicIp,r.reviewReasons,r.sourceRow]),trackerSha:s.tracker.trackerSourceSha256,devices:s.devices.map(d=>[d.id,d.unit_key,d.public_ip,d.expected_ports,d.connection_revision,d.monitoring_enabled,d.activation_state])});
export async function verifyProductsNow(body:unknown,options:Options){
 const v=body as {productIds?:unknown};
 if(!v||Object.keys(v).join(',')!=='productIds'||!Array.isArray(v.productIds)||!v.productIds.length||v.productIds.length>16||v.productIds.some(id=>typeof id!=='string'||!(/^[1-9][0-9]{0,14}$/).test(id))||new Set(v.productIds).size!==v.productIds.length)throw Error('Select between 1 and 16 distinct equipment Product IDs.');
 const ids=v.productIds as string[],controller=new AbortController(),cancel=()=>controller.abort();
 options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
 const timer=setTimeout(cancel,85000),results=new Map<string,Verdict>();
 const unknown=(id:string,reason:string)=>({productId:id,status:'unknown',reason,checkedAt:null});
 try{
  const before=await options.read(controller.signal);if(controller.signal.aborted)throw Error('Check cancelled. Refresh saved results before retrying.');
  // Remove old observations solely for eligibility evaluation. This never creates
  // a fabricated positive and does not supply the classification after a check.
  const admission=options.classify({...before,endpoints:before.endpoints.map(d=>({...d,portStatus:null}))});
  if(!admission)throw Error('Current mHelp and tracker sources could not be verified. No checks were started.');
  const targets=new Map<string,Device[]>(),work=new Map<string,Device>();
  for(const id of ids){
   const row=admission.items.find(r=>r.productId===id);
   if(!row||row.status!=='unknown'||row.reason!==missingCheck){results.set(id,unknown(id,row?.reason||'This Product ID is not current Field equipment.'));continue;}
   const entries=before.tracker.records.filter((r:any)=>r.productId===id),ip=entries.length===1?entries[0].publicIp:null;
   const devices=before.devices.filter(d=>d.public_ip===ip&&d.monitoring_enabled===true&&(d.activation_state===undefined||d.activation_state==='active'));
   if(!devices.length||devices.length>8||devices.some(d=>!(/^[1-9][0-9]{0,14}$/).test(String(d.id))||!d.unit_key||!Array.isArray(d.expected_ports)||!d.expected_ports.length||d.expected_ports.length>32||new Set(d.expected_ports).size!==d.expected_ports.length||d.expected_ports.some(p=>!Number.isInteger(p)||p<1||p>65535))){results.set(id,unknown(id,'Saved camera IP or port configuration needs correction. Open the equipment record.'));continue;}
   if(work.size+devices.filter(d=>!work.has(String(d.id))).length>32){results.set(id,unknown(id,'Too many saved endpoints for this batch. Verify this equipment separately.'));continue;}
   targets.set(id,devices);devices.forEach(d=>work.set(String(d.id),d));
  }
  const startedAt=Date.now(),errors=new Set<string>(),queue=[...work.values()];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{for(;;){const device=queue[cursor++];if(!device||controller.signal.aborted)return;try{await options.check(device,controller.signal);}catch{errors.add(String(device.id));}}}));
  if(targets.size){
   if(controller.signal.aborted)throw Error('The check outcome is uncertain. Refresh saved results before retrying.');
   const after=await options.read(controller.signal);if(controller.signal.aborted)throw Error('The check outcome is uncertain. Refresh saved results before retrying.');const saved=options.classify(after),changed=fingerprint(before)!==fingerprint(after);
   for(const [id,devices]of targets){const row=saved?.items.find(r=>r.productId===id);results.set(id,changed?unknown(id,'The source or saved connection changed during verification. Review the current record.'):devices.some(d=>errors.has(String(d.id)))?unknown(id,'A connection check could not complete. Refresh saved results before retrying.'):row&&['online','offline'].includes(row.status)&&row.checkedAt&&Date.parse(row.checkedAt)>=startedAt-1000?row:unknown(id,row?.status==='unknown'?row.reason:'The newly requested check is not yet confirmed in saved results. Refresh before retrying.'));}
  }
  return {contract:'COS_VERIFY_PRODUCTS_NOW_V1',items:ids.map(id=>results.get(id)||unknown(id,'Verification did not complete.'))};
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
}
