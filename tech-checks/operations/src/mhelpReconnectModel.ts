export type ReconnectStatus={contract:'cos-mhelpdesk-reconnect-v1';state:'ready'|'pending'|'committed'|'unavailable';portalId:string|null;revision:number|null;renewalVerified:boolean;requestId?:string};
export type ReconnectAttempt={requestId:string;expectedRevision:number;portalId:string};
export function checkedReconnectStatus(value:unknown,attempt?:ReconnectAttempt):ReconnectStatus{
 const invalid=():never=>{throw Error('The reconnect result could not be verified. Check the result before trying again.');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const row=value as Record<string,unknown>,keys=['contract','state','portalId','revision','renewalVerified','requestId'];
 if(Object.keys(row).some(k=>!keys.includes(k))||row.contract!=='cos-mhelpdesk-reconnect-v1'||!['ready','pending','committed','unavailable'].includes(String(row.state))||typeof row.renewalVerified!=='boolean')return invalid();
 if(row.state==='unavailable'){
  if(row.portalId!==null||row.revision!==null||row.renewalVerified!==false||row.requestId!==undefined)return invalid();
 }else{
  if(typeof row.portalId!=='string'||!/^[1-9]\d{0,14}$/.test(row.portalId)||!Number.isSafeInteger(Number(row.portalId))||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||Number(row.revision)>=Number.MAX_SAFE_INTEGER)return invalid();
  if(row.renewalVerified!==(row.state==='committed'))return invalid();
  if(attempt){
   if(row.requestId!==attempt.requestId||row.portalId!==attempt.portalId)return invalid();
   if(row.state==='committed'&&row.revision!==attempt.expectedRevision+1)return invalid();
  }else if(row.requestId!==undefined||row.state==='committed'||row.state==='pending')return invalid();
 }
 return row as ReconnectStatus;
}
