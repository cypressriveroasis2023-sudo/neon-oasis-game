import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { crypto } from "jsr:@std/crypto@1";

const cors={"content-type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-camera-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
async function md5(s:string){return hex(await crypto.subtle.digest("MD5",new TextEncoder().encode(s)))}
async function loginPassword(p:string){const h=await md5(p);return md5(h+h.slice(0,8))}
async function post(url:string,data:any,token?:string){
  const h:any={"content-type":"application/json;charset=UTF-8","accept":"application/json"};
  if(token)h.authorization=token;
  const r=await fetch(url,{method:"POST",headers:h,body:JSON.stringify(data)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Star4Live HTTP ${r.status}: ${j?.message||j?.msg||"request failed"}`);
  const code=j?.code;
  if(code!==undefined&&code!==null&&!([0,200,"0","200"].includes(code)))throw new Error(`Star4Live code ${code}: ${j?.message||j?.msg||"request failed"}`);
  return j;
}
async function tcp(host:string,port:number,timeout=1400){
  const t=Date.now();let c:any;
  try{
    c=await Promise.race([
      Deno.connect({hostname:host,port}),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),timeout))
    ]) as any;
    c.close();
    return {online:true,latency_ms:Date.now()-t};
  }catch(e){
    try{c?.close()}catch{}
    return {online:false,latency_ms:null,error:String((e as any)?.message||e)};
  }
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){
  const out:R[]=[];let i=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){const idx=i++;if(idx>=items.length)return;out[idx]=await fn(items[idx])}
  });
  await Promise.all(workers);return out;
}
function norm(s:any){return String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"")}
function trackerKey(family:string,tag:string){
  const f=family.toLowerCase();
  if(f==="camv")return norm("camv"+tag);
  if(f==="sniper")return norm("sniper"+tag);
  if(f==="sniper 2")return norm("sniper2"+tag);
  if(f==="sniper 4")return norm("sniper4"+tag);
  return "";
}
function normalizedTag(tag:any){
  const raw=String(tag||"").trim(),parts=raw.split(".");
  const base=(parts[0]||"").padStart(3,"0");
  return base+(parts.length>1?"."+parts.slice(1).join("."):"");
}
function vigilantTrackerKey(family:any,tag:any){return String(family||"").trim().toLowerCase()+"|"+normalizedTag(tag)}
function trackerLabelNorm(v:any){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9.]+/g,"")}
function vigilantLocalTrackerKey(d:any,keySet:Set<string>,labelMap:Map<string,string>){
  const raw=String(d?.unit_key||d?.device_name||"").trim(),u=raw.toUpperCase(),prof=String(d?.monitoring_profile||"").toLowerCase();
  const exact=labelMap.get(trackerLabelNorm(raw));if(exact)return exact;
  const tag="(\\d{1,3}(?:\\.\\d+)?)";let m:any,k:string;
  if((m=u.match(new RegExp("(?:HELIOS|ALPHA)\\s*"+tag)))||(prof==="helios"&&(m=u.match(new RegExp(tag))))){k=vigilantTrackerKey("Helios",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("RANGER\\s*"+tag)))||(prof==="ranger"&&(m=u.match(new RegExp(tag))))){k=vigilantTrackerKey("Ranger",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("SS\\s*HYBRID\\s*"+tag)))){k=vigilantTrackerKey("SS Hybrid",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("SOLAR\\s*SPOTTER\\s*"+tag)))||(prof==="solar_spotter"&&(m=u.match(new RegExp(tag))))){
    const solar=vigilantTrackerKey("Solar Spotter",m[1]),hybrid=vigilantTrackerKey("SS Hybrid",m[1]);
    if(keySet.has(solar))return solar;if(keySet.has(hybrid))return hybrid;
  }
  if((m=u.match(new RegExp("SPOTTER\\s*"+tag)))||((prof==="nvr"||prof==="spotter")&&(m=u.match(new RegExp(tag))))){k=vigilantTrackerKey("Spotter",m[1]);if(keySet.has(k))return k}
  return "";
}
function vigilantProviderTrackerKey(name:any,keySet:Set<string>){
  const u=String(name||"").trim().toUpperCase(),tag="(\\d{1,3}(?:\\.\\d+)?)";let m:any,k:string;
  if((m=u.match(new RegExp("(?:HELIOS|ALPHA)\\s*"+tag)))){k=vigilantTrackerKey("Helios",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("RANGER\\s*"+tag)))){k=vigilantTrackerKey("Ranger",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("SS\\s*HYBRID\\s*"+tag)))){k=vigilantTrackerKey("SS Hybrid",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("SOLAR\\s*SPOTTER\\s*"+tag)))){k=vigilantTrackerKey("Solar Spotter",m[1]);if(keySet.has(k))return k}
  if((m=u.match(new RegExp("SPOTTER(?:_NVR)?\\s*"+tag)))){k=vigilantTrackerKey("Spotter",m[1]);if(keySet.has(k))return k}
  return "";
}
async function starInventory(db:any){
  const username=Deno.env.get("vigilant_username")||Deno.env.get("VIGILANT_USERNAME");
  const password=Deno.env.get("vigilant_password")||Deno.env.get("VIGILANT_PASSWORD");
  if(!username||!password)throw new Error("Vigilant secrets are not configured");
  const discovery=await post("https://www.star4live.com/openapi/user/account/server/getbyloginname",{loginName:username});
  const host=discovery?.data?.serverHost||discovery?.data?.server||discovery?.data?.host||"os.star4live.com";
  const base=String(host).startsWith("http")?String(host):`https://${host}`;
  const pwd=await loginPassword(password);
  const hardId=(await md5(navigator.userAgent))+navigator.userAgent;
  const tok=await post(`${base}/openapi/user/account/token/get`,{clientId:"",clientName:"ucs-bs",hardId,password:pwd,passwordVersion:1,platform:navigator.platform||"Supabase Edge",username});
  const token=tok?.data?.token||tok?.data?.accessToken||tok?.data?.authorization;
  if(!token)throw new Error("Star4Live login succeeded but no token was returned");

  const {data:tracker,error:te}=await db.from("equipment_master")
    .select("canonical_family,unit_tag,source_label,tracker_state,health_provider,tracker_public_ip")
    .in("canonical_family",["Helios","Ranger","Solar Spotter","Spotter","SS Hybrid"]);
  if(te)throw te;
  const trackerRows=tracker||[];
  const trackerRowByKey=new Map<string,any>(),trackerLabelMap=new Map<string,string>();
  for(const t of trackerRows){
    const k=vigilantTrackerKey(t.canonical_family,t.unit_tag);
    trackerRowByKey.set(k,t);
    const label=trackerLabelNorm(t.source_label);if(label)trackerLabelMap.set(label,k);
  }
  const trackerKeySet=new Set(trackerRowByKey.keys());
  const queries=[...new Set(trackerRows.map((x:any)=>String(x.unit_tag||"").trim()).filter(Boolean))];
  const endpoint=`${base}/openapi/user/organization/sub/resource/list`;
  async function inventoryPages(q:string){
    const resources:any[]=[];const serials=new Set<string>();let pageStart=0;
    for(let page=0;page<100;page++){
      const res=await post(endpoint,{organizationId:"283838",deviceName:q,pageSize:100,pageStart,agentStr:0,userMode:0},token);
      if(!Array.isArray(res?.data?.resourceList))throw new Error("Star4Live returned no resource list");
      const batch=res.data.resourceList;
      let added=0;for(const v of batch){const key=String(v.deviceSerial||v.deviceName||"");if(key&&!serials.has(key)){serials.add(key);resources.push(v);added++}}
      if(batch.length<100)return resources;
      if(!added)throw new Error("Star4Live pagination repeated a page");
      pageStart+=batch.length;
    }
    throw new Error("Star4Live pagination exceeded 100 pages");
  }
  let accountInventory:any[]=[],accountInventoryError:string|null=null;
  try{accountInventory=await inventoryPages("");if(!accountInventory.length)throw new Error("Empty account inventory")}catch(e){accountInventoryError=String((e as any)?.message||e)}
  const accountInventoryComplete=accountInventoryError===null;
  const queryResults=accountInventoryComplete?[{q:"ALL",resources:accountInventory,error:null as string|null}]:await mapLimit(queries,6,async(q:string)=>{
    try{return {q,resources:await inventoryPages(q),error:null as string|null}}
    catch(e){return {q,resources:[],error:String((e as any)?.message||e)}}
  });
  const failures=queryResults.filter(x=>x.error);
  const all:any[]=[];const seen=new Set<string>(),resourceQueryTags=new Map<string,Set<string>>();
  for(const page of queryResults)for(const v of page.resources as any[]){
    const k=String(v.deviceSerial||v.deviceName||"");
    if(!k)continue;
    const tags=resourceQueryTags.get(k)||new Set<string>();tags.add(page.q);resourceQueryTags.set(k,tags);
    if(!seen.has(k)){seen.add(k);all.push(v)}
  }
  if(queryResults.length>0&&failures.length===queryResults.length)throw new Error("Every Star4Live tracker lookup failed; refusing to publish a successful reconciliation.");

  const {data:locals,error}=await db.from("camera_devices")
    .select("id,device_name,device_serial,external_device_id,monitoring_profile,unit_key,activation_state,organization")
    .eq("source","vigilant_control_center");
  if(error)throw error;
  const bySerial=new Map<string,any>(),byName=new Map<string,any>();
  for(const d of locals||[]){
    if(d.device_serial)bySerial.set(String(d.device_serial).toLowerCase(),d);
    if(d.external_device_id)bySerial.set(String(d.external_device_id).toLowerCase(),d);
    if(d.device_name)byName.set(String(d.device_name).toLowerCase(),d);
  }
  const now=new Date().toISOString();let matched=0,online=0,offline=0,unmatched=0;
  const unmatchedResources:any[]=[];
  const byProfile:any={},coveredTrackerUnits=new Map<string,any>();
  for(const v of all){
    const resourceKey=String(v.deviceSerial||v.deviceName||"");
    let d=bySerial.get(String(v.deviceSerial||"").toLowerCase())||byName.get(String(v.deviceName||"").toLowerCase());
    if(!d){
      unmatched++;
      unmatchedResources.push({
        device_name:String(v.deviceName||""),
        device_serial:String(v.deviceSerial||""),
        status:Number(v.status)===1?"online":"offline",
        organization:String(v.organizationName||v.orgName||v.organization||v.parentOrganizationName||""),
        query_tags:[...(resourceQueryTags.get(resourceKey)||new Set<string>())].sort()
      });
      continue
    }
    matched++;
    const isOnline=Number(v.status)===1;isOnline?online++:offline++;
    const p=String(d.monitoring_profile||"unknown");
    byProfile[p]??={matched:0,online:0,offline:0,field_units:new Set(),shop_units:new Set()};
    byProfile[p].matched++;isOnline?byProfile[p].online++:byProfile[p].offline++;
    const shop=String(d.organization||"").trim().toLowerCase()==="root"||String(d.activation_state||"").toLowerCase()==="deactivated";
    (shop?byProfile[p].shop_units:byProfile[p].field_units).add(String(d.unit_key||d.device_name));
    const tk=vigilantLocalTrackerKey(d,trackerKeySet,trackerLabelMap)||vigilantProviderTrackerKey(v.deviceName,trackerKeySet);
    if(tk){
      const cov=coveredTrackerUnits.get(tk)||{online:0,offline:0,rows:0};
      cov.rows++;isOnline?cov.online++:cov.offline++;coveredTrackerUnits.set(tk,cov);
    }
    await db.from("camera_devices").update({
      vigilant_status:isOnline?"Online":"Offline",
      source_status:isOnline?"online":"offline",
      source_last_seen_at:now,
      external_device_id:String(v.deviceSerial||d.external_device_id||""),
      last_online_at:isOnline?now:undefined,
      source_metadata:{
        provider:"vigilant_star4live",status:v.status,latestOnline:v.latestOnline,
        publicIp:v.publicIp,localIp:v.localIp,deviceModel:v.deviceModel,
        organizationName:v.organizationName||v.orgName||v.organization||v.parentOrganizationName||null,
        organizationId:v.organizationId||v.orgId||null,syncedAt:now
      }
    }).eq("id",d.id);
    await db.from("camera_health_current").upsert({
      camera_device_id:d.id,overall_status:isOnline?"online":"offline",
      ip_reachable:isOnline,checked_at:now,consecutive_failures:isOnline?0:1,
      detail:`Vigilant / Star4Live live API reports ${isOnline?"ONLINE":"OFFLINE"}`
    },{onConflict:"camera_device_id"});
  }
  // A live Star4Live resource with an exact tracker unit name is valid tracker-level
  // evidence even when the local camera row has not been imported yet. This closes
  // inventory gaps without creating/activating/deactivating camera_devices records.
  for(const r of unmatchedResources){
    const tk=vigilantProviderTrackerKey(r.device_name,trackerKeySet);
    if(!tk)continue;
    const t=trackerRowByKey.get(tk),hint=String(t?.health_provider||"").trim().toLowerCase();
    if(hint&&hint!=="vigilant")continue;
    const cov=coveredTrackerUnits.get(tk)||{online:0,offline:0,rows:0,provider_only_rows:0};
    cov.rows++;cov.provider_only_rows=Number(cov.provider_only_rows||0)+1;
    String(r.status)==="online"?cov.online++:cov.offline++;
    coveredTrackerUnits.set(tk,cov);
  }

  const profOut:any={};
  for(const [k,v] of Object.entries(byProfile) as any){
    profOut[k]={matched:v.matched,online:v.online,offline:v.offline,field_units:v.field_units.size,shop_units:v.shop_units.size};
  }
  const trackerByFamily:any={},trackerLiveCoverage:any={};
  for(const t of trackerRows){
    const f=String(t.canonical_family),state=String(t.tracker_state||"field_or_unknown"),k=vigilantTrackerKey(f,t.unit_tag),cov=coveredTrackerUnits.get(k);
    trackerByFamily[f]??={field_or_unknown:0,shop:0,retired:0,total:0};
    trackerByFamily[f].total++;trackerByFamily[f][state]=(trackerByFamily[f][state]||0)+1;
    trackerLiveCoverage[f]??={tracker_total:0,field_or_unknown:0,shop:0,retired:0,live_matched_units:0,provider_only_live_units:0,field_live_matched_units:0,field_online_units:0,field_offline_units:0,field_degraded_units:0,field_other_provider_units:0,field_unresolved_provider_units:0,missing_field_units:[] as string[],other_provider_field_units:[] as string[],unresolved_provider_field_units:[] as string[]};
    const a=trackerLiveCoverage[f];a.tracker_total++;a[state]=(a[state]||0)+1;
    if(cov){
      a.live_matched_units++;
      if(Number(cov.provider_only_rows||0)>0)a.provider_only_live_units++;
      if(state==="field_or_unknown"){
        a.field_live_matched_units++;
        if(cov.online>0&&cov.offline>0)a.field_degraded_units++;
        else if(cov.online>0)a.field_online_units++;
        else if(cov.offline>0)a.field_offline_units++;
      }
    }else if(state==="field_or_unknown"){
      const hint=String(t.health_provider||"").trim().toLowerCase();
      if(hint&&hint!=="vigilant"){
        a.field_other_provider_units++;
        a.other_provider_field_units.push(String(t.source_label||t.unit_tag));
      }else if(f==="Spotter"&&!hint){
        a.field_unresolved_provider_units++;
        a.unresolved_provider_field_units.push(String(t.source_label||t.unit_tag));
      }else{
        a.missing_field_units.push(String(t.source_label||t.unit_tag));
      }
    }
  }
  const {data:intRow}=await db.from("camera_integrations").select("metadata").eq("provider","vigilant").maybeSingle();
  await db.from("camera_integrations").upsert({
    provider:"vigilant",server_host:base.replace(/^https?:\/\//,""),server_port:443,enabled:true,
    last_sync_at:now,last_sync_status:failures.length||!accountInventoryComplete?"partial":"ok",
    last_error:failures.length?(failures.length+" lookup failures; affected observations were left unchanged."):(accountInventoryComplete?null:"Full inventory unavailable: "+accountInventoryError),
    metadata:{...(intRow?.metadata||{}),source:"star4live",account_inventory_complete:accountInventoryComplete,account_inventory_error:accountInventoryError,account_online:all.filter(v=>Number(v.status)===1).length,account_offline:all.filter(v=>Number(v.status)!==1).length,inventory_scope:accountInventoryComplete?"account":"tracker_search",tracker_queries:queries.length,successful_queries:queries.length-failures.length,failed_queries:failures.length,failed_query_tags:failures.slice(0,25).map(x=>x.q),provider_resources_found:all.length,matched,unmatched,unmatched_resources:unmatchedResources,online,offline,by_profile:profOut,tracker_by_family:trackerByFamily,tracker_live_coverage:trackerLiveCoverage,reconciled_at:now}
  },{onConflict:"provider"});
  return {account_inventory_complete:accountInventoryComplete,account_inventory_error:accountInventoryError,account_online:all.filter(v=>Number(v.status)===1).length,account_offline:all.filter(v=>Number(v.status)!==1).length,inventory_scope:accountInventoryComplete?"account":"tracker_search",server:base.replace(/^https?:\/\//,""),tracker_queries:queries.length,successful_queries:queries.length-failures.length,failed_queries:failures.length,provider_resources_found:all.length,matched,unmatched,unmatched_resources:unmatchedResources,online,offline,by_profile:profOut,tracker_by_family:trackerByFamily,tracker_live_coverage:trackerLiveCoverage};
}
async function reconInventory(db:any){
  const {data:secretRows,error:secretError}=await db.rpc("get_reconeyez_integration_secrets");
  if(secretError)throw new Error("Reconeyez credentials could not be read");
  const secret=Array.isArray(secretRows)?secretRows[0]:secretRows;
  const username=String(secret?.username||""),password=String(secret?.password||""),host=String(secret?.server_host||"na.reconeyez.com"),port=Number(secret?.server_port||9028);
  if(!username||!password)throw new Error("Reconeyez has not been connected");
  const auth="Basic "+btoa(`${username}:${password}`);
  const res=await fetch(`https://${host}:${port}/control/v1/get_device_list`,{headers:{Authorization:auth,Accept:"application/json","User-Agent":"CamerasOnsite-CameraHealth/1.0"}});
  const txt=await res.text();if(!res.ok)throw new Error(`Reconeyez HTTP ${res.status}`);
  const list=JSON.parse(txt);if(!Array.isArray(list))throw new Error("Reconeyez device list was not an array");
  const detectors=list.filter((d:any)=>String(d?.type||"").toLowerCase().startsWith("detector"));
  const {data:locals}=await db.from("camera_devices").select("id,external_device_id,device_serial,activation_state,organization,unit_key").eq("source","reconeyez");
  const ids=new Set((locals||[]).flatMap((d:any)=>[String(d.external_device_id||""),String(d.device_serial||"").replace(/^reconeyez:/,"")]).filter(Boolean));
  const active=(locals||[]).filter((d:any)=>String(d.activation_state||"").toLowerCase()!=="deactivated").length;
  const shop=(locals||[]).length-active;
  const matched=detectors.filter((d:any)=>ids.has(String(d.guid||""))).length;
  const {data:reconTracker,error:reconTrackerError}=await db.from("equipment_master")
    .select("canonical_family,unit_tag,source_label,tracker_state")
    .in("canonical_family",["Recon","Recon 2"]);
  if(reconTrackerError)throw reconTrackerError;
  const reconTrackerKey=(family:string,tag:any)=>String(family).toLowerCase()+"|"+String(tag||"").padStart(3,"0");
  const localTrackerUnits=new Set<string>();
  for(const d of locals||[]){
    const u=String(d.unit_key||"").toUpperCase();
    let m=u.match(/^RII[-\s]*(\d{3})/);
    if(m){localTrackerUnits.add(reconTrackerKey("Recon 2",m[1]));continue}
    m=u.match(/^RI[-\s]*(\d{3})/);
    if(m)localTrackerUnits.add(reconTrackerKey("Recon",m[1]));
  }
  const trackerCoverage:any={};
  for(const t of reconTracker||[]){
    const family=String(t.canonical_family),state=String(t.tracker_state||"field_or_unknown");
    trackerCoverage[family]??={tracker_total:0,field_or_unknown:0,shop:0,retired:0,matched_local_units:0,missing_local_units:0,missing_field_units:[] as string[],local_unit_namespace:family==="Recon 2"?"RII":"RI",namespace_inventory_present:family==="Recon 2"?[...localTrackerUnits].some(k=>k.startsWith("recon 2|")):[...localTrackerUnits].some(k=>k.startsWith("recon|"))};
    const a=trackerCoverage[family];a.tracker_total++;a[state]=(a[state]||0)+1;
    const hit=localTrackerUnits.has(reconTrackerKey(family,t.unit_tag));
    if(hit)a.matched_local_units++;else{a.missing_local_units++;if(state==="field_or_unknown")a.missing_field_units.push(String(t.source_label||t.unit_tag))}
  }
  const now=new Date().toISOString();
  const {data:intRow}=await db.from("camera_integrations").select("metadata").eq("provider","reconeyez").maybeSingle();
  await db.from("camera_integrations").upsert({provider:"reconeyez",server_host:host,server_port:port,enabled:true,last_sync_at:now,last_sync_status:"ok",last_error:null,metadata:{...(intRow?.metadata||{}),last_inventory_count:list.length,last_detector_count:detectors.length,matched_local_detectors:matched,unmatched_provider_detectors:Math.max(0,detectors.length-matched),local_active:active,local_shop:shop,tracker_coverage:trackerCoverage,reconciled_at:now}},{onConflict:"provider"});
  return {server:host+":"+port,inventory_total:list.length,detectors:detectors.length,matched_local_detectors:matched,unmatched_provider_detectors:Math.max(0,detectors.length-matched),local_active:active,local_shop:shop,tracker_coverage:trackerCoverage};
}
async function avigilonInventory(db:any){
  const {data:master,error:me}=await db.from("equipment_master").select("canonical_family,unit_tag,source_label,tracker_state").in("canonical_family",["CAMV","Sniper","Sniper 2","Sniper 4"]);
  if(me)throw me;
  const {data:devices,error:de}=await db.from("camera_devices").select("id,unit_key,device_name,public_ip,expected_ports,monitoring_profile,activation_state,organization,last_health_checked_at").in("monitoring_profile",["sniper","camv"]);
  if(de)throw de;
  const byKey=new Map<string,any>();for(const d of devices||[])byKey.set(norm(d.unit_key),d);
  const rows=(master||[]).map((m:any)=>({m,key:trackerKey(m.canonical_family,m.unit_tag),d:byKey.get(trackerKey(m.canonical_family,m.unit_tag))||null}));
  const scan=rows.filter((x:any)=>String(x.m?.tracker_state||"")==="field_or_unknown"&&x.d?.public_ip);
  const results=await mapLimit(scan,10,async(x:any)=>{
    const d=x.d,profile=String(d.monitoring_profile||"").toLowerCase();
    const configured=(d.expected_ports||[]).map(Number).filter((n:number)=>n>0);
    const ports=[80,443,8443,38880,38881];
    const host=String(d.public_ip).replace("/32","");
    const ps=Object.fromEntries(await Promise.all([...new Set(ports)].map(async p=>[p,await tcp(host,p)])));
    const reachable=Object.values(ps).some((v:any)=>v.online===true);
    const checked=new Date().toISOString();
    const prev=(await db.from("camera_health_current").select("overall_status,consecutive_failures,first_failed_at").eq("camera_device_id",d.id).maybeSingle()).data;
    const status=reachable?"online":"offline";
    const failures=reachable?0:Math.min(3,Number((prev as any)?.consecutive_failures||0)+1);
    const wasFailed=!!prev&&String((prev as any).overall_status||"")!=="online";
    const patch:any={camera_device_id:d.id,overall_status:status,ip_reachable:reachable,port_status:ps,checked_at:checked,consecutive_failures:failures,first_failed_at:reachable?null:((prev as any)?.first_failed_at||checked),confirmed_outage:!reachable&&failures>=3,confirmation_reason:(!reachable&&failures>=3)?"3+ consecutive failed health checks":null,detail:profile==="sniper"?(reachable?"Avigilon / Sniper responded on approved service port":"No approved Avigilon / Sniper service port responded"):(reachable?"CAM V responded on approved Avigilon service port":"No approved CAM V / Avigilon service port responded")};
    if(reachable&&wasFailed)patch.last_recovered_at=checked;
    if(reachable){patch.acknowledged_at=null;patch.acknowledged_by=null}
    await db.from("camera_health_current").upsert(patch,{onConflict:"camera_device_id"});
    await db.from("camera_devices").update({last_health_checked_at:checked,...(reachable?{last_probe_online_at:checked}:{})}).eq("id",d.id);
    return {family:x.m.canonical_family,tracker_state:x.m.tracker_state,unit:x.m.source_label,status,host,profile};
  });
  const agg:any={};for(const x of rows){const f=x.m.canonical_family;agg[f]??={tracker_total:0,field_or_unknown:0,shop:0,retired:0,matched:0,with_ip:0,scanned:0,online:0,offline:0,unresolved_field_units:[] as string[],local_placement_conflicts:[] as string[]};const a=agg[f];a.tracker_total++;a[x.m.tracker_state]=(a[x.m.tracker_state]||0)+1;if(x.d)a.matched++;if(x.d?.public_ip)a.with_ip++;if(String(x.m.tracker_state||"")==="field_or_unknown"){if(!x.d||!x.d.public_ip)a.unresolved_field_units.push(String(x.m.source_label||x.m.unit_tag));if(x.d&&(String(x.d.activation_state||"").toLowerCase()==="deactivated"||String(x.d.organization||"").trim().toLowerCase()==="root"))a.local_placement_conflicts.push(String(x.m.source_label||x.m.unit_tag))}}
  for(const r of results){const a=agg[r.family];a.scanned++;r.status==="online"?a.online++:a.offline++}
  const now=new Date().toISOString();
  const {data:intRow}=await db.from("camera_integrations").select("metadata").eq("provider","avigilon").maybeSingle();
  await db.from("camera_integrations").upsert({provider:"avigilon",server_host:"tracker-direct-health",server_port:null,enabled:true,last_sync_at:now,last_sync_status:"ok",last_error:null,metadata:{...(intRow?.metadata||{}),source:"tracker_direct_ports",by_family:agg,scanned:results.length,reconciled_at:now}},{onConflict:"provider"});
  return {by_family:agg,scanned:results.length,results};
}

const WITNESS_PORTS=[80,81,443,1400,1443,1454,1500,1543,1554,1600,1643,1654,1700,1743,1754,1900,1943,1954];
async function witnessInventory(db:any){
  const {data:master,error}=await db.from("equipment_master")
    .select("canonical_family,unit_tag,source_label,tracker_state,health_provider,tracker_public_ip")
    .eq("canonical_family","Spotter")
    .eq("tracker_state","field_or_unknown")
    .ilike("health_provider","witness");
  if(error)throw error;
  const rows=master||[];
  const now=new Date().toISOString();
  const {data:intRow}=await db.from("camera_integrations").select("metadata").eq("provider","witness").maybeSingle();
  const previousUnits=intRow?.metadata?.units||{};
  const scan=rows.filter((x:any)=>!!x.tracker_public_ip);
  const probed=await mapLimit(scan,6,async(x:any)=>{
    const host=String(x.tracker_public_ip||"").replace("/32","");
    const ps=Object.fromEntries(await Promise.all(WITNESS_PORTS.map(async p=>[p,await tcp(host,p,1800)])));
    const reachable=Object.values(ps).some((v:any)=>v.online===true);
    const key=vigilantTrackerKey("Spotter",x.unit_tag);
    const prev=previousUnits[key]||{};
    const failures=reachable?0:Math.min(3,Number(prev.consecutive_failures||0)+1);
    // ONLINE requires this run's direct approved-port response. OFFLINE is only
    // authoritative after 3 consecutive failed reconciliation probes.
    const status=reachable?"online":(failures>=3?"offline":"verifying");
    return {key,unit:String(x.source_label||x.unit_tag),unit_tag:String(x.unit_tag||""),status,reachable,consecutive_failures:failures,confirmed_outage:!reachable&&failures>=3,checked_at:now,tracker_public_ip:host,ports:ps};
  });
  const units:any={};
  for(const r of probed)units[r.key]=r;
  for(const x of rows.filter((x:any)=>!x.tracker_public_ip)){
    const key=vigilantTrackerKey("Spotter",x.unit_tag);
    units[key]={key,unit:String(x.source_label||x.unit_tag),unit_tag:String(x.unit_tag||""),status:"unresolved",reachable:null,consecutive_failures:0,confirmed_outage:false,checked_at:now,tracker_public_ip:null,ports:{},reason:"No tracker public IP; no live status inferred"};
  }
  const summary={tracker_field_total:rows.length,with_tracker_ip:scan.length,scanned:probed.length,online:probed.filter((x:any)=>x.status==="online").length,offline:probed.filter((x:any)=>x.status==="offline").length,verifying:probed.filter((x:any)=>x.status==="verifying").length,unresolved:rows.length-probed.length,unresolved_units:rows.filter((x:any)=>!x.tracker_public_ip).map((x:any)=>String(x.source_label||x.unit_tag))};
  await db.from("camera_integrations").upsert({
    provider:"witness",server_host:"tracker-direct-health",server_port:null,enabled:true,last_sync_at:now,last_sync_status:"ok",last_error:null,
    metadata:{...(intRow?.metadata||{}),source:"tracker_direct_alibi_ports",approved_ports:WITNESS_PORTS,offline_confirmation_failures:3,summary,units,reconciled_at:now}
  },{onConflict:"provider"});
  return {summary,results:probed.map(({ports,...x}:any)=>x)};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"POST required"},405);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:valid}=await db.rpc("verify_camera_health_cron_secret",{candidate:req.headers.get("x-camera-cron-secret")});
  if(valid!==true){
    const bearer=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    if(!bearer)return json({error:"Forbidden"},403);
    const {data:auth,error:authError}=await db.auth.getUser(bearer);
    if(authError||!auth?.user)return json({error:"Forbidden"},403);
    const {data:profile}=await db.from("profiles").select("role,active").eq("user_id",auth.user.id).maybeSingle();
    if(!profile?.active||!["owner","it"].includes(String(profile.role).toLowerCase()))return json({error:"Forbidden"},403);
  }
  const body=await req.json().catch(()=>({}));
  const mode=String(body.mode||"all").toLowerCase();
  try{
    const result:any={ok:true,reconciled_at:new Date().toISOString()};
    if(mode==="all"||mode==="vigilant")result.vigilant=await starInventory(db);
    if(mode==="all"||mode==="reconeyez"||mode==="recon")result.reconeyez=await reconInventory(db);
    if(mode==="all"||mode==="avigilon"||mode==="direct")result.avigilon=await avigilonInventory(db);
    if(mode==="all"||mode==="witness")result.witness=await witnessInventory(db);
    return json(result);
  }catch(e){console.error("RECONCILE_FAILURE",e);return json({ok:false,error:String((e as any)?.message||e)},500)}
});