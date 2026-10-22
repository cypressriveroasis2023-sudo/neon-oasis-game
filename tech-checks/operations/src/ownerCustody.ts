export type CustodyUnit={key:string;family:string;tag:string;state:string;sims:string[];batteries:number|null;parts:{name:string;quantity:number|null}[]};
export type CustodyHandoff={id:string;sender:string;receiver:string;receiverId:string;state:string;createdAt:string;updatedAt:string;units:CustodyUnit[]};
export type CustodyReturn={id:string;receiver:string;receiverId:string;state:string;submittedAt:string;receivedAt:string;unit:CustodyUnit};
export type CustodyTruck={id:string;name:string;units:CustodyUnit[];sims:{slot:number|null;number:string;state:string}[];stock:Record<string,number|null>};
type Source<T>={value?:T;error?:string};
export type OwnerCustody={readAt:string;sources:{trucks:Source<CustodyTruck[]>;handoffs:Source<{limited:boolean;items:CustodyHandoff[]}>;returns:Source<{pending:number;items:CustodyReturn[]}>}};
// Same-origin signed-in host only. The host calls fixed read RPCs with its existing session.
export function readOwnerCustody():Promise<OwnerCustody>{
 if(window.parent===window)return Promise.reject(new Error('Open custody from the signed-in COS Owner page.'));
 return new Promise((resolve,reject)=>{
  const parent=window.parent,origin=location.origin,requestId=crypto.randomUUID();
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);window.removeEventListener('cos-private-data-invalidated',invalid);window.removeEventListener('cos-workspace-navigation',invalid);};
  const fail=(message:string)=>{cleanup();reject(new Error(message));};
  const invalid=()=>fail('The signed-in workspace changed. Refresh custody records.');
  const receive=(event:MessageEvent)=>{if(event.source!==parent||event.origin!==origin||event.data?.type!=='COS_OWNER_CUSTODY_RESPONSE'||event.data.requestId!==requestId)return;
   const value=event.data.snapshot;
   if(!value||!Number.isFinite(Date.parse(value.readAt))||!value.sources||!['trucks','handoffs','returns'].every(key=>value.sources[key]&&(value.sources[key].value!==undefined||typeof value.sources[key].error==='string')))return fail('Custody records unavailable or incomplete.');
   cleanup();resolve(value);
  };
  const timer=window.setTimeout(()=>fail('Custody records did not respond. Refresh the signed-in COS host.'),15000);
  window.addEventListener('message',receive);window.addEventListener('cos-private-data-invalidated',invalid);window.addEventListener('cos-workspace-navigation',invalid);
  parent.postMessage({type:'COS_OWNER_CUSTODY_REQUEST',requestId},origin);
 });
}
