/* Capability-gated browser bridge. No service credentials or source authority
 * originate in the browser; native and original legacy RPC authorization apply. */
(function(root){
 const names=new Set(['set_camera_unit_connection_v2','owner_set_camera_unit_placement_v2','owner_add_camera_unit_v1','owner_remove_camera_unit_v1']);
 const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
 const clients=new WeakMap();
 function authority(value){if(value?.contract!=='COS_AVIGILON_AUTHORITY_V1'||typeof value.tenantId!=='string'||!value.tenantId||typeof value.generation!=='string'||!(/^[1-9]\d*$/.test(value.generation))||typeof value.rosterRevision!=='string'||!value.rosterRevision||value.admitted!==true)throw Error('Admitted Avigilon authority unavailable');return value;}
 function sameAuthority(before,after){const a=authority(before),b=authority(after);if(['tenantId','generation','rosterRevision'].some(key=>a[key]!==b[key]))throw Error('Avigilon authority changed during read; reload saved results');}
 function nativeSummary(value){authority(value?.avigilonAuthority);if(value.evidenceVersion!==2||!Array.isArray(value.rows)||new Set(value.rows.map(row=>String(row.id))).size!==value.rows.length)throw Error('Native health unavailable');return value;}
 function projectSnapshot(snapshot,summary){
  if(!Array.isArray(snapshot?.devices)||!Array.isArray(snapshot?.healthRows)||new Set(snapshot.devices.map(d=>String(d.id))).size!==snapshot.devices.length)throw Error('Complete camera identity and health snapshot unavailable');
  const rows=new Map(summary.rows.map(row=>[String(row.id),row])),managed=new Map();
  for(const device of snapshot.devices){
   const row=rows.get(String(device.id)),direct=['sniper','camv'].includes(String(device.monitoring_profile||'').toLowerCase());
   if(!row||!Object.hasOwn(row,'avigilonPublication')){if(direct)throw Error('Native managed identity missing; reload saved results');continue;}
   if(row.unit!==device.unit_key)throw Error('Avigilon receipt ownership changed; reload saved results');
   const p=row.avigilonPublication,e=row.serviceEvidence;
   if(!e||!['online','offline','unknown'].includes(e.status))throw Error('Native service evidence unavailable');
   const current=Boolean(p);
   if(current){
    const claims=[...(summary.unitIdentities||[]),...(summary.ownerConfirmedUnitIdentities||[])].filter(i=>Array.isArray(i.deviceIds)&&i.deviceIds.includes(String(device.id)));
    if(!(/^[1-9]\d{0,18}$/.test(p.receiptId))||!p.unitId||!p.rosterUnitId||claims.length!==1||claims[0].unitId!==p.unitId||!Array.isArray(claims[0].unitKeys)||!claims[0].unitKeys.includes(device.unit_key))throw Error('Avigilon receipt ownership does not match the loaded identity');
    const ip=String(device.public_ip||'').replace(/\/32$/,'');
    if(row.scope!=='field'||String(p.endpointRevision)!==String(device.connection_revision)||row.connection?.publicIp!==ip||JSON.stringify(row.connection?.ports)!==JSON.stringify(device.expected_ports)||typeof e.observedAt!=='string'||!Number.isFinite(Date.parse(e.observedAt))||typeof e.reachable!=='boolean'||!['online','offline'].includes(e.status)||(e.status==='online')!==e.reachable||!Number.isInteger(e.consecutiveFailures)||e.consecutiveFailures<0||e.consecutiveFailures>3||e.confirmedOutage!==(e.consecutiveFailures>=3))throw Error('Avigilon receipt endpoint or health changed; reload saved results');
   }
   managed.set(String(device.id),{camera_device_id:device.id,checked_at:current?e.observedAt:null,overall_status:current?e.status:'unknown',ip_reachable:current?e.reachable:null,confirmed_outage:current?e.confirmedOutage:false,consecutive_failures:current?e.consecutiveFailures:0,native_publication_receipt:p?.receiptId||null,native_authority:summary.avigilonAuthority,native_unit_id:p?.unitId||null,native_roster_unit_id:p?.rosterUnitId||null,native_unit_key:row.unit,native_endpoint_revision:p?.endpointRevision||null,detail:'Native service reachability; video/channel coverage unknown',port_status:current?{_connection:{revision:p.endpointRevision,ip:row.connection.publicIp,checkedAt:e.observedAt,status:e.status,reachable:e.reachable,confirmedOutage:e.confirmedOutage,consecutiveFailures:e.consecutiveFailures}}:{}});
  }
  return {...snapshot,healthRows:[...snapshot.healthRows.filter(row=>!managed.has(String(row.camera_device_id))),...managed.values()],nativeAuthority:summary.avigilonAuthority};
 }
 function create(db,fetcher=root.fetch.bind(root)){
  if(clients.has(db))return clients.get(db);
  // Retain the authenticated SDK method before callers decorate the proxy.
  const legacyInvoke=db.functions?.invoke?.bind(db.functions);let invokeOverride;
  async function call(method,path,body){const session=await db.auth.getSession();const token=session.data?.session?.access_token;if(!token)throw Error('Sign in again');const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({method,path,body:body||{}})});const value=await response.json();if(!response.ok)throw Error(value.error||'Verified source service unavailable');return value;}
  const features=async()=>(await call('GET','/api/session')).features||{};
  function healthQuery(query,selection={}){return new Proxy(query,{get(target,key){
   if(key==='then')return (resolve,reject)=>Promise.resolve(target).then(async result=>{
    if(result.error||!(await features()).freshAvigilonChecks)return result;
    throw Error('Read camera identity and health together with a complete saved snapshot');
   }).catch(error=>({data:null,error:{message:error.message}})).then(resolve,reject);
   const value=target[key];if(typeof value!=='function')return value;return (...args)=>{const next={...selection};if(key==='eq'&&args[0]==='camera_device_id')next.ids=[String(args[1])];if(key==='in'&&args[0]==='camera_device_id')next.ids=args[1].map(String);if(key==='single'||key==='maybeSingle')next.single=true;return healthQuery(value.apply(target,args),next);};
  }});}
  const guarded=new Proxy(db,{get(target,key){if(key==='from')return table=>table==='camera_health_current'?healthQuery(target.from(table)):target.from(table);if(key==='functions')return new Proxy(target.functions,{get(functions,method){if(method!=='invoke')return functions[method];if(invokeOverride)return invokeOverride;return async(name,options)=>{
    if(name!=='camera-health-check')return legacyInvoke(name,options);
    try{
     // Disabled native checks retain the existing publisher without an extra
     // device read. A denied capability lookup never falls back to that path.
     if(!(await features()).freshAvigilonChecks)return legacyInvoke(name,options);
     const device=await target.from('camera_devices').select('monitoring_profile').eq('id',options?.body?.device_id).maybeSingle();
     if(device.error)return {data:null,error:device.error};
     if(['sniper','camv'].includes(String(device.data?.monitoring_profile||'').toLowerCase())){
      const run=await checkManaged();if(!run)throw Error('Managed check capability changed; reload before verifying');
      return {data:{nativePublication:true,run,publicationReceipts:run.rows.map(row=>row.publicationReceipt).filter(Boolean)},error:null};
     }
     return legacyInvoke(name,options);
    }catch(error){return {data:null,error:{message:error.message}};}
   };},set(functions,method,value){if(method==='invoke'){invokeOverride=value;return true;}return Reflect.set(functions,method,value);}});if(key!=='rpc'){const v=target[key];return typeof v==='function'?v.bind(target):v;}return async(name,args)=>{if(!names.has(name))return target.rpc(name,args);try{if(!(await features()).avigilonSourceWrites)return target.rpc(name,args);const result=await call('POST','/api/avigilon-source-write',{name,args,requestId:root.crypto.randomUUID()});return {data:result.result,error:null};}catch(error){return {data:null,error:{message:error.message}};}};}});
  async function checkManaged(){if(!(await features()).freshAvigilonChecks)return null;const started=await call('POST','/api/avigilon-check-runs');let run=started.run;const deadline=Date.now()+55000;while(run.state==='pending'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,750));run=await call('GET','/api/avigilon-check-runs/'+run.id);}if(run.state==='pending')throw Error('Native check is still pending; open Fleet to read its result');for(const row of run.rows)if(['online','nonresponse'].includes(row.outcome)&&!row.publicationReceipt)throw Error('Native publication receipt missing');return run;}
  async function readSnapshot(read){
   if(!(await features()).freshAvigilonChecks)return read(db);
   const before=nativeSummary(await call('GET','/api/camera-health/summary-v3'));
   const snapshot=await read(db);
   const after=nativeSummary(await call('GET','/api/camera-health/summary-v3'));
   sameAuthority(before.avigilonAuthority,after.avigilonAuthority);
   return projectSnapshot(snapshot,after);
  }
  const bridge={db:guarded,checkManaged,readSnapshot};clients.set(guarded,bridge);clients.set(db,bridge);return bridge;
 }
 root.AvigilonManagedBridge={create,readSnapshot(db,read){const bridge=clients.get(db);if(!bridge)throw Error('Camera saved reader unavailable');return bridge.readSnapshot(read);}};
})(globalThis);
