/** Intake piggybacks on an authenticated provider cron request, never on a browser action. */
import {INTAKE_LIMITS,runMhelpIntake} from './mhelpIntakeRuntime.ts';
import {createExistingCredentialSourceRead,createExistingServiceRpc} from './mhelpIntakeTransport.ts';

const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
// Conservative invocation ceiling, ten seconds below the lowest hosted worker
// limit. A reused worker can still stop earlier; its durable lease permits replay.
// Intake owns at most 120 seconds including cleanup, independent of the provider
// response or request cancellation after that response is sent.
export const INTAKE_BACKGROUND_INVOCATION_MS=140000;
type Options={
  request:Request;
  cronAuthenticated:boolean;
  projectUrl:string|undefined;
  db:Parameters<typeof createExistingServiceRpc>[0];
  fetch:typeof fetch;
  startedAt:number;
  waitUntil:(task:Promise<void>)=>void;
  now?:()=>number;
  run?:typeof runMhelpIntake;
};

/** No extra invocation, credential lookup, loopback request or provider dependency. */
export function scheduleCameraMhelpIntake(options:Options):boolean {
  const req=options.request,candidate=req.headers.get('x-camera-cron-secret');
  if(options.cronAuthenticated!==true||options.projectUrl!==LEGACY||req.method!=='POST'||req.signal.aborted
    ||req.headers.has('origin')||req.headers.has('authorization')
    ||!candidate||candidate.length>1024||/\s/.test(candidate)||!Number.isFinite(options.startedAt))return false;
  const now=options.now??Date.now;
  const budget=()=>{const at=now();return !Number.isFinite(at)||at<options.startedAt?0:Math.min(INTAKE_LIMITS.deadlineMs,options.startedAt+INTAKE_BACKGROUND_INVOCATION_MS-at);};
  if(budget()<=2000)return false;
  let registered=false;
  const task=Promise.resolve().then(async()=>{
    if(!registered)return;
    // Re-evaluate after scheduling, so a delayed callback cannot reset its clock.
    const deadlineMs=budget();if(deadlineMs<=2000)return;
    await (options.run??runMhelpIntake)({enabled:true,deadlineMs,
      rpc:createExistingServiceRpc(options.db),
      readSource:createExistingCredentialSourceRead({projectUrl:LEGACY,request:req,fetch:options.fetch}),
    });
  }).catch(()=>{/* Provider result is independent. Durable intake state carries safe status only. */});
  try{options.waitUntil(task);registered=true;return true;}
  catch{return false;}
}
