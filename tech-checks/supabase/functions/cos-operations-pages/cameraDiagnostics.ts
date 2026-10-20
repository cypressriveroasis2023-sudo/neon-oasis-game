import {savedCameraConnection} from './cameraEvidence.ts';
export class CameraDiagnosticError extends Error { constructor(message:string,public status=503){super(message);} }
export type CameraDiagnosticResult={deviceId:number;unitKey:string;publicIp:string;mode:'quick'|'ports';checkedAt:string;ports:{port:number;reachable:boolean;latencyMs:number|null}[]};
function deny(message:string,status=503):never{throw new CameraDiagnosticError(message,status);}
/** Only the authenticated user's saved device can be checked. Browser targets are comparison guards, never probe input. */
export async function checkSavedCamera(input:{id:string;body:any;headers:Record<string,string>;fetcher:typeof fetch;signal?:AbortSignal}):Promise<CameraDiagnosticResult>{
 const {id,body,headers,fetcher}=input;
 if(!/^[1-9]\d{0,14}$/.test(id)||!Number.isSafeInteger(Number(id)))deny('Invalid camera record.',400);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='mode,ports,publicIp,unitKey'||!['quick','ports'].includes(body.mode)||typeof body.unitKey!=='string'||body.unitKey.length>250||typeof body.publicIp!=='string'||!Array.isArray(body.ports)||body.ports.length>128||body.ports.some((p:unknown)=>!Number.isInteger(p)||Number(p)<1||Number(p)>65535))deny('Use the saved camera connection.',400);
 const controller=new AbortController(),cancel=()=>controller.abort();input.signal?.addEventListener('abort',cancel,{once:true});if(input.signal?.aborted)cancel();
 const timer=setTimeout(cancel,25000),base='https://goqrnolcvqnirjmzaeyk.supabase.co';
 try{
  const saved=await fetcher(base+'/rest/v1/camera_devices?id=eq.'+id+'&select=id,unit_key,public_ip,expected_ports,monitoring_enabled',{headers,signal:controller.signal});
  if(!saved.ok)deny('The saved camera connection could not be verified.',[401,403].includes(saved.status)?saved.status:503);
  const rows=await saved.json();if(!Array.isArray(rows)||rows.length!==1)deny('This camera record is unavailable. Refresh the unit.',409);
  const device=rows[0],connection=savedCameraConnection(device.public_ip,device.expected_ports);
  if(!connection||device.monitoring_enabled===false)deny('This camera has no enabled public connection to check.',409);
  if(device.unit_key!==body.unitKey||connection.publicIp!==body.publicIp||JSON.stringify(connection.ports)!==JSON.stringify([...new Set(body.ports)].sort((a:any,b:any)=>a-b)))deny('The saved connection changed. Refresh this unit before checking it.',409);
  const response=await fetcher(base+'/functions/v1/camera-health-check',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({device_id:Number(id),fast_verify:body.mode==='quick',skip_provider_sync:true}),signal:controller.signal});
  if(!response.ok)deny(response.status===409?'The camera configuration changed or cannot be checked. Refresh this unit.':'The connection check could not be completed. No new result is confirmed.',[401,403,409].includes(response.status)?response.status:503);
  const value=await response.json();
  if(value.device_id!==Number(id)||value.public_ip_used!==connection.publicIp||typeof value.checked_at!=='string'||!Number.isFinite(Date.parse(value.checked_at))||!value.ports||typeof value.ports!=='object')deny('No valid connection result was returned.');
  const ports=Object.entries(value.ports).map(([key,v]:[string,any])=>({port:Number(key),reachable:v?.online,latencyMs:typeof v?.latency_ms==='number'&&Number.isFinite(v.latency_ms)&&v.latency_ms>=0?v.latency_ms:null}));
  if(!ports.length||ports.length>128||ports.some(p=>!Number.isInteger(p.port)||p.port<1||p.port>65535||typeof p.reachable!=='boolean'||connection.ports.length>0&&!connection.ports.includes(p.port)))deny('No valid connection result was returned.');
  return {deviceId:Number(id),unitKey:device.unit_key,publicIp:connection.publicIp,mode:body.mode,checkedAt:value.checked_at,ports};
 }catch(error){if(error instanceof CameraDiagnosticError)throw error;return deny('The connection check could not be completed. No new result is confirmed.');}
 finally{clearTimeout(timer);input.signal?.removeEventListener('abort',cancel);}
}
