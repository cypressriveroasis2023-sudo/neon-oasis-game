import {fieldEvidenceGapLabels,type FieldProductEvidence as Evidence} from './fieldProductEvidence';
import {cameraTime} from './fieldCameraHealth';

export function productHealthLabel(status:string,evidence?:Evidence){
 if((status==='online'||status==='offline')&&evidence?.basis){
  const online=status==='online';
  return evidence.basis==='connection'?(online?'Port reachable':'Port failed'):evidence.basis==='recorder'?(online?'Recorder online':'Recorder offline'):evidence.basis==='camera'?(online?'Camera records online':'Camera records offline'):(online?'Provider online':'Provider offline');
 }
 return status==='unverified'&&evidence?.gap?fieldEvidenceGapLabels[evidence.gap]:({online:'Online',offline:'Offline',unverified:'No current reading',not_applicable:'No camera'}[status]||status);
}
export default function FieldProductEvidence({value,now}:{value?:Evidence;now:number}){
 if(!value)return <p>No current reading. Source evidence is unavailable.</p>;
 return <section aria-label='Product health evidence'>
  {value.gap&&<p><strong>{fieldEvidenceGapLabels[value.gap]}</strong></p>}
  <p>{value.association?'Reviewed device association: '+value.association.replaceAll('_',' ')+'.':'No reviewed provider-resource association.'} Live video and recording are not verified by these connection observations. Power telemetry is shown separately.</p>
  {value.observations.length>0?<ul>{value.observations.map((o,i)=><li key={o.resourceId+'-'+o.kind+'-'+i}>
   {o.source} · {o.kind} · resource {o.resourceId} · {o.fresh?'Current':'Stale / invalid time'} · reported {o.reportedStatus} · observed {cameraTime(o.observedAt,now)}
  </li>)}</ul>:<p>No attributable source observation is available for this Product ID.</p>}
 </section>;
}
