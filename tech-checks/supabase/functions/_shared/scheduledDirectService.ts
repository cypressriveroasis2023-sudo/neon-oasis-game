/** Owned saved-endpoint checks only. Placement and camera/channel health are never inferred. */
export const DIRECT_FAMILIES=['CAMV','Sniper','Sniper 2','Sniper 4'];
type Row=Record<string,any>;
type Probe={online:boolean;latency_ms:number|null;error?:string};
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const label=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toUpperCase().replace(/^CAM V /,'CAMV '):'';
const terminal=(v:unknown)=>typeof v==='string'&&/(?:^|\W)(?:RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
const revision=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?String(v):typeof v==='string'&&/^(?:0|[1-9][0-9]*)$/.test(v)?v:null;
const deviceId=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9][0-9]*$/.test(v)?v:null;
export function directPublicHost(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const host=value.replace(/\/32$/,''),parts=host.split('.');
 if(parts.length!==4||parts.some(p=>!/^(?:0|[1-9][0-9]{0,2})$/.test(p)||Number(p)>255))return null;
 const [a,b,c]=parts.map(Number);
 if(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113))return null;
 return host;
}
function savedPorts(v:unknown):number[]|null {
 if(!Array.isArray(v)||v.length<1||v.length>32||v.some(p=>!Number.isInteger(p)||p<1||p>65535)||new Set(v).size!==v.length)return null;
 return [...v].sort((a,b)=>a-b);
}
function masterKey(m:Row):string|null {
 if(!DIRECT_FAMILIES.includes(m.canonical_family)||typeof m.unit_tag!=='string'||!/^\d{1,6}$/.test(m.unit_tag)||Number(m.unit_tag)<=0)return null;
 const key=label(m.canonical_family+' '+m.unit_tag);
 return label(m.source_label)===key?key:null;
}
export type DirectCandidate={master:Row;device:Row;host:string;ports:number[];key:string};
export function directCandidates(master:Row[],devices:Row[]) {
 if(!Array.isArray(master)||!Array.isArray(devices)||master.some(m=>!object(m))||devices.some(d=>!object(d)))throw Error('Direct inventory is unavailable.');
 const selected:DirectCandidate[]=[],held:{family:string;unit:string;reason:string}[]=[];
 const masterCounts=new Map<string,number>(),deviceMatches=new Map<string,Row[]>();
 for(const m of master){const key=masterKey(m);if(key)masterCounts.set(key,(masterCounts.get(key)||0)+1);}
 for(const d of devices){const key=label(d.unit_key);deviceMatches.set(key,[...(deviceMatches.get(key)||[]),d]);}
 for(const m of master){
  const key=masterKey(m),matches=key?deviceMatches.get(key)||[]:[];
  let reason:string|null=null;const d=matches[0];
  if(!key||masterCounts.get(key)!==1||matches.length!==1)reason='identity_unverified';
  else if(!['shop','field_or_unknown'].includes(m.tracker_state)||[m.source_label,d.unit_key,d.device_name,d.organization,d.activation_state].some(terminal))reason='retired_or_not_in_use';
  else if(d.source!=='2026_unit_tracker'||!deviceId(d.id)||d.monitoring_profile!==(m.canonical_family==='CAMV'?'camv':'sniper'))reason='ownership_unverified';
  else if(d.monitoring_enabled!==true)reason='monitoring_disabled';
  else if(!['active','deactivated'].includes(d.activation_state))reason='lifecycle_unverified';
  else if(!directPublicHost(d.public_ip)||!savedPorts(d.expected_ports)||revision(d.connection_revision)===null)reason='saved_endpoint_unavailable';
  if(reason){held.push({family:String(m.canonical_family||''),unit:String(m.source_label||''),reason});continue;}
  selected.push({master:m,device:d,host:directPublicHost(d.public_ip)!,ports:savedPorts(d.expected_ports)!,key:key!});
 }
 return {selected,held};
}

const DEVICE_FIELDS='id,unit_key,device_name,source,public_ip,expected_ports,connection_revision,monitoring_profile,monitoring_enabled,activation_state,organization,last_health_checked_at';
export const SWEEP_DEADLINE_MS=48_000;
export const SWEEP_WORKERS=10;
const IO_TIMEOUT_MS=4_000;
const PROBE_TIMEOUT_MS=2_200;

// Each request owns its signal. A timed out read/publication is held, never an outage.
export async function boundedRequest<T>(make:(signal:AbortSignal)=>PromiseLike<T>,deadline:number,now=()=>Date.now(),timeout=IO_TIMEOUT_MS):Promise<T> {
 const remaining=Math.min(timeout,deadline-now());
 if(remaining<=0)throw Error('Sweep deadline reached');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([Promise.resolve(make(controller.signal)),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Sweep request timed out'));},remaining);})]);}
 finally{clearTimeout(timer!);controller.abort();}
}

export function scheduledOrder(candidates:DirectCandidate[],startedAt:number):DirectCandidate[] {
 const oldest=[...candidates].sort((a,b)=>{
  const time=(c:DirectCandidate)=>Number.isFinite(Date.parse(c.device.last_health_checked_at))?Date.parse(c.device.last_health_checked_at):0;
  return time(a)-time(b)||Number(a.device.id)-Number(b.device.id);
 });
 // Reserve one bounded wave for fair continuation even when the oldest rows are
 // persistently held. The remaining queue stays oldest first. No cursor writes.
 if(!oldest.length)return oldest;
 const offset=(Math.floor(startedAt/900_000)*SWEEP_WORKERS)%oldest.length;
 const reserved=Array.from({length:Math.min(SWEEP_WORKERS,oldest.length)},(_,i)=>oldest[(offset+i)%oldest.length]);
 const ids=new Set(reserved.map(c=>String(c.device.id)));
 return [...reserved,...oldest.filter(c=>!ids.has(String(c.device.id)))];
}

function sameConnection(a:DirectCandidate,b:DirectCandidate):boolean {
 return a.key===b.key&&a.master.canonical_family===b.master.canonical_family&&a.master.unit_tag===b.master.unit_tag&&a.master.source_label===b.master.source_label
  &&String(a.device.id)===String(b.device.id)&&a.device.unit_key===b.device.unit_key&&a.device.source===b.device.source
  &&revision(a.device.connection_revision)===revision(b.device.connection_revision)&&a.device.public_ip===b.device.public_ip
  &&a.device.monitoring_profile===b.device.monitoring_profile&&JSON.stringify(a.device.expected_ports)===JSON.stringify(b.device.expected_ports);
}

function failureCount(previous:Row,c:DirectCandidate,observedAt:number):number {
 const ports=previous?.port_status,proof=ports?._connection;
 const checked=Date.parse(proof?.checkedAt);
 if(!proof||proof.revision!==revision(c.device.connection_revision)||proof.ip!==c.host||!Number.isFinite(checked)||checked>observedAt
  ||proof.reachable!==false||!['offline','verifying'].includes(proof.status))return 0;
 const actual=Object.keys(ports).filter(k=>k!=='_connection').sort((a,b)=>Number(a)-Number(b));
 if(actual.length!==c.ports.length||actual.some((p,i)=>p!==String(c.ports[i])||typeof ports[p]?.online!=='boolean'))return 0;
 return Number.isInteger(proof.consecutiveFailures)&&proof.consecutiveFailures>=0?Math.min(3,proof.consecutiveFailures):0;
}

/** Scheduled checks produce saved service/port evidence, never camera/channel health. */
export async function collectScheduledDirect(db:any,probe:(host:string,port:number,timeout:number)=>Promise<Probe>,options:{startedAt?:number;now?:()=>number;deadlineMs?:number;ioTimeoutMs?:number}={}) {
 const now=options.now||(()=>Date.now()),startedAt=options.startedAt??now(),deadline=startedAt+(options.deadlineMs??SWEEP_DEADLINE_MS),ioTimeout=options.ioTimeoutMs??IO_TIMEOUT_MS;
 const request=<T>(make:(signal:AbortSignal)=>PromiseLike<T>)=>boundedRequest(make,deadline,now,ioTimeout);
 const inventory=async(wave?:DirectCandidate[])=>{
  const families=wave?[...new Set(wave.map(c=>c.master.canonical_family))]:DIRECT_FAMILIES;
  // ILIKE wildcards retain alternate whitespace/case, CAM V spelling and every
  // disabled/foreign-profile duplicate. These fragments contain validated family
  // words and numeric tags only. Exact normalized identity is checked afterward.
  const keys=wave?[...new Set(wave.map(c=>'unit_key.ilike.%'+(c.master.canonical_family==='CAMV'?'CAM%V':c.master.canonical_family.replaceAll(' ','%'))+'%'+c.master.unit_tag+'%'))]:['unit_key.ilike.%SNIPER%','unit_key.ilike.%CAM%'];
  const [m,d]:any[]=await Promise.all([
   request(signal=>{let query=db.from('equipment_master').select('canonical_family,unit_tag,source_label,tracker_state').in('canonical_family',families);if(wave)query=query.in('unit_tag',[...new Set(wave.map(c=>c.master.unit_tag))]);return query.limit(1000).abortSignal(signal);}),
   request(signal=>db.from('camera_devices').select(DEVICE_FIELDS).or(keys.join(',')).limit(1000).abortSignal(signal)),
  ]);
  if(m.error||d.error||!Array.isArray(m.data)||!Array.isArray(d.data)||m.data.length>=1000||d.data.length>=1000)throw Error('Direct inventory is unavailable or truncated');
  return directCandidates(m.data,d.data);
 };
 const initial=await inventory(),queue=scheduledOrder(initial.selected,startedAt),results:Row[]=[];
 let cursor=0;
 while(cursor<queue.length&&now()+PROBE_TIMEOUT_MS+1_000<deadline){
  const wave=queue.slice(cursor,cursor+SWEEP_WORKERS);cursor+=wave.length;
  // No database transaction is held across these sockets. Each preceding read
  // completed before this wave; publication starts only after every socket settles.
  const observations=await Promise.all(wave.map(async c=>{
   const began=now();
   try{
    const values=await Promise.all(c.ports.map(async p=>[String(p),await boundedRequest(()=>probe(c.host,p,PROBE_TIMEOUT_MS),deadline,now,PROBE_TIMEOUT_MS+100)] as const));
    const at=now();
    if(at<began||at-began>PROBE_TIMEOUT_MS+500||values.some(([,v])=>!object(v)||typeof v.online!=='boolean'||v.latency_ms!==null&&(!Number.isFinite(v.latency_ms)||v.latency_ms<0)||v.error&&/(auth|forbidden|permission|unauthori[sz]ed)/i.test(v.error)))return null;
    return {ports:Object.fromEntries(values),at};
   }catch{return null;}
  }));
  let fresh:ReturnType<typeof directCandidates>,previous:Row[];
  try{
   const [current,health]:any[]=await Promise.all([inventory(wave),request(signal=>db.from('camera_health_current').select('camera_device_id,port_status,overall_status,first_failed_at').in('camera_device_id',wave.map(c=>c.device.id)).abortSignal(signal))]);
   if(health.error||!Array.isArray(health.data))throw Error('Previous observation unavailable');
   fresh=current;previous=health.data;
  }catch{
   results.push(...wave.map(c=>({id:c.device.id,status:'unknown',reason:'eligibility_unverified',published:false,activated:false})));continue;
  }
  await Promise.all(wave.map(async(c,i)=>{
   const observed=observations[i],current=fresh.selected.find(x=>String(x.device.id)===String(c.device.id));
   const held=(reason:string)=>results.push({id:c.device.id,name:c.device.device_name,status:'unknown',reason,published:false,activated:false});
   if(!observed)return held('probe_incomplete');
   if(!current||!sameConnection(c,current))return held('source_or_connection_changed');
   if(now()>=deadline||now()-observed.at>60_000)return held('observation_expired');
   const prev=previous.find(h=>String(h.camera_device_id)===String(c.device.id))||{},reachable=Object.values(observed.ports).some((p:any)=>p.online);
   const failures=reachable?0:Math.min(3,failureCount(prev,c,observed.at)+1),status=reachable?'online':failures>=3?'offline':'verifying',checked=new Date(observed.at).toISOString();
   const health:Row={camera_device_id:c.device.id,port_status:observed.ports,checked_at:checked,overall_status:status,ip_reachable:reachable,consecutive_failures:failures,confirmed_outage:failures>=3,confirmation_reason:failures>=3?'3 consecutive failed checks of the saved service endpoint':null,detail:reachable?'Saved Avigilon service port responded; individual camera health is unverified.':'Saved Avigilon service ports did not respond; individual camera health is unverified.'};
   if(!reachable&&failures===1)health.first_failed_at=checked;
   if(reachable){health.first_failed_at=null;health.acknowledged_at=null;health.acknowledged_by=null;if(prev.overall_status&&prev.overall_status!=='online')health.last_recovered_at=checked;}
   try{
    const saved:any=await request(signal=>db.rpc('publish_camera_connection_v1',{p_device_id:c.device.id,p_revision:c.device.connection_revision,p_public_ip:c.device.public_ip,p_expected_ports:c.device.expected_ports,p_monitoring_profile:c.device.monitoring_profile,p_health:health,p_source:'automatic_tcp_sweep'}).abortSignal(signal));
    if(saved.error||saved.data?.ok!==true)return held(saved.data?.reason||'publication_unverified');
    results.push({id:c.device.id,name:c.device.device_name,monitoring_profile:c.device.monitoring_profile,status,probe_status:reachable?'online':'offline',confirmed_outage:failures>=3,published:true,activated:false,evidence:'service_port_only'});
   }catch{return held('publication_unverified');}
  }));
 }
 return {results,eligible:queue.length,held:initial.held,deferred:queue.length-cursor,deadlineReached:cursor<queue.length};
}
