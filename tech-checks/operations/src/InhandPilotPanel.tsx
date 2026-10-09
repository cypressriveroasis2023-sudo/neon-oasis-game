import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { INHAND_TEST_NAME, inhandPilotControlState, parseInhandPilotControl, parseInhandPilotResult, type InhandPilotControl, type InhandPilotResult, type InhandPilotState } from '../shared/inhandPilot';
import './inhandPilot.css';

// Only two safety flags survive workspace navigation. Telemetry never enters this store.
// The existing host destroys this iframe when its authenticated owner/role changes.
let session = { busy: false, attempted: false };
const subscribers = new Set<() => void>();
const subscribe = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };
const getSession = () => session;
function updateSession(change: Partial<typeof session>) { session = { ...session, ...change }; subscribers.forEach(notify => notify()); }
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString() + ' (' + value + ')' : 'Not recorded';
const stateMessage: Record<InhandPilotState, string> = {
  unarmed: 'This one-run test is not armed yet. No InHand request was made. Check test status after it has been enabled.',
  ready: 'The one-run test is ready. Choose Test InHand connection to use it once.',
  expired: 'The test window has expired. No InHand request was made. A new test window needs to be authorized before testing.',
  consumed: 'This one-run test has already been used. It cannot be run again.',
};
const missingLocation = {
  missing: 'InHand did not return a location.',
  invalid_coordinates: 'InHand location coordinates could not be verified.',
  unverified_source: 'InHand location source was not the verified cellTower source.',
  invalid_timestamp: 'InHand location time was missing or invalid.',
};
export default function InhandPilotPanel() {
  const safety = useSyncExternalStore(subscribe, getSession);
  const [control, setControl] = useState<InhandPilotControl | null>(null);
  const [result, setResult] = useState<InhandPilotResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const clear = () => { sequence.current += 1; setControl(null); setResult(null); setMessage(''); setError(false); };
    const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
    const parentHidden = (event: MessageEvent) => {
      if (window.parent !== window && event.source === window.parent && event.origin === location.origin && event.data?.type === 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE') clear();
    };
    window.addEventListener('message', parentHidden);
    window.addEventListener('pagehide', clear);
    window.addEventListener('cos-workspace-navigation', clear);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      sequence.current += 1;
      window.removeEventListener('message', parentHidden);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('cos-workspace-navigation', clear);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  async function check(run: boolean) {
    if (session.busy || (run && session.attempted)) return;
    updateSession({ busy: true }); // Synchronous lock, before the first await or React render.
    const request = ++sequence.current;
    let submitted = false;
    setError(false); setMessage(run ? 'Checking the one-run test window…' : 'Checking test status…');
    setControl(null); setResult(null);
    const startedAt = performance.now();
    try {
      const response = await api.get<unknown>('/api/inhand-pilot/status');
      if (request !== sequence.current) return;
      const parsed = parseInhandPilotControl(response.data);
      const state = inhandPilotControlState(parsed, performance.now() - startedAt);
      setControl({ ...parsed, state });
      if (state === 'consumed') updateSession({ attempted: true });
      if (!run || state !== 'ready') {
        setMessage(state === 'ready' && session.attempted ? 'The server reported a ready window, but this app session has already submitted or observed a used test. It remains locked; no new test was run.' : stateMessage[state]);
        return;
      }
      updateSession({ attempted: true }); // An uncertain outcome must never permit a replay.
      submitted = true;
      setMessage('Running the one-use InHand connection test… Keep this page open until the result appears.');
      const snapshot = await api.post<unknown>('/api/inhand-pilot/run', {});
      if (request !== sequence.current) return;
      setResult(parseInhandPilotResult(snapshot.data, parsed.device));
      setMessage('InHand returned the verified device response. This one-run test is now locked.');
    } catch (cause) {
      if (request !== sequence.current) return;
      setControl(null); setResult(null); setError(true);
      const status = (cause as { response?: { status?: number } } | null)?.response?.status;
      const reason = status === 401 ? 'Your Owner sign-in could not be verified. Return to Tech Check and sign in again.' :
        status === 403 ? 'Your account does not have permission to run this Owner-only test.' :
        submitted ? 'The test result could not be confirmed.' : 'Test status could not be verified. No InHand request was made.';
      setMessage(reason + (submitted ? ' The test may have been consumed and remains locked. Check test status for safe metadata only; it will not retry the test.' : ''));
    } finally { updateSession({ busy: false }); }
  }
  return <section className='inhand-pilot' aria-label='One-run InHand connection test' aria-busy={safety.busy}>
    <div className='inhand-pilot-heading'><div><p className='inhand-pilot-eyebrow'>OWNER-ONLY · ONE-RUN TEST</p><h3>Connect to {INHAND_TEST_NAME}</h3></div><span className='inhand-pilot-tag'>Read-only device test</span></div>
    <p>Use the existing COS sign-in to check this router with InHand once. Nothing runs until you choose a button. This test does not change router settings or COS map locations.</p>
    {control && <p className='inhand-pilot-device'>Serial: {control.device.serialNumber}</p>}
    <div className='inhand-pilot-actions'>
      <button type='button' disabled={safety.busy || safety.attempted} onClick={() => void check(true)}>Test InHand connection</button>
      <button type='button' className='secondary' disabled={safety.busy} onClick={() => void check(false)}>Check test status</button>
    </div>
    <p className='inhand-pilot-caption'>Check test status reads the test window only. It does not contact InHand or use the one-run test.</p>
    {message && <p className={error ? 'inhand-pilot-message inhand-pilot-error' : 'inhand-pilot-message'} role={error ? 'alert' : 'status'}>{message}</p>}
    {safety.attempted && <p className='inhand-pilot-lock'>Test locked for this app session. Checking status or returning to this page cannot run it again.</p>}
    {control && <dl className='inhand-pilot-control'><div><dt>Test window</dt><dd>{control.state === 'ready' ? 'Ready at last check' : control.state === 'consumed' ? 'Already used' : control.state === 'expired' ? 'Expired' : 'Not armed'}</dd></div><div><dt>Status checked at</dt><dd>{formatTime(control.serverTime)}</dd></div>{control.expiresAt && <div><dt>Window expires</dt><dd>{formatTime(control.expiresAt)}</dd></div>}{control.attemptedAt && <div><dt>Attempt recorded</dt><dd>{formatTime(control.attemptedAt)}</dd></div>}</dl>}
    {result && <section className='inhand-pilot-result' aria-label='InHand test result'>
      <h4>Verified device response</h4><p className='inhand-pilot-caption'>Fetched {formatTime(result.fetchedAt)}. Fetch time is not the time of a connection or location observation.</p>
      <dl>
        <div><dt>Device name</dt><dd>{result.identity.name || 'Not reported'}</dd></div><div><dt>Device ID</dt><dd>{result.identity.deviceId}</dd></div><div><dt>Serial number</dt><dd>{result.identity.serialNumber}</dd></div>
        <div><dt>Provider-reported status</dt><dd>{result.connection.reportedStatus === 'online' ? 'Online' : result.connection.reportedStatus === 'offline' ? 'Offline' : 'Unknown'}</dd></div>
        <div><dt>Status observation time</dt><dd>Unknown</dd></div><div><dt>Status freshness</dt><dd>Unknown · not independently probed</dd></div>
        <div><dt>Public IP</dt><dd>{result.network.publicIp || 'Not reported'}</dd></div><div><dt>WAN IP</dt><dd>{result.network.wanIp || 'Not reported'}</dd></div><div><dt>Network record updated</dt><dd>{formatTime(result.network.infoUpdatedAt)}</dd></div>
      </dl>
      <h4>Cell-tower location</h4>
      {result.location ? <><dl><div><dt>Location source</dt><dd>cellTower (cell-tower estimate)</dd></div><div><dt>Coordinates</dt><dd>{result.location.latitude}, {result.location.longitude}</dd></div><div><dt>Location observed</dt><dd>{formatTime(result.location.observedAt)}</dd></div><div><dt>Location freshness at fetch</dt><dd>{result.location.freshness === 'stale' ? 'Stale · more than 10 minutes old' : 'Within 10 minutes at fetch; ages after this test'}</dd></div><div><dt>Accuracy</dt><dd>Not reported</dd></div><div><dt>Reported address</dt><dd>{result.location.address || 'Not reported'}</dd></div></dl></> : <p>{missingLocation[result.locationUnavailableReason || 'missing']}</p>}
      <p className='inhand-pilot-caption'>This is a cell-tower estimate, not live GPS. No COS unit mapping has been verified and no map pin was moved. Signal strength, SIM details, and live GPS are not provided by this test.</p>
    </section>}
  </section>;
}
