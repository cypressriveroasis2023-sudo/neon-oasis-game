import {directPublicHost} from '../scheduledDirectService.ts';
export type TcpConnect=(options:{hostname:string;port:number;transport:'tcp';signal:AbortSignal})=>Promise<{close:()=>void}>;
/** Compatible with Deno.connect. Injected for tests; no call occurs on import. */
export function createSavedTcpProbe(connect:TcpConnect,now=()=>performance.now()){
 return async(host:string,port:number,timeout:number,signal:AbortSignal)=>{
  if(directPublicHost(host)!==host||!Number.isInteger(port)||port<1||port>65535||!Number.isFinite(timeout)||timeout<=0||timeout>2200||signal.aborted)throw Error('Invalid saved TCP attempt');
  const controller=new AbortController(),began=now();let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
  return await new Promise<{online:boolean;attempted:true;latency_ms:number|null;error?:string}>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.abort();};
   const finish=(online:boolean,error?:string)=>{if(settled)return;settled=true;cleanup();resolve({online,attempted:true,latency_ms:online?Math.max(0,now()-began):null,...(error?{error}:{})});};
   const cancel=()=>{if(settled)return;settled=true;cleanup();reject(Error('TCP attempt cancelled'));};
   signal.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>finish(false,'timeout'),timeout);
   // DNS cannot run: host was validated as a public IPv4 literal above.
   Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('Cancelled before connect');return connect({hostname:host,port,transport:'tcp',signal:controller.signal});}).then(socket=>{
    try{socket.close();}catch{if(!settled){settled=true;cleanup();reject(Error('Socket cleanup failed'));}return;}
    finish(true);
   },error=>{
    if(settled)return;
    if(error?.name==='ConnectionRefused'||error?.code==='ECONNREFUSED')finish(false,'Connection refused (os error 111)');
    else if(error?.name==='TimedOut'||error?.code==='ETIMEDOUT')finish(false,'Connection timed out (os error 110)');
    else {settled=true;cleanup();reject(Error('Incomplete TCP transport'));}
   });
  });
 };
}
