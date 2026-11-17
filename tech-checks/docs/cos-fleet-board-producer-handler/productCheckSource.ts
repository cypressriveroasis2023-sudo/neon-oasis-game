// Read only the sources needed for Product-ID TCP reachability. Camera identity,
// video, addresses and provider associations remain separate, unchanged signals.
export async function readProductCheckSource(io:any,signal:AbortSignal){
 if(signal.aborted)throw Error('cancelled');
 const read=async(stage:string,fn:()=>Promise<any>)=>{try{return await fn();}catch{throw Error(stage);}};
 const before=await read('inventory_source',()=>io.receipt(signal)),source=io.census(before.upload);
 const [tracker,devices,checks]=await Promise.all([
  read('tracker_source',()=>io.tracker(source.candidate,source.sourceSha256,signal)),read('saved_device_source',()=>io.devices(signal)),read('saved_check_source',()=>io.checks(signal)),
 ]);
 const after=io.census((await read('inventory_source',()=>io.receipt(signal))).upload);
 const stable=(c:any)=>JSON.stringify({sha:c.sourceSha256,records:c.census.records.map((r:any)=>[r.productId,r.placement,r.uploadLifecycle,r.binding])});
 if(signal.aborted||stable(source)!==stable(after))throw Error('inventory_changed');
 if(!Array.isArray(devices)||!Array.isArray(checks)||devices.length>10000||checks.length>10000||new Set(devices.map((d:any)=>String(d.id))).size!==devices.length||new Set(checks.map((c:any)=>String(c.camera_device_id))).size!==checks.length)throw Error('saved_configuration_invalid');
 const byId=new Map(checks.map((c:any)=>[String(c.camera_device_id),c.port_status]));
 return {census:source.census,tracker,devices,endpoints:devices.map((d:any)=>({deviceId:d.id,publicIp:d.public_ip,expectedPorts:d.expected_ports,connectionRevision:d.connection_revision,monitoringEnabled:d.monitoring_enabled,activationState:d.activation_state,portStatus:byId.get(String(d.id))||null}))};
}
