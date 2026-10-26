import {cameraTimestamp,type CameraRow} from './cameraEvidence';
import type {CameraDiagnosticResult} from '../../supabase/functions/cos-operations-pages/cameraDiagnostics';
export type ConnectionCheckState='online'|'offline'|'unknown';
const invalid=()=>{throw new Error('No valid result for this exact saved connection was returned.');};
/** Validate the response boundary, not the TypeScript assertion. No target inference. */
export function readConnectionCheck(value:unknown,device:CameraRow,mode:'quick'|'ports',now=Date.now()):CameraDiagnosticResult{
 const v=value as CameraDiagnosticResult,connection=device.connection;
 if(!v||typeof v!=='object'||Array.isArray(v)||!connection||v.deviceId!==Number(device.id)||v.unitKey!==device.unit||v.publicIp!==connection.publicIp||v.mode!==mode||!cameraTimestamp(v.checkedAt,now).fresh||!Array.isArray(v.ports)||!v.ports.length||v.ports.length>128) return invalid();
 if(new Set(v.ports.map(p=>p?.port)).size!==v.ports.length||v.ports.some(p=>!p||!Number.isInteger(p.port)||p.port<1||p.port>65535||typeof p.reachable!=='boolean'||p.latencyMs!==null&&(!Number.isFinite(p.latencyMs)||p.latencyMs<0)||connection.ports.length>0&&!connection.ports.includes(p.port)))return invalid();
 return {deviceId:v.deviceId,unitKey:v.unitKey,publicIp:v.publicIp,mode,checkedAt:v.checkedAt,ports:v.ports.map(p=>({port:p.port,reachable:p.reachable,latencyMs:p.latencyMs}))};
}
/** A successful tested port proves a response. A partial all-negative result
 * cannot prove the complete saved connection failed. Profile-only port coverage
 * is not supplied by this response, so negative coverage remains unknown. */
export function connectionCheckState(result:CameraDiagnosticResult|null,device:CameraRow,now=Date.now()):{state:ConnectionCheckState;reason:string}{
 if(!result)return {state:'unknown',reason:'No completed connection check.'};
 if(!cameraTimestamp(result.checkedAt,now).fresh)return {state:'unknown',reason:'Saved connection check is stale. Run a new check.'};
 if(result.ports.some(p=>p.reachable))return {state:'online',reason:'Connection responded'};
 const expected=device.connection?.ports||[];
 if(!expected.length||expected.some(port=>!result.ports.some(p=>p.port===port)))return {state:'unknown',reason:'No tested port responded; saved port coverage is incomplete.'};
 return {state:'offline',reason:'No tested port responded'};
}
