import {equal,planPublishing,publisherRefreshCandidates} from './model.ts';
type Row=Record<string,any>;
export class PublisherServiceError extends Error {
 constructor(public service:'rpc'|'google_auth'|'google_read'|'google_write',public status:number){super('Publisher service unavailable');}
}
export function createPublisherHandler(options:{authenticate:(req:Request)=>Promise<boolean>;rpc:(name:string,body:Row)=>Promise<any>;read:(bindings:Row[])=>Promise<Row[]>;write:(requests:Row[])=>Promise<void>}){
 return async(req:Request)=>{
  const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(req.method!=='POST'||new URL(req.url).search||req.headers.has('origin'))return reply({error:'Scheduled request required'},405);
  try{if(!await options.authenticate(req))return reply({error:'Forbidden'},403);}catch{return reply({error:'Forbidden'},403);}
  let action:string;
  try{
   if(!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||''))throw Error();
   const reader=req.body?.getReader();if(!reader)throw Error();let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64)throw Error();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{try{void reader.cancel().catch(()=>{});}catch{}}
   const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||!['run','status'].includes(v.action))throw Error();action=v.action;
  }catch{return reply({error:'Invalid publisher request'},400);}
  let lease:string|null=null,phase='begin';
  try{
   if(action==='status')return reply(await options.rpc('cos_sheets_placement_status',{}));
   const start=await options.rpc('cos_sheets_placement_begin',{});
   if(start?.leaseId===null)return reply({state:'busy_or_disabled'});
   if(typeof start?.leaseId!=='string'||!Array.isArray(start.bindings))throw Error('Invalid publisher lease');lease=start.leaseId;
   phase='read';const rows=await options.read(start.bindings),plan=planPublishing(start.bindings,rows);
   if(plan.requests.length){
    // A second live read checks row positions, identity uniqueness, values and validation.
    // Sheets has no compare-and-set cell write: a collaborator can still edit during POST.
    phase='compare';const second=await options.read(start.bindings);
    if(!equal(planPublishing(start.bindings,second),plan))throw Error('Tracker changed before publishing');
    phase='stage';const staged=await options.rpc('cos_sheets_placement_stage',{p_lease_id:lease,p_intents:plan.intents});
    if(staged?.committed!==true)throw Error('Lost publisher lease');
    phase='write';await options.write(plan.requests);
    phase='readback';const readback=await options.read(start.bindings);
    for(let i=0;i<plan.results.length;i++){
     const r=plan.results[i];if(r.state!=='published')continue;
     const b=start.bindings.find((b:Row)=>b.equipmentId===r.equipmentId);
     const live=readback.filter(r=>r.sheetId===b.sheetId&&r.row===b.row);
     if(live.length!==1||!live[0].unique||live[0].label!==b.label||!equal(live[0].cells,r.cells))plan.results[i]={equipmentId:r.equipmentId,state:'held',reason:'readback_mismatch'};
    }
   }
   const refresh=new Set(publisherRefreshCandidates(start.bindings,rows));
   for(const r of plan.results)if(r.state==='held'&&r.reason==='source_unverified'&&refresh.has(r.equipmentId))r.reason='source_refresh_requested';
   phase='finish';const done=await options.rpc('cos_sheets_placement_finish',{p_lease_id:lease,p_results:plan.results});
   if(done?.committed!==true)throw Error('Lost publisher lease');
   return reply({state:'current',...done});
  }catch(cause){
   if(lease)try{await options.rpc('cos_sheets_placement_fail',{p_lease_id:lease});}catch{}
   const known=['Wrong tracker workbook','Tracker layout changed','Incomplete tracker read','Tracker changed during read','Unexpected tracker range','Unexpected tracker cells','Malformed tracker cell','Tracker headers changed','Invalid publisher bindings'];
   const diagnostic=cause instanceof PublisherServiceError?{service:cause.service,status:cause.status}:cause instanceof Error&&known.includes(cause.message)?{reason:known.indexOf(cause.message)}:{};
   return reply({error:'Tracker publisher unavailable',phase,...diagnostic},503);
  }
 };
}
