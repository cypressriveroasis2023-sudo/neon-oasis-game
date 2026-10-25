import type { DashboardData, DashboardRow, SourceKey } from './todayDashboardData';

/** Owner-only read model. Never invent a due date, outage, or missing signature. */
export type OwnerQueueArea = 'approval'|'it'|'service'|'customers'|'overdue'|'paperwork';
export type OwnerQueueItem = {
 key:string;source:SourceKey;sourceId:string;title:string;detail:string;areas:OwnerQueueArea[];
 owner:string;site:string|null;dueAt:string|null;urgency:'high'|'normal';
 route:'Owner Tasks'|'Jobs'|'Owner Review'|'Quotes'|'Invoices'|'Purchasing';
 jobId:string|null;evidenceUrl:string|null;photoUrl:string|null;
};
export type OwnerQueueCount={observed:number;complete:boolean;sourceComplete:boolean;coverageNote:string};
export type OwnerActionQueue={items:OwnerQueueItem[];counts:Record<OwnerQueueArea,OwnerQueueCount>;sourceUnavailable:SourceKey[];rejectedIdentityCount:number};
const areas:OwnerQueueArea[]=['approval','it','service','customers','overdue','paperwork'];
/** Existing data sources do not yet cover every company action in any area. */
const coverageGaps:Record<OwnerQueueArea,string>={
 approval:'Signed handoff exceptions and other Owner-only decisions are not yet included.',
 it:'Signed handoffs, truck inspections and IT equipment receipts are not yet included.',
 service:'Signed receipts, Service daily reports and spare-stock discrepancies are not yet included.',
 customers:'Camera outages need confirmed equipment and site identity; customer replies are not yet included.',
 overdue:'Only explicit saved due dates are counted. Other schedules and missing deadlines are not certified.',
 paperwork:'Signed reports, photographs and actual Google Drive archive receipts are not yet reconciled.'
};
export function ownerQueueSessionAllowed(session:unknown,mode:{fleetOnly:boolean;dailyOnly:boolean}):boolean{
 if(!session||typeof session!=='object'||Array.isArray(session))return false;
 const s=session as Record<string,unknown>;
 return s.authorized===true&&s.legacyOwner===true&&s.role==='Owner'&&!mode.fleetOnly&&!mode.dailyOnly;
}
const sources:SourceKey[]=['jobs','tasks','quotes','invoices','pos'];
const terminal=new Set(['complete','completed','closed','cancelled','canceled','deleted','paid']);
const status=(v:unknown)=>typeof v==='string'?v.trim().toLowerCase().replaceAll('_',' '):'';
const label=(v:unknown)=>typeof v==='string'?v.trim():'';
const value=(v:unknown,fallback:string)=>label(v)||fallback;
const stableId=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):'';
const safeUrl=(v:unknown):string|null=>{
 if(typeof v!=='string'||v.length>2048)return null;
 try{const url=new URL(v);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
};
const evidence=(row:DashboardRow,fields:string[])=>{
 for(const field of fields){const url=safeUrl(row[field]);if(url)return url;}
 return null;
};
const chicagoDay=(v:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(v);
/** Date-only deadlines expire after their Chicago calendar day. Scheduled activity is not a due date. */
export function explicitOverdue(raw:unknown,now=new Date()):boolean{
 if(typeof raw!=='string'||!Number.isFinite(now.getTime()))return false;
 const due=raw.trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(due)){
  const parsed=new Date(due+'T12:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===due&&due<chicagoDay(now);
 }
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(due)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(due))return false;
 const time=Date.parse(due);
 return Number.isFinite(time)&&time<now.getTime();
}
const department=(row:DashboardRow):'it'|'service'|null=>{
 const group=status(row.assignedDepartment||row.department);
 return group==='it'||group==='service'?group:null;
};
const employee=(row:DashboardRow,fallback='Unassigned / verify employee')=>
 value(row.assignedTo||row.technician||row.assignedName||row.technicianName,fallback);
const missingPaper=(row:DashboardRow):boolean=>{
 const check=row.techCheck;
 return Boolean(check&&typeof check==='object'&&!Array.isArray(check)&&(check as DashboardRow).complete===false
  ||row.paperworkComplete===false||row.requiredPhotosMissing===true||row.signatureMissing===true);
};
const due=(row:DashboardRow):string|null=>{
 const d=label(row.dueAt);
 return d&&(/^\d{4}-\d{2}-\d{2}$/.test(d)||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d))?d:null;
};
/** A single card may appear under multiple filters; the underlying record is never duplicated. */
export function buildOwnerActionQueue(data:DashboardData,now=new Date()):OwnerActionQueue{
 const gathered:OwnerQueueItem[]=[];let rejectedIdentityCount=0;
 const sourceUnavailable=sources.filter(s=>data[s]===null);
 const add=(source:SourceKey,row:DashboardRow,route:OwnerQueueItem['route'],groups:OwnerQueueArea[],title:string,detail:string,owner:string)=>{
  if(!groups.length)return;
  const id=stableId(row.id);
  if(!id){rejectedIdentityCount++;return;}
  gathered.push({key:source+':'+id,source,sourceId:id,title,detail,areas:Array.from(new Set(groups)),owner,
   site:label(row.site||row.siteName||row.customer)||null,dueAt:due(row),
   urgency:status(row.priority)==='high'||explicitOverdue(row.dueAt,now)?'high':'normal',
   route,jobId:source==='jobs'?id:null,
   evidenceUrl:evidence(row,['evidenceUrl','reportUrl','documentUrl','proofUrl']),
   photoUrl:evidence(row,['photoUrl','evidencePhotoUrl'])});
 };
 for(const row of data.tasks||[]){
  if(terminal.has(status(row.status)))continue;
  const d=department(row),groups:OwnerQueueArea[]=[];
  if(d)groups.push(d);
  if(explicitOverdue(row.dueAt,now))groups.push('overdue');
  if(missingPaper(row))groups.push('paperwork');
  add('tasks',row,'Owner Tasks',groups,value(row.title,'Assigned task'),value(row.instructions,'Review assigned work'),employee(row));
 }
 for(const row of data.jobs||[]){
  if(terminal.has(status(row.status)))continue;
  const state=status(row.status),d=department(row),groups:OwnerQueueArea[]=[];
  const flagged=row.needsAttention===true||Boolean(row.goBack&&typeof row.goBack==='object'&&(row.goBack as DashboardRow).required===true);
  if(state==='owner review')groups.push('approval');
  if(flagged&&(label(row.customer)||label(row.site)||label(row.siteName)))groups.push('customers');
  if(flagged&&d)groups.push(d);
  if(explicitOverdue(row.dueAt,now))groups.push('overdue');
  if(missingPaper(row))groups.push('paperwork');
  add('jobs',row,state==='owner review'?'Owner Review':'Jobs',groups,
   value(row.jobNumber||row.customer,'COS job'),
   state==='owner review'?'Waiting for recorded Owner review':missingPaper(row)?'Saved Tech Check or paperwork is explicitly incomplete':'Saved job needs attention',
   state==='owner review'?'Owner':employee(row));
 }
 for(const [source,route,qualifies] of [
  ['quotes','Quotes',(r:DashboardRow)=>status(r.status)==='pending owner approval'],
  ['invoices','Invoices',(r:DashboardRow)=>status(r.status)==='pending owner approval'],
  ['pos','Purchasing',(r:DashboardRow)=>status(r.status)==='pending owner po approval'||status(r.status)==='needs review'||status(r.match)==='exception'],
 ] as const){
  for(const row of data[source]||[]){
   if(!qualifies(row))continue;
   const reference=source==='quotes'?row.quoteNumber:source==='invoices'?row.invoiceNumber:row.poNumber||row.po;
   add(source,row,route,['approval'],value(reference||row.title,source==='pos'?'Purchasing review':source==='quotes'?'Quote approval':'Invoice approval'),
    'Approval or exception recorded in '+route,'Owner');
  }
 }
 const seen=new Set<string>(),items=gathered.filter(x=>{if(seen.has(x.key)){rejectedIdentityCount++;return false;}seen.add(x.key);return true;});
 items.sort((a,b)=>Number(b.urgency==='high')-Number(a.urgency==='high')||
  Number(b.areas.includes('approval'))-Number(a.areas.includes('approval'))||a.title.localeCompare(b.title));
 const required:Record<OwnerQueueArea,SourceKey[]>={
  approval:['jobs','quotes','invoices','pos'],it:['jobs','tasks'],service:['jobs','tasks'],
  customers:['jobs'],overdue:['jobs','tasks'],paperwork:['jobs','tasks']
 };
 const counts={} as Record<OwnerQueueArea,OwnerQueueCount>;
 for(const area of areas){
  const sourceComplete=required[area].every(s=>data[s]!==null)&&rejectedIdentityCount===0;
  counts[area]={observed:items.filter(x=>x.areas.includes(area)).length,
   sourceComplete,complete:false,coverageNote:coverageGaps[area]};
 }
 return {items,counts,sourceUnavailable,rejectedIdentityCount};
}
