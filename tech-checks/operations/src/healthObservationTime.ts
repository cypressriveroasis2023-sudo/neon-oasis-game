import {cameraTimestamp,cameraRecord,providerRecord,providerState,cameraState,resourceKind,type CameraRow} from './cameraEvidence';
import {savedConnectionObservation} from './savedConnectionObservation';

export type HealthObservationBasis='camera'|'connection'|'recorder'|'provider';
// Keep the same source precedence as savedConnectionObservation; never fall back past a saved result.
const connectionEvidence=(row:CameraRow)=>row.serviceEvidence||(row.evidence?.kind==='service_port'?row.evidence:undefined);

/** Display provenance only. Callers retain their existing classification and placement rules. */
export function healthObservationTime(rows:CameraRow[],basis:HealthObservationBasis,state:string,now=Date.now()):string|null {
  const candidates=rows.filter(row=>basis==='connection'?connectionEvidence(row)?.kind==='service_port':
    providerRecord(row)&&typeof row.activationState==='string'&&row.activationState.trim().toUpperCase()==='ACTIVE'&&row.evidence?.active===true&&
    (basis==='camera'?cameraRecord(row):basis==='recorder'?resourceKind(row)==='recorders':true));
  // An online sibling must not date an outage. Mixed/unverified groups retain their latest valid source time.
  const supporting=state==='online'||state==='offline'?candidates.filter(row=>
    (basis==='connection'?savedConnectionObservation(row,now):basis==='camera'?cameraState(row,now):providerState(row,now))===state):candidates;
  const dates=supporting.map(row=>basis==='connection'?connectionEvidence(row)?.observedAt:row.evidence?.observedAt)
    .map(value=>cameraTimestamp(value,now).at).filter((value):value is string=>Boolean(value)).sort();
  return dates.at(-1)||null;
}

export function healthObservationLabel(basis?:HealthObservationBasis,state?:string):string {
  const source=basis?{camera:'camera/detector',connection:'IP / port',recorder:'recorder',provider:'provider'}[basis]:'source';
  return 'Latest '+(state==='online'||state==='offline'?state+' ':'')+source+' record observation';
}
