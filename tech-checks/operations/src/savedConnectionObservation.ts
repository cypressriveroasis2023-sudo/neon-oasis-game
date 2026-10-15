import {serviceState,type CameraRow,type EvidenceState} from './cameraEvidence';

/** A recorded network response stays evidence even when inventory placement disagrees. */
export function savedConnectionObservation(row:CameraRow,now=Date.now()):EvidenceState {
  return serviceState(row,now);
}
