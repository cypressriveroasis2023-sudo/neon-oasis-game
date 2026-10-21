import {readCameraSweepCoverage,sweepHoldLabels} from '../shared/cameraSweepCoverage';
import {cameraTimestamp} from './cameraEvidence';
import {cameraTime} from './fieldCameraHealth';
export default function CameraSweepCoverage({value,now}:{value:unknown;now:number}){
 const coverage=readCameraSweepCoverage(value);if(!coverage)return null;
 const fresh=cameraTimestamp(coverage.observedAt,now).fresh;
 return <details className='cos-fleet-count-note' aria-label='Avigilon sweep coverage'>
  <summary>Avigilon connection check · {!fresh?'No current sweep reading':coverage.complete?'Complete check':'Incomplete check'} · {coverage.held} held records</summary>
  <p>Observed {cameraTime(coverage.observedAt,now)}. {coverage.published} published of {coverage.eligible} eligible saved service endpoints; {coverage.scanned} scanned. These are source records, not Field Product-ID or camera outage totals.</p>
  <ul>{coverage.heldReasons.filter(r=>r.count>0).map(r=><li key={r.reason}>{sweepHoldLabels[r.reason]}: {r.count}</li>)}</ul>
  <p>Held records have no result from this sweep. A partial sweep does not establish an outage. Current Product-ID health requires its own reviewed device link and fresh observation; live video, recording and power remain separate.</p>
 </details>;
}
