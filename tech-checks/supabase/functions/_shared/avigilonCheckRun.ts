import type {Publication} from './avigilonEndpointCheck.ts';
/** Server-side contract. Roster/authorization/store/probe dependencies must come
 * from trusted adapters, never request bodies. No network or database defaults. */
export type Actor={tenantId:string;actorId:string;canCheck:boolean};
export type Endpoint={deviceId:string;revision:string;ip:string;ports:number[];profile:'sniper'|'camv'};
export type AuditUnit={id:string;name:string;family:string;placement:'FIELD'|'SHOP'|'UNKNOWN';restricted:boolean;identityVerified:boolean;endpoint:Endpoint|null};
export type Roster={tenantId:string;revision:string;units:AuditUnit[]};
export type Outcome='pending'|'online'|'nonresponse'|'unverified';
export type Row={unitId:string;name:string;outcome:Outcome;reason:string|null;startedAt:string|null;completedAt:string|null;confirmedOutage:boolean;endpointRevision:string|null};
export type Run={id:string;tenantId:string;rosterRevision:string;startedAt:string;completedAt:string|null;deadlineAt:string;state:'pending'|'completed'|'partial'|'failed';rows:Row[]};
export type ProbeResult={outcome:'online'|'nonresponse';checkedAt:string;revision:string;confirmedOutage:boolean;publication?:Publication};
export interface RunStore{
 /** Atomic across workers. Only a pending, unexpired run with the SAME roster
  * revision may coalesce. Expired/superseded leases must reject all later writes. */
 claim(candidate:Run):Promise<{run:Run;claimed:boolean}>;
 read(tenantId:string,id:string):Promise<Run|null>;
 save(run:Run):Promise<boolean>;
}
export type Dependencies={authorize:(request:Request)=>Promise<Actor>;roster:(actor:Actor)=>Promise<Roster>;store:RunStore;probe:(actor:Actor,endpoint:Endpoint,signal:AbortSignal)=>Promise<ProbeResult>;background:(work:Promise<void>)=>void;now?:()=>number;id:()=>string;budgetMs?:number;concurrency?:number};
const families=new Set(['Sniper','Sniper ES','Sniper 2','Sniper 2 SA','Sniper 4','Radar - Sniper','Thermal - Sniper','CAM-V']);
const fingerprint=(u:AuditUnit)=>JSON.stringify([u.id,u.family,u.placement,u.restricted,u.identityVerified,u.endpoint]);
const validEndpoint=(e:Endpoint|null)=>!!e&&['sniper','camv'].includes(e.profile)&&/^\d+$/.test(e.deviceId)&&/^\d+$/.test(e.revision)&&typeof e.ip==='string'&&e.ip.length>0&&Array.isArray(e.ports)&&e.ports.length>0&&e.ports.length<=32&&e.ports.every(p=>Number.isInteger(p)&&p>0&&p<=65535);
function validateRoster(r:Roster,a:Actor){if(r.tenantId!==a.tenantId||!r.revision||!Array.isArray(r.units)||r.units.length>10000||r.units.some(u=>!u.id||!u.name)||new Set(r.units.map(u=>u.id)).size!==r.units.length)throw Error('Authoritative roster unavailable');}
const eligibility=(u:AuditUnit)=>u.restricted?'restricted':!u.identityVerified?'identity_unverified':!validEndpoint(u.endpoint)?'no_approved_endpoint':null;
export function summarizeRun(run:Run){return {total:run.rows.length,pending:run.rows.filter(r=>r.outcome==='pending').length,online:run.rows.filter(r=>r.outcome==='online').length,nonresponse:run.rows.filter(r=>r.outcome==='nonresponse').length,unverified:run.rows.filter(r=>r.outcome==='unverified').length};}
export function runReport(run:Run){return ['Avigilon Field endpoint checks','Run: '+run.id,'State: '+run.state,'Started: '+run.startedAt,'Completed: '+(run.completedAt||'Pending'),'TCP service reachability; does not verify video or every camera.',...run.rows.map(r=>[r.name,r.outcome,r.reason||'',r.completedAt||'Pending',r.confirmedOutage?'Outage confirmed':'Outage not confirmed'].join(' | '))].join('\n');}
export function createAvigilonCheckRuns(d:Dependencies){
 const now=d.now||Date.now,budget=Math.min(90000,Math.max(1,d.budgetMs??45000)),concurrency=Math.min(8,Math.max(1,d.concurrency??4));
 const auth=async(request:Request)=>{const a=await d.authorize(request);if(!a?.tenantId||!a.actorId||a.canCheck!==true)throw Error('Existing Owner or IT check permission required');return a;};
 async function execute(actor:Actor,roster:Roster,run:Run){
  const controller=new AbortController();let next=0,closed=false;
  const remaining=()=>Math.max(0,Date.parse(run.deadlineAt)-now());
  const timer=setTimeout(()=>controller.abort(),remaining());
  // Serialize saves so a slow earlier row cannot overwrite a later completed row.
  let writes=Promise.resolve(true);
  const save=()=>{const copy=structuredClone(run);writes=writes.then(ok=>ok?d.store.save(copy):false);return writes;};
  const work=async()=>{while(!closed&&!controller.signal.aborted){const index=next++;if(index>=run.rows.length)return;const row=run.rows[index];if(row.outcome!=='pending')continue;
   const original=roster.units.find(u=>u.id===row.unitId)!;row.startedAt=new Date(now()).toISOString();
   try{
    const fresh=await d.roster(actor);validateRoster(fresh,actor);const current=fresh.units.find(u=>u.id===row.unitId);
    if(fresh.revision!==run.rosterRevision||!current||fingerprint(current)!==fingerprint(original))throw Error('endpoint_or_roster_changed');
    if(closed||controller.signal.aborted)return;
    const result=await d.probe(actor,original.endpoint!,controller.signal);
    if(closed||controller.signal.aborted)return;
    const after=await d.roster(actor);validateRoster(after,actor);const latest=after.units.find(u=>u.id===row.unitId);
    if(after.revision!==run.rosterRevision||!latest||fingerprint(latest)!==fingerprint(original))throw Error('endpoint_or_roster_changed');
    if(!['online','nonresponse'].includes(result.outcome)||result.revision!==original.endpoint!.revision||!Number.isFinite(Date.parse(result.checkedAt))||Date.parse(result.checkedAt)<Date.parse(row.startedAt!)||Date.parse(result.checkedAt)>now()||typeof result.confirmedOutage!=='boolean')throw Error('invalid_checker_result');
    // Native run leases and legacy camera health are currently in separate DBs.
    // Never emulate an atomic publication fence with two sequential RPC calls.
    if(result.publication)throw Error('atomic_publication_unavailable');
    if(closed||controller.signal.aborted||remaining()<=0)return;
    row.outcome=result.outcome;row.completedAt=result.checkedAt;row.confirmedOutage=result.outcome==='nonresponse'&&result.confirmedOutage;
   }catch(error){if(closed||controller.signal.aborted)return;row.outcome='unverified';row.reason=error instanceof Error&&['endpoint_or_roster_changed','invalid_checker_result','atomic_publication_unavailable'].includes(error.message)?error.message:'checker_unavailable';row.completedAt=new Date(now()).toISOString();}
   if(!await save()){closed=true;controller.abort();return;}
  }};
  try{
   const stopped=new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>resolve(),{once:true}));
   await Promise.race([Promise.all(Array.from({length:concurrency},work)),stopped]);
  }finally{
   closed=true;clearTimeout(timer);controller.abort();
   for(const row of run.rows)if(row.outcome==='pending'){row.outcome='unverified';row.reason='run_deadline';row.completedAt=new Date(now()).toISOString();}
   const counts=summarizeRun(run);run.state=counts.unverified?(counts.online+counts.nonresponse?'partial':'failed'):'completed';run.completedAt=new Date(now()).toISOString();await save();
  }
 }
 return {
  async start(request:Request){const actor=await auth(request),roster=await d.roster(actor);validateRoster(roster,actor);const startedAt=new Date(now()).toISOString();
   const units=roster.units.filter(u=>families.has(u.family)&&u.placement==='FIELD');
   const rows=units.map(u=>{const duplicate=u.endpoint&&roster.units.filter(other=>other.endpoint?.deviceId===u.endpoint!.deviceId).length!==1;const reason=duplicate?'identity_collision':eligibility(u);return {unitId:u.id,name:u.name,outcome:reason?'unverified':'pending',reason,startedAt:null,completedAt:reason?startedAt:null,confirmedOutage:false,endpointRevision:u.endpoint?.revision??null} as Row;});
   const result=await d.store.claim({id:d.id(),tenantId:actor.tenantId,rosterRevision:roster.revision,startedAt,deadlineAt:new Date(now()+budget).toISOString(),completedAt:null,state:'pending',rows});
   if(result.run.tenantId!==actor.tenantId||result.run.rosterRevision!==roster.revision)throw Error('Run scope mismatch');
   if(result.claimed)d.background(execute(actor,roster,structuredClone(result.run)));
   return {run:result.run,coalesced:!result.claimed};
  },
  async read(request:Request,id:string){const actor=await auth(request),run=await d.store.read(actor.tenantId,id);if(!run||run.tenantId!==actor.tenantId)throw Error('Run unavailable');
   // A killed worker must not leave a report pending forever. This read-only
   // projection never invents a completed endpoint check or renews a timestamp.
   if(run.state==='pending'&&Date.parse(run.deadlineAt)<=now()){
    const expired=structuredClone(run);for(const row of expired.rows)if(row.outcome==='pending'){row.outcome='unverified';row.reason='run_deadline';row.completedAt=null;}
    expired.state=expired.rows.some(r=>r.outcome==='online'||r.outcome==='nonresponse')?'partial':'failed';expired.completedAt=null;return expired;
   }return run;}
 };
}
