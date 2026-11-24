import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {syncReconInventory} from "./inventorySync.ts";
import {beginReconAttempt,lookupReconAttempt,knownReconAttempt,reconOwnedFingerprint,validateReconFinish,requireReconSuccess,failReconAttempt,assertReconDeadline,RECON_V2_LIMITS,ReconOwnedConflict,ReconOwnedUnknown,ReconSourceFailure,type ReconBegin,type ReconDb,type ReconFinish} from "../_shared/reconOwnedMetadataV2.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

type ReconDevice = {
  guid?: string;
  name?: string;
  area?: string;
  description?: string;
  type?: string;
};

async function getProfile(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userDb = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userDb.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: profile } = await userDb
    .from("profiles")
    .select("user_id,role,active")
    .eq("user_id", user.id)
    .maybeSingle();
  return { user, profile };
}

/** One budget includes headers and the complete response body. Finalization gets a reserve. */
async function fetchReconInventory(host:string,port:number,username:string,password:string,attempt:ReconBegin) {
  assertReconDeadline(attempt,5000);
  const budget=Math.min(RECON_V2_LIMITS.provider_total_seconds*1000,Date.parse(attempt.expires_at)-Date.now()-5000);
  const sourceDeadline=Date.now()+budget;
  if(budget<=0)throw new ReconOwnedConflict(attempt.kind);
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ReconSourceFailure('provider_unavailable'));},budget);});
  try {
    const response=await Promise.race([fetch(`https://${host}:${port}/control/v1/get_device_list`,{method:"GET",signal:controller.signal,
      headers:{Authorization:"Basic "+btoa(`${username}:${password}`),Accept:"application/json","User-Agent":"CamerasOnsite-CameraHealth/1.0"}}),expired]);
    const text=await Promise.race([response.text(),expired]);
    if(controller.signal.aborted||Date.now()>=sourceDeadline)throw new ReconSourceFailure('provider_unavailable');
    if(response.status===206)throw new ReconSourceFailure('partial_inventory');
    if(response.status!==200)throw new ReconSourceFailure(response.status===401||response.status===403?'provider_rejected':'provider_unavailable');
    let parsed:unknown;
    try {parsed=JSON.parse(text);} catch {throw new ReconSourceFailure('invalid_inventory');}
    if(!Array.isArray(parsed))throw new ReconSourceFailure('invalid_inventory');
    if(Date.now()>=sourceDeadline)throw new ReconSourceFailure('provider_unavailable');
    assertReconDeadline(attempt,5000);
    return {list:parsed as Record<string,unknown>[],sourceDeadline};
  } catch(error) {
    if(error instanceof ReconOwnedConflict||error instanceof ReconSourceFailure)throw error;
    throw new ReconSourceFailure('provider_unavailable');
  } finally {if(timer!==undefined)clearTimeout(timer);}
}

async function secrets(db:ReconDb,attempt?:ReconBegin) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  let reply:{data:unknown;error:unknown};
  const budget=attempt?Math.min(5000,Date.parse(attempt.expires_at)-Date.now()-5000):5000;
  if(budget<=0)throw new ReconOwnedConflict(attempt?.kind);
  try {
    reply=await Promise.race([Promise.resolve(db.rpc('get_reconeyez_integration_secrets',{})),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new ReconSourceFailure('source_read_failed')),budget);
    })]);
  } catch {throw new ReconSourceFailure('source_read_failed');}
  finally {if(timer!==undefined)clearTimeout(timer);}
  const {data,error}=reply;
  if(Array.isArray(data)&&data.length!==1)throw new ReconSourceFailure('source_read_failed');
  const value=Array.isArray(data)?data[0]:data;
  if(error||!value||typeof value!=='object'||Array.isArray(value))throw new ReconSourceFailure('source_read_failed');
  const row=value as Record<string,unknown>,keys=['server_host','server_port','username','password','webhook_secret'];
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||typeof row.server_host!=='string'||!row.server_host||
    row.server_port!==null&&(!Number.isInteger(row.server_port)||typeof row.server_port!=='number'||row.server_port<1||row.server_port>65535)||
    ['username','password','webhook_secret'].some(key=>row[key]!==null&&typeof row[key]!=='string'))throw new ReconSourceFailure('source_read_failed');
  return row;
}
function ownedError(error:unknown,kind:'inventory_sync'|'inventory_connect'|'receiver_test') {
  if(error instanceof ReconOwnedConflict)return json({error:error.message,code:error.code},409);
  if(error instanceof ReconSourceFailure)return json({error:error.message},502);
  const uncertain=error instanceof ReconOwnedUnknown?error:new ReconOwnedUnknown(kind);
  return json({error:uncertain.message},502);
}
function receiverBody(attempt:ReconBegin) {
  return {eventType:'IntegrationTest',deviceGuid:'__camera_health_receiver_test__',timestamp:attempt.observed_at,
    source:'Camera Health self-test',cos_receiver_test_v2:{schema_version:2,attempt_id:knownReconAttempt(attempt).attempt_id}};
}
async function receiverSuccess(finish:ReconFinish,attempt:ReconBegin,fingerprint?:string) {
  const expected=fingerprint??await reconOwnedFingerprint({attempt_id:knownReconAttempt(attempt).attempt_id,body:receiverBody(attempt)});
  return requireReconSuccess(validateReconFinish(finish,{attempt,fingerprint:expected}));
}
async function storedReceiverResult(db:ReconDb,attempt:ReconBegin,fingerprint:string):Promise<ReconFinish|null> {
  const state=await lookupReconAttempt(db,attempt);
  if(state.terminal)return validateReconFinish(state.terminal,{attempt,fingerprint,validateResult:result=>{
    if(Date.parse(String(result.receiver_tested_at))<Date.parse(attempt.observed_at)||Date.parse(String(result.receiver_tested_at))>Date.parse(attempt.expires_at))throw new ReconOwnedUnknown('receiver_test');
  }});
  if(['superseded','expired','unknown'].includes(state.state))throw new ReconOwnedConflict('receiver_test');
  return null;
}
async function runReceiverTest(db:ReconDb,attempt:ReconBegin,endpoint:string) {
  const body=receiverBody(attempt),fingerprint=await reconOwnedFingerprint({attempt_id:knownReconAttempt(attempt).attempt_id,body});
  if(attempt.outcome==='duplicate') {
    const prior=await storedReceiverResult(db,attempt,fingerprint);if(prior)return requireReconSuccess(prior);
  }
  for(let delivery=0;delivery<2;delivery++) {
    assertReconDeadline(attempt,5000);
    const budget=Math.min(RECON_V2_LIMITS.receiver_http_seconds*1000,Date.parse(attempt.expires_at)-Date.now()-5000);
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ReconOwnedUnknown('receiver_test'));},budget);});
    let rejected=false;
    try {
      const response=await Promise.race([fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}),expired]);
      await Promise.race([response.text(),expired]);
      rejected=!controller.signal.aborted&&[400,401,403,404,405].includes(response.status);
    } catch { /* Delivery may have committed its authenticated audit/ack: recover before any decision. */ }
    finally {if(timer!==undefined)clearTimeout(timer);}
    const saved=await storedReceiverResult(db,attempt,fingerprint);
    if(saved)return requireReconSuccess(saved);
    if(rejected) {
      const failure=await failReconAttempt(db,attempt,'receiver_rejected');
      if(failure.terminal_outcome==='success')return await receiverSuccess(failure,attempt,fingerprint);
      throw new ReconSourceFailure('receiver_rejected');
    }
  }
  throw new ReconOwnedUnknown('receiver_test');
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const { user, profile } = await getProfile(authHeader);
  if (!user) return json({ error: "Unauthorized" }, 401);
  if (!profile?.active || !["owner", "it"].includes(String(profile.role))) {
    return json({ error: "Camera Health is limited to active Owner / IT accounts." }, 403);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "status").toLowerCase();


  if (action === "status") {
    const {data:integration,error}=await db.from('camera_integrations').select('provider,server_host,server_port,enabled,username_secret_id,password_secret_id,webhook_secret_id,last_sync_at,last_sync_status,last_error,metadata').eq('provider','reconeyez').maybeSingle();
    if(error)return json({error:'Reconeyez status is unavailable.'},502);
    return json({
      provider: "reconeyez",
      server: integration?.server_host || "na.reconeyez.com",
      port: integration?.server_port || 9028,
      configured: Boolean(integration?.username_secret_id && integration?.password_secret_id),
      enabled: Boolean(integration?.enabled),
      webhook_ready: Boolean(integration?.webhook_secret_id),
      last_sync_at: integration?.last_sync_at || null,
      last_sync_status: integration?.last_sync_status || null,
      last_error: integration?.last_error || null,
      receiver_tested_at: integration?.metadata?.receiver_tested_at || null,
      last_webhook_received_at: integration?.metadata?.last_webhook_received_at || null,
      live_event_type: integration?.metadata?.last_webhook_event_type || null
    });
  }

  if (action === "webhook_setup" || action === "test_webhook") {
    if (String(profile.role) !== "owner") return json({ error: "Owner access is required for Reconeyez live-feed setup." }, 403);

    let receiverAttempt:ReconBegin|undefined;
    let secret:Record<string,unknown>;
    try {
      if(action==='test_webhook')receiverAttempt=await beginReconAttempt(db,'receiver_test');
      secret=await secrets(db,receiverAttempt);
    } catch(error) {
      if(receiverAttempt&&error instanceof ReconSourceFailure) {
        try {
          const failed=await failReconAttempt(db,receiverAttempt,error.reason);
          if(failed.terminal_outcome==='success')return json({ok:true,...await receiverSuccess(failed,receiverAttempt)});
        } catch(recoveryError) {return ownedError(recoveryError,'receiver_test');}
      }
      return ownedError(error,'receiver_test');
    }
    const webhookSecret=typeof secret.webhook_secret==='string'?secret.webhook_secret:'';
    if(!webhookSecret) {
      if(receiverAttempt) {
        try {const failed=await failReconAttempt(db,receiverAttempt,'source_read_failed');if(failed.terminal_outcome==='success')return json({ok:true,...await receiverSuccess(failed,receiverAttempt)});}
        catch(error) {return ownedError(error,'receiver_test');}
      }
      return json({error:'Reconeyez webhook receiver is not configured.'},409);
    }
    const base=String(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
    const endpoint=`${base}/functions/v1/reconeyez-webhook?token=${encodeURIComponent(webhookSecret)}`;
    const endpointPath=`/functions/v1/reconeyez-webhook?token=${encodeURIComponent(webhookSecret)}`;
    if(receiverAttempt) {
      try {return json({ok:true,...await runReceiverTest(db,receiverAttempt,endpoint)});}
      catch(error) {return ownedError(error,'receiver_test');}
    }

    const supportRequest = [
      "To: support@reconeyez.com",
      "Subject: JSON Webhook integration setup — Cameras Onsite, LLC (North America)",
      "",
      "Hello Reconeyez Support,",
      "",
      "Please configure a JSON Webhook integration for our Cameras Onsite, LLC workspace on na.reconeyez.com.",
      "",
      `Receiving server: ${new URL(base).host}`,
      "Port: 443",
      "Protocol: JSON Webhook over HTTPS POST",
      `HTTP endpoint path: ${endpointPath}`,
      "Default site identification: 1027",
      "Reconeyez device area: Cameras Onsite Deployed (including its Houston and San Antonio child areas)",
      "Please exclude Shop Equipment / Shop areas from forwarded live alarms and health events.",
      "",
      "We need the supported health/status events forwarded, including ConnectionLost, DeviceConnected, BatteryLow, BatteryRestored, CriticalBatteryShutdown, RoutineCheck, Tamper, Armed and Disarmed.",
      "",
      "Our receiving endpoint is already live and tested. Please let us know when the backend integration has been enabled.",
      "",
      "Thank you,",
      "Cameras Onsite, LLC"
    ].join("\n");

    return json({
      ok: true,
      server: new URL(base).host,
      port: 443,
      endpoint_path: endpointPath,
      support_email: "support@reconeyez.com",
      support_request: supportRequest
    });
  }

  if(action==='connect'||action==='sync') {
    if(action==='connect'&&String(profile.role)!=='owner')return json({error:'Owner access is required to save Reconeyez credentials.'},403);
    const kind=action==='connect'?'inventory_connect':'inventory_sync';
    let attempt:ReconBegin|undefined;
    try {
      // No integration/source/credential read precedes this authorized begin.
      attempt=await beginReconAttempt(db,kind);
      if(attempt.outcome==='duplicate') {
        const previous=await lookupReconAttempt(db,attempt);
        if(previous.terminal)return json({ok:true,...(action==='connect'?{connected:true}:{}),...requireReconSuccess(previous.terminal)});
        if(previous.state!=='pending')throw new ReconOwnedConflict(kind);
      }
      let username:string,password:string,host='na.reconeyez.com',port=9028;
      if(action==='connect') {
        username=typeof body.username==='string'?body.username.trim():'';
        password=typeof body.password==='string'?body.password:'';
        if(!username||!password)throw new ReconSourceFailure('provider_rejected');
      } else {
        const secret=await secrets(db,attempt);
        username=typeof secret.username==='string'?secret.username:'';
        password=typeof secret.password==='string'?secret.password:'';
        host=typeof secret.server_host==='string'&&secret.server_host?secret.server_host:'na.reconeyez.com';
        port=secret.server_port===null?9028:secret.server_port as number;
        if(!username||!password||!Number.isInteger(port)||port<1||port>65535)throw new ReconSourceFailure('source_read_failed');
      }
      const {list,sourceDeadline}=await fetchReconInventory(host,port,username,password,attempt);
      const finish=await syncReconInventory(db,list,attempt,action==='connect'?{username,password}:undefined,sourceDeadline);
      return json({ok:true,...(action==='connect'?{connected:true}:{}),...requireReconSuccess(finish)});
    } catch(error) {
      // Only a definite pre-publication source/validation failure may publish failure.
      // Unknown or malformed publication acknowledgements are recovered inside the adapter.
      if(attempt&&attempt.outcome!=='absent'&&error instanceof ReconSourceFailure) {
        try {
          const failed=await failReconAttempt(db,attempt,error.reason);
          if(failed.terminal_outcome==='success')return json({ok:true,...(action==='connect'?{connected:true}:{}),...requireReconSuccess(failed)});
        } catch(recoveryError) {return ownedError(recoveryError,kind);}
      }
      return ownedError(error,kind);
    }
  }

  return json({ error: "Unknown action" }, 400);
});
