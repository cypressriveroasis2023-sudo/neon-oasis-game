export type CustodyUnit={key:string;family:string;tag:string;state:string;sims:string[];batteries:number|null;parts:{name:string;quantity:number|null}[]};
export type CustodyHandoff={id:string;sender:string;receiver:string;receiverId:string;state:string;createdAt:string;updatedAt:string;units:CustodyUnit[]};
export type CustodyReturn={id:string;receiver:string;receiverId:string;state:string;submittedAt:string;receivedAt:string;unit:CustodyUnit};
export type CustodyTruck={id:string;name:string;units:CustodyUnit[];sims:{slot:number|null;number:string;state:string}[];stock:Record<string,number|null>};
type Source<T>={value?:T;error?:string};
export type OwnerCustody={readAt:string;sources:{trucks:Source<CustodyTruck[]>;handoffs:Source<{limited:boolean;items:CustodyHandoff[]}>;returns:Source<{pending:number;items:CustodyReturn[]}>}};
// Same-origin signed-in host only. The host calls fixed read RPCs with its existing session.
function hostRead<T>(type:string,request:Record<string,string>,validate:(value:any)=>boolean):Promise<T>{
 if(window.parent===window)return Promise.reject(new Error('Open custody from the signed-in COS Owner page.'));
 return new Promise((resolve,reject)=>{
  const parent=window.parent,origin=location.origin,requestId=crypto.randomUUID();
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);window.removeEventListener('cos-private-data-invalidated',invalid);window.removeEventListener('cos-workspace-navigation',invalid);};
  const fail=(message:string)=>{cleanup();reject(new Error(message));};
  const invalid=()=>fail('The signed-in workspace changed. Refresh custody records.');
  const receive=(event:MessageEvent)=>{if(event.source!==parent||event.origin!==origin||event.data?.type!==type+'_RESPONSE'||event.data.requestId!==requestId)return;
   const value=event.data.snapshot;
   if(!value||!Number.isFinite(Date.parse(value.readAt))||!validate(value))return fail('Custody records unavailable or incomplete.');
   cleanup();resolve(value);
  };
  const timer=window.setTimeout(()=>fail('Custody records did not respond. Refresh the signed-in COS host.'),15000);
  window.addEventListener('message',receive);window.addEventListener('cos-private-data-invalidated',invalid);window.addEventListener('cos-workspace-navigation',invalid);
  parent.postMessage({type:type+'_REQUEST',requestId,...request},origin);
 });
}

export function readOwnerCustody():Promise<OwnerCustody>{return hostRead('COS_OWNER_CUSTODY',{},value=>value.sources&&['trucks','handoffs','returns'].every(key=>value.sources[key]&&(value.sources[key].value!==undefined||typeof value.sources[key].error==='string')));}
export type OwnerSchedule={from:string;to:string;readAt:string;total:number;truncated:boolean;items:{id:string;ticket:string;site:string;kind:string;day:string;time:string;state:string;department:string}[]};
export function readOwnerSchedule(from:string,to:string):Promise<OwnerSchedule>{return hostRead('COS_OWNER_SCHEDULE',{from,to},value=>value.from===from&&value.to===to&&Array.isArray(value.items)&&Number.isSafeInteger(value.total)&&typeof value.truncated==='boolean');}
