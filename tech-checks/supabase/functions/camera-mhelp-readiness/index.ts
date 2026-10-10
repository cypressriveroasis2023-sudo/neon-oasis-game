import {reply} from '../cos-mhelp-readiness/index.ts';
import {readBoundedJson} from '../../../operations/intake/mhelpIntakeHandlers.ts';
import {deadline} from '../../../operations/intake/mhelpIntakeRuntime.ts';
import {projectIntakePolicyResponse} from '../../../operations/intake/mhelpIntakeSource.ts';
/** Original authenticate reply is unchanged; policy uses the same verified cron boundary. */
export function createCameraMhelpReadinessHandler(options: {verifyCron:(candidate:string|null)=>Promise<boolean>;intakePolicy?:(signal:AbortSignal)=>Promise<unknown>}) {
  return async (req:Request) => {
    const signal=AbortSignal.any([req.signal,AbortSignal.timeout(10000)]);
    try { if (!await deadline(()=>options.verifyCron(req.headers.get('x-camera-cron-secret')),signal)) return reply({error:'Forbidden'},403); }
    catch { return reply({error:'Forbidden'},403); }
    if (req.method!=='POST' || new URL(req.url).search || !/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||'')) return reply({error:'Invalid readiness request'},400);
    let action:string;
    try {
      const v=await readBoundedJson(req.body,256,signal);
      if (!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).length!==1 || !('action' in v) || !['authenticate','intake_policy'].includes(String(v.action))) throw Error('Invalid request');
      action=String(v.action);
    } catch { return reply({error:'Invalid readiness request'},400); }
    if(action==='authenticate')return reply({authenticated:true});
    // Policy is for the fixed native service, never a cross-origin browser read.
    if(req.headers.has('origin')||req.headers.has('authorization'))return reply({error:'Forbidden'},403);
    if(!options.intakePolicy)return reply({error:'Intake policy unavailable'},503);
    try{return reply(projectIntakePolicyResponse(await deadline(()=>options.intakePolicy!(signal),signal)));}
    catch{return reply({error:'Intake policy unavailable'},503);}
  };
}
