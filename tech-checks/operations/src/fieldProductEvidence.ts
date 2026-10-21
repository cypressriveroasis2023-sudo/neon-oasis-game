import {cameraTimestamp,providerState,cameraState} from './cameraEvidence';
import {savedConnectionObservation} from './savedConnectionObservation';
import type {FleetDashboardRow} from './fleetDashboardModel';
import type {FieldProduct} from './mhelpFieldHealth';

export type FieldEvidenceGap='device_link_needed'|'no_current_reading'|'incomplete_check'|'inactive'|'not_applicable'|null;
export const fieldEvidenceGapLabels={device_link_needed:'Device link needed',no_current_reading:'No current reading',incomplete_check:'Incomplete check',inactive:'Inactive source record',not_applicable:'No camera / support'};
export type FieldProductEvidence={
 gap:FieldEvidenceGap;
 association:string|null;
 basis:string|null;
 observedAt:string|null;
 video:'not_verified';
 observations:{resourceId:string;source:string;kind:string;observedAt:string|null;fresh:boolean;reportedStatus:string;currentState:string}[];
};
/** Only the classifier's complete reviewed resource set supplies product health.
 * Never infer a device link from a product label, IP, address or provider family.
 * Source times remain source times; a successful saved read cannot renew them. */
export function fieldProductEvidence(row:FleetDashboardRow|null,state:string,now=Date.now()):FieldProductEvidence{
 const camera=row?.camera,linked=Boolean(camera?.association);
 const observations:FieldProductEvidence['observations']=[];
 if(linked)for(const resource of camera!.rows){
  for(const [kind,evidence] of [['provider',resource.evidence],['connection',resource.serviceEvidence]] as const){
   if(!evidence||evidence.kind==='unknown')continue;
   const stamp=cameraTimestamp(evidence.observedAt,now);
   observations.push({resourceId:String(resource.id),source:evidence.source,
    kind:kind==='connection'?'connection':evidence.resource||'unknown',observedAt:stamp.at,fresh:stamp.fresh,
    reportedStatus:evidence.status,currentState:kind==='connection'?savedConnectionObservation(resource,now):evidence.resource==='camera'||evidence.resource==='detector'?cameraState(resource,now):providerState(resource,now)});
  }
 }
 const basis=camera?.basis||null;
 const selected=observations.filter(o=>basis==='connection'?o.kind==='connection':basis==='recorder'?o.kind==='recorder':basis==='camera'?['camera','detector'].includes(o.kind):o.kind!=='connection');
 const gap:FieldEvidenceGap=state==='support'?'not_applicable':state==='inactive'?'inactive':state==='review'||state==='unlinked'||!linked?'device_link_needed':state==='online'||state==='offline'?null:selected.some(o=>o.fresh)?'incomplete_check':'no_current_reading';
 return {gap,association:linked?camera!.association!.kind:null,basis:linked?basis:null,
  observedAt:linked?cameraTimestamp(camera!.checkedAt,now).at:null,video:'not_verified',observations};
}

/** One audit row per Product ID, including every distinct attributed resource.
 * No endpoint, SIM, credential or guessed provider association is exported. */
export function fieldProductEvidenceCsv(items:FieldProduct[],sourceSha256:string,sourceAt:string){
 if(!/^[a-f0-9]{64}$/.test(sourceSha256)||new Set(items.map(p=>p.productId)).size!==items.length)throw Error('Field audit Product IDs or source checksum are invalid.');
 const cell=(v:unknown)=>{const s=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';};
 return ['Product ID,Unit,Placement,Inventory source SHA256,Inventory observed,Health state,Evidence gap,Association,Observation basis,Health observed,Resource observations,Reason,Video and recording,Power telemetry',...items.map(p=>[p.productId,p.unitNumber,'FIELD',sourceSha256,sourceAt,p.state,p.evidence?.gap?fieldEvidenceGapLabels[p.evidence.gap]:'',p.evidence?.association,p.evidence?.basis,p.evidence?.observedAt,JSON.stringify(p.evidence?.observations||[]),p.reason,'Not verified by connection observations','Separate telemetry'].map(cell).join(','))].join('\r\n');
}
