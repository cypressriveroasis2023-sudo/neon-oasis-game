import { useCallback, useEffect, useRef, useState } from 'react';
import { readITAssignments, type ITAssignmentInfo } from './itMhelpBridge';

export default function ITAssignmentQueue() {
  const [snapshot, setSnapshot] = useState<ITAssignmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const active = useRef(false), sequence = useRef(0), pending = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    if (!active.current || pending.current !== null) return;
    const request = ++sequence.current;
    pending.current = request;
    setSnapshot(null); setLoading(true); setError('');
    try {
      const next = await readITAssignments();
      if (active.current && request === sequence.current) setSnapshot(next);
    } catch (cause) {
      if (active.current && request === sequence.current) setError(cause instanceof Error ? cause.message : 'IT assignments are unavailable. Refresh the queue to try again.');
    } finally {
      if (request === sequence.current) { pending.current = null; if (active.current) setLoading(false); }
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const connection = ++sequence.current;
    queueMicrotask(() => { if (active.current && connection === sequence.current) void refresh(); });
    return () => { active.current = false; sequence.current += 1; pending.current = null; };
  }, [refresh]);
  const items = snapshot?.items || [], query = search.trim().toLocaleLowerCase();
  const visible = items.filter(item => [item.ticketNumber, item.site, item.workType, item.scheduledFor, item.scheduledTime, item.status,
    item.audience === 'mine' ? 'Assigned to you' : 'Unclaimed IT department queue', item.unitSummary, ...item.equipment].some(value => value.toLocaleLowerCase().includes(query)));
  return <section className='it-assignment-queue' aria-label='Your IT assignments and department queue'>
    <header className='it-mhelp-header'><h3>Your IT assignments and department queue</h3><button className='secondary' type='button' disabled={loading} onClick={() => void refresh()}>{loading ? 'Loading queue…' : 'Refresh IT queue'}</button></header>
    <p className='it-mhelp-notice'>Your assigned or started IT work and unclaimed IT department work from Tech Checks, including tickets without a Ticket Lead. These records do not establish whether a ticket was imported from mHelpDesk. Continue in Tech Checks to review original instructions and select equipment when needed.</p>
    <label className='it-assignment-search'>Search IT assignments<input type='search' value={search} onChange={event => setSearch(event.target.value)} placeholder='Ticket, site, type or recorded equipment' /></label>
    {loading ? <p className='it-mhelp-state' role='status'>Loading your current IT assignments…</p> : error ? <p className='it-mhelp-state it-mhelp-error' role='alert'>{error}</p> : snapshot && <>
      <p className='it-mhelp-caption' role='status'>{visible.length} of {items.length} assignments · {items.filter(item => item.audience === 'mine').length} assigned to you · {items.filter(item => item.audience === 'department').length} in department queue · Read {new Date(snapshot.generatedAt).toLocaleString()}</p>
      {items.length === 0 ? <p className='it-mhelp-state'>No active IT assignments were returned for you or the unclaimed department queue.</p> : visible.length === 0 ? <p className='it-mhelp-state'>No IT assignments match this search.</p> : <div className='it-mhelp-list'>
        {visible.map(item => <article className='it-mhelp-ticket it-assignment-ticket' key={item.assignmentId} aria-label={'IT assignment ' + item.ticketNumber}>
          <header><h4>Ticket #{item.ticketNumber}</h4><span className='it-mhelp-status'>{item.status === 'started' ? 'Started' : 'Assigned'}</span></header>
          <p>{item.site || 'Site not recorded'}</p>
          <dl><div><dt>Assignment</dt><dd>{item.audience === 'mine' ? 'Assigned to you' : 'Unclaimed IT department queue'}</dd></div><div><dt>Work type</dt><dd>{item.workType || 'Not recorded'}</dd></div><div><dt>Scheduled date</dt><dd>{item.scheduledFor ? new Date(item.scheduledFor + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not scheduled'}</dd></div><div><dt>Scheduled time</dt><dd>{item.scheduledTime ? item.scheduledTime.slice(0, 5) + ' · as recorded' : 'Not recorded'}</dd></div></dl>
          <div className='it-mhelp-equipment'><b>Recorded equipment</b>{item.equipment.length ? <ul>{item.equipment.map((equipment, index) => <li key={index}>{equipment}</li>)}</ul> : <p>Equipment not yet specified. Review the original instructions in Tech Checks before selecting a unit.</p>}{item.unitSummary && <p className='it-assignment-unit-summary'><b>Recorded unit summary:</b> {item.unitSummary}</p>}</div>
        </article>)}
      </div>}
    </>}
  </section>;
}
