import {cameraTimestamp,type CameraRow,type EvidenceState} from './cameraEvidence';

/** A recorded network response stays evidence even when inventory placement disagrees. */
export function savedConnectionObservation(row:CameraRow,now=Date.now()):EvidenceState {
  const evidence=row.serviceEvidence||(row.evidence?.kind==='service_port'?row.evidence:undefined);
  if(evidence?.kind!=='service_port'||!cameraTimestamp(evidence.observedAt,now).fresh)return 'verifying';
  if(evidence.status==='online'&&evidence.reachable===true)return 'online';
  if(evidence.status==='offline'&&evidence.reachable!==true&&(evidence.confirmedOutage===true||Number.isInteger(evidence.consecutiveFailures)&&Number(evidence.consecutiveFailures)>=3))return 'offline';
  return evidence.status==='degraded'&&evidence.reachable===true?'degraded':'verifying';
}
