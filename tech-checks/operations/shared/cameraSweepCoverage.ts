/** Sweep coverage is monitor evidence, never a count of current product outages. */
export const sweepHoldLabels={identity_unverified:'Identity unverified',monitoring_disabled:'Monitoring disabled',ownership_unverified:'Ownership unverified',retired_or_not_in_use:'Retired / not in use',saved_endpoint_unavailable:'Saved endpoint unavailable',lifecycle_unverified:'Lifecycle unverified'};
export type CameraSweepCoverage={contract:'COS_CAMERA_SWEEP_COVERAGE_V1';source:'owned_saved_service_ports';observedAt:string;complete:boolean;eligible:number;scanned:number;published:number;held:number;heldReasons:{reason:keyof typeof sweepHoldLabels;count:number}[]};
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=10000;
export function projectCameraSweepCoverage(rows:Record<string,any>[]):CameraSweepCoverage|null{
 const matches=rows.filter(r=>r.provider==='avigilon');if(matches.length!==1)return null;
 const r=matches[0],m=r.sweep??{source:r.sweep_source,complete:r.sweep_complete,counts_known:r.sweep_counts_known,eligible:r.sweep_eligible,scanned:r.sweep_scanned,published:r.sweep_published,held:r.sweep_held,reconciled_at:r.sweep_reconciled_at,held_reasons:r.sweep_held_reasons};
 if(r.enabled!==true||!['ok','partial'].includes(r.last_sync_status)||!m||m.source!=='owned_saved_service_ports'||m.counts_known!==true||typeof m.complete!=='boolean'||['eligible','scanned','published','held'].some(k=>!count(m[k]))||m.published>m.scanned||m.scanned>m.eligible||typeof r.last_sync_at!=='string'||!Number.isFinite(Date.parse(r.last_sync_at))||typeof m.reconciled_at!=='string'||Date.parse(m.reconciled_at)!==Date.parse(r.last_sync_at)||!m.held_reasons||typeof m.held_reasons!=='object'||Array.isArray(m.held_reasons))return null;
 const heldReasons:CameraSweepCoverage['heldReasons']=[];
 for(const [reason,value]of Object.entries(m.held_reasons)){
  if(!Object.hasOwn(sweepHoldLabels,reason)||!count(value))return null;
  heldReasons.push({reason:reason as keyof typeof sweepHoldLabels,count:value});
 }
 if(heldReasons.reduce((n,r)=>n+r.count,0)!==m.held)return null;
 const complete=m.complete&&r.last_sync_status==='ok'&&m.held===0&&m.published===m.eligible;
 return {contract:'COS_CAMERA_SWEEP_COVERAGE_V1',source:'owned_saved_service_ports',observedAt:new Date(r.last_sync_at).toISOString(),complete,eligible:m.eligible,scanned:m.scanned,published:m.published,held:m.held,heldReasons};
}
/** Browser boundary accepts only the narrow projection, never provider metadata. */
export function readCameraSweepCoverage(value:unknown):CameraSweepCoverage|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as CameraSweepCoverage;
 if(v.contract!=='COS_CAMERA_SWEEP_COVERAGE_V1'||v.source!=='owned_saved_service_ports'||!Array.isArray(v.heldReasons)||v.heldReasons.length>6||v.heldReasons.some(r=>!r||typeof r!=='object'))return null;
 const mapped=projectCameraSweepCoverage([{provider:'avigilon',enabled:true,last_sync_status:v.complete?'ok':'partial',last_sync_at:v.observedAt,sweep:{source:v.source,counts_known:true,complete:v.complete,eligible:v.eligible,scanned:v.scanned,published:v.published,held:v.held,reconciled_at:v.observedAt,held_reasons:Object.fromEntries(v.heldReasons.map(r=>[r.reason,r.count]))}}]);
 if(!mapped||new Set(v.heldReasons.map(r=>r.reason)).size!==v.heldReasons.length||mapped.complete!==v.complete)return null;
 return mapped;
}
