import { resolveStarResources } from "./star-resource-identity.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { crypto } from "jsr:@std/crypto@1";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
async function md5(s:string){return hex(await crypto.subtle.digest("MD5",new TextEncoder().encode(s)))}
async function loginPassword(p:string){const h=await md5(p);return await md5(h+h.slice(0,8))}
async function post(url:string,data:any,token?:string){const h:any={"content-type":"application/json;charset=UTF-8","accept":"application/json"};if(token)h.authorization=token;const r=await fetch(url,{method:"POST",headers:h,body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(`Star4Live HTTP ${r.status}: ${j?.message||j?.msg||"request failed"}`);const code=j?.code;if(code!==undefined&&code!==null&&!([0,200,"0","200"].includes(code)))throw new Error(`Star4Live code ${code}: ${j?.message||j?.msg||"request failed"}`);return j}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const body=await req.json().catch(()=>({}));
  const targetDeviceId=Number(body?.device_id||0);
  const targetUnitKey=String(body?.unit_key||"").trim();
  const username=Deno.env.get("vigilant_username")||Deno.env.get("VIGILANT_USERNAME"),password=Deno.env.get("vigilant_password")||Deno.env.get("VIGILANT_PASSWORD");
  if(!username||!password)throw new Error("Vigilant secrets are not configured");
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const discovery=await post("https://www.star4live.com/openapi/user/account/server/getbyloginname",{loginName:username});
  const host=discovery?.data?.serverHost||discovery?.data?.server||discovery?.data?.host||"os.star4live.com";
  const base=host.startsWith("http")?host:`https://${host}`;
  const pwd=await loginPassword(password);
  const hardId=await md5(navigator.userAgent)+navigator.userAgent;
  const tok=await post(`${base}/openapi/user/account/token/get`,{clientId:"",clientName:"ucs-bs",hardId,password:pwd,passwordVersion:1,platform:navigator.platform||"Supabase Edge",username});
  const token=tok?.data?.token||tok?.data?.accessToken||tok?.data?.authorization;
  if(!token)throw new Error("Star4Live login succeeded but no token was returned");
  const {data:devices,error}=await sb.from("camera_devices").select("id,device_name,device_serial,external_device_id,monitoring_profile,organization,unit_key,source_metadata").in("monitoring_profile",["helios","nvr","ranger","solar_spotter","spotter"]);
  if(error)throw error;
  let selected=devices||[];
  if(targetDeviceId){const hit=selected.find((d:any)=>Number(d.id)===targetDeviceId);if(hit)selected=selected.filter((d:any)=>String(d.unit_key||"").toLowerCase()===String(hit.unit_key||"").toLowerCase());else selected=[]}
  else if(targetUnitKey){selected=selected.filter((d:any)=>String(d.unit_key||"").toLowerCase()===targetUnitKey.toLowerCase())}
  let updated=0,online=0,offline=0,unknown=0;
  const groups=new Map<string,any[]>();
  for(const d of selected){const m=String(d.device_name||"").match(/\d+/);if(!m)continue;const k=m[0];if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(d)}
  const resources:any[]=[];
  for(const [q] of groups){
   const res=await post(`${base}/openapi/user/organization/sub/resource/list`,{organizationId:"283838",deviceName:q,pageSize:100,pageStart:0,agentStr:0,userMode:0},token);
   if(!Array.isArray(res?.data?.resourceList))throw new Error("Star4Live returned no resource list");
   resources.push(...res.data.resourceList);
  }
  // Fetch first, then resolve the entire response against all known owners.
  // Target selection limits writes, never the ownership conflict check.
  const resolution=resolveStarResources(resources,devices||[]),selectedIds=new Set(selected.map((d:any)=>d.id));
  const conflicts=resolution.conflicts.filter((row:any)=>selectedIds.has(row.device.id));
  const identityConflicts=conflicts.map((row:any)=>({camera_device_id:row.device.id,reasons:row.reasons,resources:row.resources}));
  const now=new Date().toISOString();
  for(const conflict of conflicts){
   const {error:writeError}=await sb.from("camera_devices").update({vigilant_status:"Unknown",source_status:"unknown",source_last_seen_at:now,source_metadata:{provider:"vigilant_star4live",syncedAt:now,identityStatus:"conflict",identityReasons:conflict.reasons,conflictingResources:conflict.resources}}).eq("id",conflict.device.id);
   if(writeError)throw new Error("Star4Live identity conflict write failed: "+writeError.message);
   updated++;unknown++;
  }
  for(const match of resolution.matches){
   const d=match.device,v=match.resource,sourceStatus=match.status;
   if(!selectedIds.has(d.id))continue;
   const isOnline=sourceStatus==="online";if(isOnline)online++;else if(sourceStatus==="offline")offline++;else unknown++;
   const {error:writeError}=await sb.from("camera_devices").update({vigilant_status:isOnline?"Online":sourceStatus==="offline"?"Offline":"Unknown",source_status:sourceStatus,source_last_seen_at:now,last_online_at:isOnline?now:undefined,source_metadata:{provider:"vigilant_star4live",status:v.status??null,latestOnline:v.latestOnline,identityStatus:"verified",matchedBy:match.matchedBy,resourceSerial:String(v.deviceSerial||""),resourceName:String(v.deviceName||""),...(sourceStatus==="unknown"?{statusReason:"unrecognized_provider_status"}:{}),publicIp:v.publicIp,localIp:v.localIp,deviceModel:v.deviceModel,organizationName:v.organizationName||v.orgName||v.organization||v.parentOrganizationName||null,organizationId:v.organizationId||v.orgId||null,syncedAt:now}}).eq("id",d.id);
   if(writeError)throw new Error("Star4Live device status write failed: "+writeError.message);
   // Preserve existing definite-status legacy behavior. Ambiguous observations
   // never overwrite direct health or manufacture a historical outage/success.
   if(sourceStatus!=="unknown"){
    await sb.from("camera_health_current").upsert({camera_device_id:d.id,overall_status:sourceStatus,ip_reachable:isOnline,checked_at:now,consecutive_failures:isOnline?0:1,first_failed_at:isOnline?null:now,detail:`Vigilant Control Center live API reports ${sourceStatus.toUpperCase()}`},{onConflict:"camera_device_id"});
    await sb.from("camera_health_history").insert({camera_device_id:d.id,observed_at:now,status:sourceStatus,check_source:"vigilant_star4live",detail:{deviceName:v.deviceName,deviceSerial:v.deviceSerial,status:v.status,latestOnline:v.latestOnline,organizationName:v.organizationName||v.orgName||v.organization||v.parentOrganizationName||null,organizationId:v.organizationId||v.orgId||null}});
   }
   updated++;
  }
  const {data:intRow}=await sb.from("camera_integrations").select("metadata").eq("provider","vigilant").maybeSingle();
  await sb.from("camera_integrations").upsert({provider:"vigilant",server_host:base.replace(/^https?:\/\//,""),server_port:443,enabled:true,last_sync_at:now,last_sync_status:"ok",last_error:null,metadata:{...(intRow?.metadata||{}),source:"star4live",updated,online,offline,unknown,vigilant_sync_identity_conflicts:identityConflicts,vigilant_sync_at:now}},{onConflict:"provider"});
  return new Response(JSON.stringify({ok:true,updated,online,offline,unknown,identity_conflicts:identityConflicts,synced_at:now,targeted:Boolean(targetDeviceId||targetUnitKey),unit_key:targetUnitKey||null,device_id:targetDeviceId||null}),{headers:cors});
 }catch(e){
  const message=e instanceof Error?e.message:String(e);
  console.error("SYNC_FAILURE", message);
  return new Response(JSON.stringify({ok:false,error:message}),{status:500,headers:cors});
 }
});