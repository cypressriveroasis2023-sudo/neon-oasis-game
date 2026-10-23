/** One durable allowance across workers. No credential, URL, or provider body is
 * stored in accounting. A failed admission must never fall back to direct I/O. */
type Admission={allowed:boolean;reason:null|'pacing'|'daily_budget'|'provider_wait'|'usage_not_yet_measured';retryAt:string|null};
export function mhelpRequestClass(input:RequestInfo|URL):'essential'|'data'|null{
 try{
  const u=new URL(input instanceof Request?input.url:String(input));
  if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  if(u.hostname==='login.mhelpdesk.com'&&u.pathname==='/connect/token')return 'essential';
  if(u.hostname==='connect.mhelpdesk.com'&&u.pathname.startsWith('/api/v1.0/'))return u.pathname==='/api/v1.0/users/me'?'essential':'data';
 }catch{/* Nonvendor requests use their existing transport. */}
 return null;
}
function checked(v:unknown):Admission{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('mHelpDesk request allowance unavailable');
 const r=v as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['allowed','reason','retryAt'].includes(k))||typeof r.allowed!=='boolean'
  ||(r.allowed?(r.reason!==null||r.retryAt!==null):(!['pacing','daily_budget','provider_wait','usage_not_yet_measured'].includes(String(r.reason))||typeof r.retryAt!=='string'||!Number.isFinite(Date.parse(r.retryAt)))))throw Error('mHelpDesk request allowance unavailable');
 return r as Admission;
}
export function createMhelpRequestBudget(options:{fetch:typeof fetch;admit:(essential:boolean)=>Promise<unknown>;now?:()=>number;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>}){
 const now=options.now||Date.now;
 const wait=options.wait||((ms,signal)=>new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(Error('Request canceled'));return;}
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(Error('Request canceled'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);signal?.addEventListener('abort',cancel,{once:true});
 }));
 const fetchBudget:typeof fetch=async(input,init)=>{
  const kind=mhelpRequestClass(input);if(!kind)return options.fetch(input,init);
  const signal=init?.signal||(input instanceof Request?input.signal:undefined)||undefined;
  // No reusable permission and no instance-local counter. Each retry, page and
  // token/account request must obtain its own atomic admission.
  for(let tries=0;tries<80;tries++){
   if(signal?.aborted)throw Error('Request canceled');
   const gate=checked(await options.admit(kind==='essential'));
   if(signal?.aborted)throw Error('Request canceled');
   if(gate.allowed)return options.fetch(input,init);
   const delay=Date.parse(gate.retryAt!)-now();
   // RPC transit and PostgreSQL sub-millisecond timestamps can leave a pacing
   // deadline elapsed in this clock. Recheck authority after a bounded yield.
   if(gate.reason==='pacing'&&delay<=1000&&tries<79){await wait(Math.max(1,delay),signal);continue;}
   return new Response('{"error":"mHelpDesk request is waiting for its automatic retry window"}',{status:429,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-COS-Mhelp-Deferred':'1','X-COS-Mhelp-Budget':'1','Retry-After':String(Math.max(1,Math.ceil(Math.max(0,delay)/1000)))}});
  }
  throw Error('mHelpDesk request allowance unavailable');
 };
 return {fetch:fetchBudget};
}
