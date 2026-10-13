/** Server-only vendor backoff. Persist only timing metadata, never URLs or credentials. */
type Row=Record<string,unknown>;
type Gate={allowed:boolean;retryAt:string|null;leaseId:string|null;revision:number;consecutiveLimits:number};
const vendor=(input:RequestInfo|URL)=>{
 try{const url=new URL(input instanceof Request?input.url:String(input));return url.protocol==='https:'&&!url.username&&!url.password&&((url.hostname==='connect.mhelpdesk.com'&&url.pathname.startsWith('/api/v1.0/'))||(url.hostname==='login.mhelpdesk.com'&&url.pathname==='/connect/token'));}catch{return false;}
};
function checked(value:Row):Gate{
 if(typeof value.allowed!=='boolean'||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||!Number.isInteger(value.consecutiveLimits)||Number(value.consecutiveLimits)<0||!(value.retryAt===null||typeof value.retryAt==='string'&&Number.isFinite(Date.parse(value.retryAt)))||!(value.leaseId===null||typeof value.leaseId==='string'&&/^[0-9a-f-]{36}$/i.test(value.leaseId)))throw Error('mHelpDesk backoff state is unavailable');
 return value as Gate;
}
/** RFC 9110: Retry-After can be delay-seconds or an HTTP date. Never shorten it. */
export function mhelpRetryAt(header:string|null,now=Date.now()):string|null{
 if(!header||header.length>160)return null;
 const value=header.trim(),at=/^\d+$/.test(value)?now+Number(value)*1000:Date.parse(value);
 return Number.isFinite(at)&&at>now&&at<=8.64e15?new Date(at).toISOString():null;
}
export function createMhelpReadBackoff(options:{fetch:typeof fetch;gate:(body:Row)=>Promise<Row>;now?:()=>number;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>}){
 const now=options.now||Date.now;
 const wait=options.wait||((ms,signal)=>new Promise<void>((resolve,reject)=>{if(signal?.aborted){reject(Error('Read cancelled'));return;}const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(finish,ms),cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(Error('Read cancelled'));};signal?.addEventListener('abort',cancel,{once:true});}));
 let state:Gate|null=null,checkedAt=-Infinity,pending:Promise<Gate>|null=null,nextStart=0,starts=Promise.resolve(),deferred=0,limited=0,generation=0;
 const admit=async()=>{
  if(state&&!state.allowed&&state.retryAt&&Date.parse(state.retryAt)>now())return state;
  if(state?.allowed&&now()-checkedAt<5000)return state;
  if(!pending){const started=generation;pending=options.gate({p_action:'gate_admit',p_session:state?.leaseId||null}).then(value=>{const next=checked(value);if(state&&(next.revision<state.revision||started!==generation&&next.allowed&&next.revision<=state.revision))return state;state=next;checkedAt=now();return state;}).finally(()=>{pending=null;});}
  return pending;
 };
 const held=(gate:Gate)=>{deferred++;return new Response('{"error":"mHelpDesk is waiting for its retry window"}',{status:429,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':String(Math.max(1,Math.ceil(((gate.retryAt?Date.parse(gate.retryAt):now()+60000)-now())/1000))),'X-COS-Mhelp-Deferred':'1'}});};
 const pacedFetch:typeof fetch=async(input,init)=>{
  if(!vendor(input))return options.fetch(input,init);
  const signal=init?.signal||(input instanceof Request?input.signal:undefined)||undefined;
  let gate=await admit();if(!gate.allowed)return held(gate);
  let release!:()=>void;const previous=starts;starts=new Promise<void>(resolve=>{release=resolve;});
  try{await previous;const delay=Math.max(0,nextStart-now());if(delay)await wait(delay,signal);if(signal?.aborted)throw Error('Read cancelled');gate=await admit();if(!gate.allowed)return held(gate);nextStart=now()+400;}finally{release();}
  const revision=gate.revision,leaseId=gate.leaseId,started=generation;
  const response=await options.fetch(input,init);
  if(response.status===429){
   limited++;generation++;
   // Close this instance immediately while the durable cooldown is being recorded.
   state={...gate,allowed:false,retryAt:mhelpRetryAt(response.headers.get('Retry-After'),now())||new Date(now()+15*60000).toISOString()};
   try{const next=checked(await options.gate({p_action:'gate_limit',p_expires_at:mhelpRetryAt(response.headers.get('Retry-After'),now())}));if(!state||next.revision>=state.revision)state=next;checkedAt=now();}catch{await response.body?.cancel().catch(()=>{});throw Error('mHelpDesk backoff could not be recorded');}
  }else if(response.ok&&gate.consecutiveLimits>0){
   // An older successful request cannot erase a newer 429 or another probe lease.
   const value=checked(await options.gate({p_action:'gate_recovered',p_session:leaseId,p_expected_revision:revision}));
   if(started===generation&&(!state||value.revision>=state.revision)){state=value;checkedAt=now();}
  }
  return response;
 };
 return {fetch:pacedFetch,snapshot:()=>({deferred,rateLimited:limited,nextReadAt:state?.retryAt||null})};
}
