import {cameraTime} from './fieldCameraHealth';
import {cameraTimestamp} from './cameraEvidence';
import type {LastKnownCamera} from './cameraLastKnown';

/** Neutral historical text, deliberately without online/offline color classes. */
export default function LastKnownCameraStatus({observation,now}:{observation:LastKnownCamera|null;now:number}){
 if(!observation||!cameraTimestamp(observation.oldestObservedAt,now).at||!cameraTimestamp(observation.observedAt,now).at)return null;
 const range=observation.oldestObservedAt!==observation.observedAt;
 return <small className='camera-last-known' role='note'>Last known {observation.label} · {range?'Source observations: ':'Observed: '}{cameraTime(observation.oldestObservedAt,now)}{range?' to '+cameraTime(observation.observedAt,now):''}. {cameraTimestamp(observation.oldestObservedAt,now).fresh?'Saved historical evidence':'Stale saved evidence'}; current status unverified.</small>;
}
