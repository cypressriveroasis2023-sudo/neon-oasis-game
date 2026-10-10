import {deadline,exact,row,type RunResult} from '../../../operations/intake/mhelpIntakeRuntime.ts';
import {projectRunResult,readBoundedJson} from '../../../operations/intake/mhelpIntakeHandlers.ts';
import {projectIntakeReview,projectPendingScheduleStatus,PENDING_SCHEDULE_CAPABILITY,EXTENDED_REVIEW_CONTRACT} from '../../../operations/intake/mhelpIntakeReview.ts';
type Options={
  verifyCron:(candidate:string,signal:AbortSignal)=>Promise<boolean>;
  verifyOwner:(authorization:string,signal:AbortSignal)=>Promise<boolean>;
  run:(request:Request)=>Promise<RunResult>;
  review:(signal:AbortSignal)=>Promise<unknown>;
  pendingStatus?:(signal:AbortSignal)=>Promise<unknown>;
};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'}});
/** Server-to-server only. Browser Owner calls use the existing protected Operations proxy. */
export function createCameraMhelpTicketIntakeHandler(options:Options){return async(req:Request)=>{
  if(req.headers.has('origin'))return reply({error:'Forbidden'},403);
  if(req.method!=='POST'||new URL(req.url).search||!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||''))return reply({error:'Invalid intake request'},400);
  const candidate=req.headers.get('x-camera-cron-secret'),authorization=req.headers.get('authorization');
  // Mixed credentials never fall through from a rejected cron to an Owner path.
  if((candidate!==null)===(authorization!==null))return reply({error:'Forbidden'},403);
  let mode:'cron'|'owner';
  try{
    const signal=AbortSignal.any([req.signal,AbortSignal.timeout(10000)]);
    if(candidate!==null){if(!candidate||candidate.length>1024||/\s/.test(candidate)||!await deadline(()=>options.verifyCron(candidate,signal),signal))return reply({error:'Forbidden'},403);mode='cron';}
    else{if(!authorization||authorization.length>16400||!/^Bearer [^\s]+$/i.test(authorization)||!await deadline(()=>options.verifyOwner(authorization,signal),signal))return reply({error:'Forbidden'},403);mode='owner';}
  }catch{return reply({error:'Forbidden'},403);}
  let pendingSchedule=false;
  try{
    const input=row(await readBoundedJson(req.body,256,AbortSignal.any([req.signal,AbortSignal.timeout(5000)])));
    pendingSchedule=mode==='owner'&&Object.hasOwn(input,'evidenceCapability');
    exact(input,pendingSchedule?['action','evidenceCapability']:['action']);
    if(input.action!==(mode==='cron'?'run':'review_status')||pendingSchedule&&input.evidenceCapability!==PENDING_SCHEDULE_CAPABILITY)throw Error();
  }catch{return reply({error:'Invalid intake request'},400);}
  try{
    if(mode==='cron')return reply(projectRunResult(await options.run(req)));
    const signal=AbortSignal.any([req.signal,AbortSignal.timeout(10000)]);
    const review=projectIntakeReview(await deadline(()=>options.review(signal),signal));
    if(!pendingSchedule)return reply(review);
    // Independent saved evidence: a missing/failed pending read must not become zero waiting.
    let pending=null;
    if(options.pendingStatus)try{pending=projectPendingScheduleStatus(await deadline(()=>options.pendingStatus!(signal),signal));}catch{ /* fixed unavailable state only */ }
    return reply({contract:EXTENDED_REVIEW_CONTRACT,review,pendingSchedule:pending});
  }catch{return reply({error:'Intake unavailable'},503);}
};}
