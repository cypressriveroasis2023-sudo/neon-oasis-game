import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json"}});
const SNIPER_PORTS=[80,443,8443,38880,38881];
const VIGILANT_PORTS=[80,81,443,1400,1443,1454,1500,1543,1554,1600,1643,1654,1700,1743,1754,1900,1943,1954];
const VIGILANT_PROFILES=new Set(["helios","nvr","ranger","solar_spotter","spotter"]);

async function tcp(host:string,port:number,timeout=2200){
  const t=Date.now();let c:any;
  try{
    c=await Promise.race([
      Deno.connect({hostname:host,port}),
      new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),timeout))
    ]) as any;
    c.close();
    return {online:true,latency_ms:Date.now()-t};
  }catch(e){
    try{c?.close()}catch{}
    return {online:false,latency_ms:null,error:String((e as any)?.message||e)};
  }
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);

  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:valid}=await db.rpc("verify_camera_health_cron_secret",{candidate:req.headers.get("x-camera-cron-secret")});
  if(valid!==true)return json({error:"Forbidden"},403);

  const body=await req.json().catch(()=>({}));
  const n=Math.min(Math.max(Number(body.batch_size)||12,1),25);

  const {data:devices,error}=await db.from("camera_devices")
    .select("id,unit_key,device_name,device_model,device_type,tech_check_unit_type,public_ip,expected_ports,monitoring_profile,last_health_checked_at,last_probe_online_at,activation_state,organization,vigilant_status")
    .eq("monitoring_enabled",true)
    .order("last_health_checked_at",{ascending:true,nullsFirst:true})
    .limit(1000);
  if(error)return json({error:error.message},500);

  const {data:routerMappings}=await db.from("camera_unit_routers")
    .select("id,unit_key,router_name,router_model,router_public_ip,unit_ip,web_port,web_protocol,reported_status,reported_latency_ms,status_source,status_observed_at,current_status,last_checked_at,last_online_at")
    .or("router_public_ip.not.is.null,unit_ip.not.is.null");
  // Router health must stay fresh. Recheck every 5 minutes; UI can expire older evidence.
  const routerProbeIntervalMs=5*60*1000;
  const routerDueBefore=Date.now()-routerProbeIntervalMs;
  const routers=[...(routerMappings||[])]
    .filter((r:any)=>!r.last_checked_at||new Date(r.last_checked_at).getTime()<=routerDueBefore)
    .sort((a:any,b:any)=>{
      const at=a.last_checked_at?new Date(a.last_checked_at).getTime():0;
      const bt=b.last_checked_at?new Date(b.last_checked_at).getTime():0;
      return at-bt;
    }).slice(0,n);

  const routerResults=await Promise.all(routers.map(async(r:any)=>{
    const host=String(r.router_public_ip||r.unit_ip||"").replace("/32","");
    // Router health is authoritative only on its configured management port (InHand standard: 8080).
    // Do not let camera/NVR services on the same public IP manufacture router ONLINE.
    const ports=[Number(r.web_port||8080)].filter((x:number)=>x>0);
    const probes=host?Object.fromEntries(await Promise.all(ports.map(async(p:number)=>[p,await tcp(host,p)]))):{};
    const responding=Object.entries(probes).filter(([,v]:any)=>v?.online);
    const directOnline=responding.length>0;
    const reportedOnline=String(r.reported_status||"").toLowerCase()==="online"&&!!r.status_observed_at&&(Date.now()-new Date(r.status_observed_at).getTime())<5*60*1000;
    // Router ONLINE requires a successful live probe. Reported/cached state is context only.
    const status=directOnline?"online":"offline";
    const checked=new Date().toISOString();
    const bestLatency=responding.length?Math.min(...responding.map(([,v]:any)=>Number(v.latency_ms||999999))):null;
    const previousStatus=String(r.current_status||"").toLowerCase();
    const statusChanged=previousStatus!==status;
    const previousLatency=r.reported_latency_ms==null?null:Number(r.reported_latency_ms);
    const latencyChanged=directOnline&&(previousLatency==null||bestLatency==null||Math.abs(previousLatency-bestLatency)>=250);
    const heartbeatDue=!r.last_checked_at||(Date.now()-new Date(r.last_checked_at).getTime())>=routerProbeIntervalMs;
    if(statusChanged||latencyChanged||heartbeatDue){
      const patch:any={current_status:status,last_checked_at:checked,updated_at:checked};
      if(status==="online"&&(statusChanged||!r.last_online_at))patch.last_online_at=checked;
      if(latencyChanged)patch.reported_latency_ms=bestLatency;
      await db.from("camera_unit_routers").update(patch).eq("id",r.id);
    }
    return{id:r.id,unit:r.unit_key,name:r.router_name,model:r.router_model,status,direct_online:directOnline,reported_status:r.reported_status,ports:probes,latency_ms:bestLatency};
  }));

  const routerByUnit=new Map<string,any>();
  for(const r of (routerMappings||[])){const k=String(r.unit_key||"").trim().toLowerCase();if(k&&!routerByUnit.has(k))routerByUnit.set(k,r)}
  const normUnit=(s:any)=>String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
  const DIRECT_PROFILES=new Set(["sniper","camv"]);
  const checkable=(devices||[]).filter((d:any)=>{
    const profile=String(d.monitoring_profile||"").toLowerCase();
    const org=String(d.organization||"").trim().toLowerCase(),unit=String(d.unit_key||"").toLowerCase();
    const shop=String(d.activation_state||"").toLowerCase()==="deactivated"||["root","shop","shop equipment","retired"].includes(org)||[org,unit].some(x=>/not in use|stolen|\\s*-\\s*shop\\b/.test(x));
    const host=d.public_ip||routerByUnit.get(String(d.unit_key||"").trim().toLowerCase())?.router_public_ip||routerByUnit.get(String(d.unit_key||"").trim().toLowerCase())?.unit_ip;
    return DIRECT_PROFILES.has(profile)&&!shop&&!!host;
  });
  // Reuse identical host+port probe sets within this sweep. Multiple camera rows on
  // one Helios/Alibi unit often share the same public IP, so they should not open
  // the same TCP connections repeatedly in the same run.
  const probeCache=new Map<string,Promise<any>>();
  const probePorts=(host:string,ports:number[])=>{
    const normalized=[...new Set(ports.map(Number).filter((p:number)=>p>0))].sort((a,b)=>a-b);
    const key=host+"|"+normalized.join(",");
    if(!probeCache.has(key)){
      probeCache.set(key,Promise.all(normalized.map(async(p:number)=>[p,await tcp(host,p)])).then(entries=>Object.fromEntries(entries)));
    }
    return probeCache.get(key)!;
  };

  const checkableIds=checkable.map((d:any)=>d.id);
  const {data:previousHealth,error:previousHealthError}=checkableIds.length
    ? await db.from("camera_health_current")
        .select("camera_device_id,overall_status,consecutive_failures,first_failed_at")
        .in("camera_device_id",checkableIds)
    : {data:[],error:null};
  if(previousHealthError)return json({error:previousHealthError.message},500);
  const previousHealthByDevice=new Map((previousHealth||[]).map((h:any)=>[h.camera_device_id,h]));

  const results=await Promise.all(checkable.map(async(d:any)=>{
    const profile=String(d.monitoring_profile||"").trim().toLowerCase();
    const configured=(d.expected_ports||[]).map(Number);
    const identity=[d.unit_key,d.device_name,d.device_model,d.device_type,d.tech_check_unit_type,profile].join(" ").toLowerCase();
    const avigilon=profile==="sniper"||identity.includes("avigilon")||identity.includes("sniper")||identity.includes("cam v")||identity.includes("camv");
    const basePorts=avigilon?SNIPER_PORTS:(VIGILANT_PROFILES.has(profile)?VIGILANT_PORTS:(configured.length?configured:[80,81,443,8080]));
    const ports=[...new Set(avigilon?[...basePorts,443]:basePorts)];
    const router=routerByUnit.get(String(d.unit_key||"").trim().toLowerCase());
    const host=String(d.public_ip||router?.router_public_ip||router?.unit_ip||"").replace("/32","");
    const ipSource=d.public_ip?"camera":"router";
    const ps=await probePorts(host,ports);
    const ok=Object.values(ps).filter((x:any)=>x.online).length;
    const reachable=ok>0;
    const providerOnline=String(d.vigilant_status||"").toLowerCase()==="online";
    const status=VIGILANT_PROFILES.has(profile)?(reachable&&providerOnline?"online":"offline"):(reachable?"online":"offline");
    const checked=new Date().toISOString();

    const prev=previousHealthByDevice.get(d.id)||null;

    const probeFailed=status!=="online";
    const vigilantOnline=providerOnline;
    const shop=String(d.organization||"").trim().toLowerCase()==="root";
    // Authoritative health: only this sweep's successful live probe can produce ONLINE.
    const effective=status==="online"?"online":((Number(prev?.consecutive_failures)||0)+1>=3?"offline":"verifying");
    const failed=probeFailed;
    const wasFailed=!!prev&&prev.overall_status!=="online";
    const failures=failed?Math.min((Number(prev?.consecutive_failures)||0)+1,3):0;
    const confirmed=failed&&failures>=3;

    const patch:any={
      camera_device_id:d.id,
      overall_status:effective,
      ip_reachable:reachable,
      port_status:ps,
      checked_at:checked,
      consecutive_failures:failures,
      detail:(profile==="sniper"||profile==="camv")
        ? (reachable?(profile==="camv"?"CAM V responding on an approved Avigilon service port":"Sniper responding on an approved Avigilon service port"):(profile==="camv"?"No approved CAM V / Avigilon service ports responded":"No approved Sniper service ports responded"))
        : (VIGILANT_PROFILES.has(profile)
            ? (reachable?"Vigilant / Alibi camera responding on an approved service port":"No approved Vigilant / Alibi service ports responded")
            : (probeFailed&&vigilantOnline?"Live probe FAILED; Vigilant source reports online but cannot override current probe":"Automatic TCP public-port health sweep")),
      confirmed_outage:confirmed,
      confirmation_reason:confirmed?"3+ consecutive failed health checks":null
    };

    if(failed&&!wasFailed)patch.first_failed_at=checked;
    if(effective==="online"){
      patch.first_failed_at=null;
      if(wasFailed)patch.last_recovered_at=checked;
      patch.acknowledged_at=null;
      patch.acknowledged_by=null;
    }

    // camera_health_current is the freshness source used by the UI, so checked_at
    // must advance on EVERY real probe, even when the status did not change.
    // History remains change-only below to avoid noisy event rows.
    const {error:healthError}=await db.from("camera_health_current").upsert(patch);
    if(healthError)throw new Error("Health save failed: "+healthError.message);

    // Health checks update health timestamps only. They must never deploy,
    // reactivate, or otherwise change inventory lifecycle state.
    const probeHeartbeatDue=reachable&&(!d.last_probe_online_at || (Date.now()-new Date(d.last_probe_online_at).getTime())>=6*60*60*1000);
    const schedulePatch:any={last_health_checked_at:checked};
    if(reachable) schedulePatch.last_probe_online_at=checked;
    const {error:deviceError}=await db.from("camera_devices").update(schedulePatch).eq("id",d.id);
    if(deviceError)throw new Error("Health timestamp save failed: "+deviceError.message);

    if(!prev||prev.overall_status!==effective){
      await db.from("camera_health_history").insert({
        camera_device_id:d.id,
        status:effective,
        check_source:"automatic_tcp_sweep",
        detail:{
          previous_status:prev?.overall_status||null,
          monitoring_profile:profile,
          probe_status:status,
          vigilant_status:d.vigilant_status,
          ports:ps,
          activation_state:d.activation_state,
          ip_source:ipSource,
          public_ip_used:host
        }
      });
    }

    return{
      id:d.id,
      name:d.device_name,
      monitoring_profile:profile,
      status:effective,
      probe_status:status,
      vigilant_status:d.vigilant_status,
      confirmed_outage:confirmed,
      activated:false,
      ip_source:ipSource,
      public_ip_used:host
    };
  }));

  // Record the monitor heartbeat only after this sweep reaches successful completion.
  // This is monitor health metadata; it does not alter camera inventory or lifecycle state.
  if(results.length){
    const heartbeat=new Date().toISOString();
    await db.from("camera_integrations").update({
      last_sync_at:heartbeat,
      last_sync_status:"ok",
      last_error:null,
      metadata:{source:"saved_field_direct_ports",scanned:results.length,online:results.filter((x:any)=>x.status==="online").length,offline:results.filter((x:any)=>x.status==="offline").length,verifying:results.filter((x:any)=>x.status==="verifying").length,reconciled_at:heartbeat}
    }).eq("provider","avigilon");
  }

  return json({
    checked:results.length,
    results,
    routers_checked:routerResults.length,
    router_results:routerResults
  });
});
