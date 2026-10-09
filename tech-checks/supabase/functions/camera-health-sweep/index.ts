import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {collectScheduledDirect,boundedRequest} from "../_shared/scheduledDirectService.ts";

const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json"}});
// Only configured public IPv4 hosts may be contacted. No DNS, URL or private-network fallback.
function publicHost(value:unknown):string|null {
 if(typeof value!=="string")return null;const host=value.replace(/\/32$/,""),p=host.split(".");
 if(p.length!==4||p.some(x=>!/^(?:0|[1-9]\d{0,2})$/.test(x)||Number(x)>255))return null;
 const [a,b,c]=p.map(Number);
 if(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113))return null;
 return host;
}

async function tcp(host:string,port:number,timeout=2200){
  if(!publicHost(host)||!Number.isInteger(port)||port<1||port>65535)return {online:false,latency_ms:null,error:"Unsupported public endpoint"};
  const t=Date.now(),controller=new AbortController();let c:any,timer:ReturnType<typeof setTimeout>;
  try{
    const connection=Deno.connect({hostname:host,port,signal:controller.signal}).then(conn=>{
      if(controller.signal.aborted){conn.close();throw new Error("timeout");}return conn;
    });
    c=await Promise.race([connection,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("timeout"));},timeout);})]);
    return {online:true,latency_ms:Date.now()-t};
  }catch(e){
    return {online:false,latency_ms:null,error:controller.signal.aborted?"timeout":String((e as any)?.message||e)};
  }finally{clearTimeout(timer!);try{c?.close()}catch{}}

}

Deno.serve(async(req)=>{
  const requestStarted=Date.now();
  if(req.method!=="POST")return json({error:"POST required"},405);

  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{
    global:{fetch:(input:any,init:any={})=>fetch(input,{...init,signal:AbortSignal.any([
      ...(init.signal?[init.signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(4000,requestStarted+52_000-Date.now())))
    ])})}
  });
  const {data:valid}=await db.rpc("verify_camera_health_cron_secret",{candidate:req.headers.get("x-camera-cron-secret")});
  if(valid!==true)return json({error:"Forbidden"},403);

  const body=await req.json().catch(()=>({}));
  // The existing batch setting bounds concurrency, never fleet coverage.
  const requestedWorkers=Number(body.batch_size);
  const n=Number.isFinite(requestedWorkers)&&requestedWorkers>0?Math.min(Math.max(Math.floor(requestedWorkers),1),25):25;

  // Cameras and the bounded router workers share elapsed time, not a
  // serial budget. Router work cannot consume the camera window first.
  const cameraRun=collectScheduledDirect(db,tcp,{startedAt:requestStarted})
    .then(value=>({value,error:null}),()=>({value:null,error:"Direct inventory unavailable"}));

  const {data:routerMappings,error:routerQueryError}=await db.from("camera_unit_routers")
    .select("id,unit_key,router_name,router_model,router_public_ip,unit_ip,web_port,web_protocol,reported_status,reported_latency_ms,status_source,status_observed_at,current_status,last_checked_at,last_online_at,updated_at")
    .or("router_public_ip.not.is.null,unit_ip.not.is.null");
  const routerReadError=routerQueryError||!Array.isArray(routerMappings)||routerMappings.length>=1000;
  // Router health must stay fresh. Recheck every 5 minutes; UI can expire older evidence.
  const routerProbeIntervalMs=5*60*1000;
  const routerDueBefore=Date.now()-routerProbeIntervalMs;
  const routers=[...(routerReadError?[]:routerMappings)]
    .filter((r:any)=>!r.last_checked_at||!Number.isFinite(Date.parse(r.last_checked_at))||Date.parse(r.last_checked_at)<=routerDueBefore)
    .sort((a:any,b:any)=>{
      const at=a.last_checked_at?new Date(a.last_checked_at).getTime():0;
      const bt=b.last_checked_at?new Date(b.last_checked_at).getTime():0;
      return at-bt;
    });

  const routerCheck=async(r:any)=>{
    const host=String(r.router_public_ip||r.unit_ip||"").replace("/32","");
    if(!publicHost(host))return {id:r.id,unit:r.unit_key,status:"unknown",reason:"unsupported_public_endpoint"};
    // Router health is authoritative only on its configured management port (InHand standard: 8080).
    // Do not let camera/NVR services on the same public IP manufacture router ONLINE.
    const port=Number(r.web_port??8080);
    if(!Number.isInteger(port)||port<1||port>65535)return {id:r.id,unit:r.unit_key,status:"unknown",reason:"unsupported_management_port"};
    const ports=[port];
    const probes=host?Object.fromEntries(await Promise.all(ports.map(async(p:number)=>[p,await tcp(host,p)]))):{};
    if(Date.now()>=requestStarted+48_000)return {id:r.id,unit:r.unit_key,status:"unknown",reason:"router_deadline_reached"};
    const responding=Object.entries(probes).filter(([,v]:any)=>v?.online);
    const directOnline=responding.length>0;
    // Router ONLINE requires a successful live probe. Reported/cached state is context only.
    const status=directOnline?"online":"offline";
    const checked=new Date().toISOString();
    const latencies=responding.map(([,v]:any)=>v.latency_ms).filter((v:any)=>typeof v==="number"&&Number.isFinite(v)&&v>=0);
    const bestLatency=latencies.length?Math.min(...latencies):null;
    const previousStatus=String(r.current_status||"").toLowerCase();
    const statusChanged=previousStatus!==status;
    const previousLatency=r.reported_latency_ms==null?null:Number(r.reported_latency_ms);
    const latencyChanged=directOnline&&bestLatency!==null&&(previousLatency==null||Math.abs(previousLatency-bestLatency)>=250);
    const heartbeatDue=!r.last_checked_at||(Date.now()-new Date(r.last_checked_at).getTime())>=routerProbeIntervalMs;
    if(statusChanged||latencyChanged||heartbeatDue){
      const patch:any={current_status:status,last_checked_at:checked,updated_at:checked};
      if(status==="online"&&(statusChanged||!r.last_online_at))patch.last_online_at=checked;
      if(latencyChanged)patch.reported_latency_ms=bestLatency;
      let routerSave=db.from("camera_unit_routers").update(patch).eq("id",r.id).eq("unit_key",r.unit_key).eq("updated_at",r.updated_at);
      for(const key of ["router_public_ip","unit_ip","web_port"]){routerSave=r[key]==null?routerSave.is(key,null):routerSave.eq(key,r[key]);}
      const {data:savedRouter,error:routerError}=await routerSave.select("id");
      if(routerError)return {id:r.id,unit:r.unit_key,status:"unknown",reason:"router_publication_unverified"};
      if(!savedRouter?.length)return {id:r.id,unit:r.unit_key,status:"unknown",reason:"router_configuration_changed"};
    }
    return{id:r.id,unit:r.unit_key,name:r.router_name,model:r.router_model,status,direct_online:directOnline,reported_status:r.reported_status,ports:probes,latency_ms:bestLatency};
  };
  let routerCursor=0;
  const routerRun=(async()=>{
    const results:any[]=[];
    while(routerCursor<routers.length&&Date.now()+3200<requestStarted+48_000){
      const wave=routers.slice(routerCursor,routerCursor+n);routerCursor+=wave.length;
      results.push(...await Promise.all(wave.map(async(r:any)=>{
        try{return await routerCheck(r);}catch{return {id:r.id,unit:r.unit_key,status:"unknown",reason:"router_observation_unverified"};}
      })));
    }
    return results;
  })().then(value=>({value,error:null}),error=>({value:null,error}));

  const camera=await cameraRun;
  const routerOutcome=await routerRun;
  const routerResults=routerReadError||routerOutcome.error
    ? [{status:"unknown",reason:"router_inventory_unavailable"}]
    : routerOutcome.value!;
  const {results,eligible,held,deferred,deadlineReached}=camera.value||{results:[],eligible:null,held:[],deferred:null,deadlineReached:Date.now()>=requestStarted+48_000};
  const published=results.filter((r:any)=>r.published).length,unverified=results.length-published;
  const reasons:string[]=[];
  if(camera.error)reasons.push("collector_unavailable");
  if(held.length)reasons.push("records_held");
  if(deferred||deadlineReached)reasons.push("deadline_reached");
  if(unverified)reasons.push("observations_unverified");
  const countReasons=(rows:any[])=>rows.reduce((counts:any,row:any)=>{const key=row.reason||"unverified";counts[key]=(counts[key]||0)+1;return counts;},{});
  const heartbeat=new Date().toISOString();
  const routerCoverage={counts_known:!routerReadError&&!routerOutcome.error,total:routerReadError?null:routerMappings?.length??0,
    complete:!routerReadError&&!routerOutcome.error&&routerCursor===routers.length&&routerResults.every((r:any)=>r.status!=="unknown"),
    due:routerReadError?null:routers.length,scanned:routerReadError?null:routerResults.length,
    published:routerReadError?null:routerResults.filter((r:any)=>r.status==="online"||r.status==="offline").length,
    unverified:routerReadError?null:routerResults.filter((r:any)=>r.status==="unknown").length,
    deferred:routerReadError?null:routers.length-routerCursor,reconciled_at:heartbeat};
  const coverage={source:"owned_saved_service_ports",complete:reasons.length===0,reason:reasons[0]||null,reasons,
    counts_known:!camera.error,eligible,held:camera.error?null:held.length,deferred,
    scanned:camera.error?null:results.length,published:camera.error?null:published,unverified:camera.error?null:unverified,
    deadline_reached:deadlineReached,held_reasons:countReasons(held),unverified_reasons:countReasons(results.filter((r:any)=>!r.published)),
    online:camera.error?null:results.filter((r:any)=>r.published&&r.status==="online").length,offline:camera.error?null:results.filter((r:any)=>r.published&&r.status==="offline").length,
    verifying:camera.error?null:results.filter((r:any)=>r.published&&r.status==="verifying").length,reconciled_at:heartbeat,router_coverage:routerCoverage};

  // Persist incomplete coverage too, including zero-publication runs. This is
  // monitor metadata only; no camera result or outage is created by this write.
  let coverageRecorded=false;
  if(Date.now()<requestStarted+50_000){
    try{
      const saved:any=await boundedRequest(signal=>db.from("camera_integrations").update({
        last_sync_at:heartbeat,last_sync_status:coverage.complete?"ok":"partial",
        last_error:coverage.complete?null:"Direct service sweep coverage is incomplete: "+reasons.join(", "),metadata:coverage
      }).eq("provider","avigilon").select("provider").abortSignal(signal),requestStarted+52_000);
      coverageRecorded=!saved.error&&saved.data?.length===1;
    }catch{}
  }
  if(camera.error||!coverageRecorded)return json({error:camera.error||"Sweep coverage could not be recorded",coverage,coverage_recorded:coverageRecorded,routers_checked:routerResults.length,router_results:routerResults},503);

  return json({
    checked:results.length,
    eligible,held:held.length,deferred,deadline_reached:deadlineReached,
    evidence:"service_port_only",
    coverage,coverage_recorded:coverageRecorded,
    results,
    routers_checked:routerResults.length,
    router_results:routerResults
  });
});
