import { useCallback, useEffect, useRef, useState } from 'react';
import { openLegacy } from './api';
import { readITMhelpInfo, type ITMhelpInfo } from './itMhelpBridge';
import './itMhelpWorkspace.css';

function dateLabel(value: string) {
  return value ? new Date(value + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not scheduled';
}

export default function ITMhelpWorkspace() {
  const [snapshot, setSnapshot] = useState<ITMhelpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [workType, setWorkType] = useState('all');
  const [date, setDate] = useState('');
  const active = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    setSnapshot(null);
    try {
      const next = await readITMhelpInfo();
      if (active.current && request === sequence.current) setSnapshot(next);
    } catch (cause) {
      if (active.current && request === sequence.current) setError(cause instanceof Error ? cause.message : 'MHelp references are unavailable. Please refresh.');
    } finally {
      if (active.current && request === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    return () => { active.current = false; sequence.current += 1; };
  }, [refresh]);
  const items = snapshot?.items || [];
  const types = [...new Set(items.map(item => item.workType).filter(Boolean))].sort();
  const query = search.trim().toLocaleLowerCase();
  const visible = items.filter(item => (status === 'all' || item.finished === (status === 'finished')) &&
    (workType === 'all' || item.workType === workType) && (!date || item.scheduledFor === date) &&
    [item.ticketNumber, item.site, item.workType, item.scheduledFor, item.scheduledTime, ...item.equipment,
      item.finished ? 'finished complete' : 'open work'].some(value => value.toLocaleLowerCase().includes(query)));
  const hasFilter = Boolean(query || status !== 'all' || workType !== 'all' || date);
  const resetFilters = () => { setSearch(''); setStatus('all'); setWorkType('all'); setDate(''); };
  return <section className='panel module it-mhelp-workspace' aria-label='MHelp information'>
    <header className='panelhead it-mhelp-header'>
      <div><p className='it-mhelp-eyebrow'>EXISTING TECH CHECK REFERENCES</p><h2>MHelp info</h2></div>
      <button className='secondary' type='button' onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh references'}</button>
    </header>
    <p className='it-mhelp-notice'>Read-only MHelpDesk references from your existing Tech Check tickets where you are Ticket Lead. This is not a live mHelp API sync. Completion below refers to Tech Check stages, not MHelpDesk billing or ticket status.</p>
    <div className='it-mhelp-summary' aria-live='polite'>
      <div><strong>{snapshot ? items.length : '—'}</strong><span>Ticket references</span></div>
      <div><strong>{snapshot ? items.filter(item => !item.finished).length : '—'}</strong><span>Open Tech Check work</span></div>
      <div><strong>{snapshot ? items.filter(item => item.finished).length : '—'}</strong><span>Tech Check work finished</span></div>
    </div>
    <div className='it-mhelp-toolbar'>
      <label>Search references<input type='search' value={search} onChange={event => setSearch(event.target.value)} placeholder='Ticket, site, type or equipment' /></label>
      <label>Tech Check status<select value={status} onChange={event => setStatus(event.target.value)}><option value='all'>All statuses</option><option value='open'>Open work</option><option value='finished'>Finished work</option></select></label>
      <label>Work type<select value={workType} onChange={event => setWorkType(event.target.value)}><option value='all'>All types</option>{workType !== 'all' && !types.includes(workType) && <option value={workType}>{workType} (not in current references)</option>}{types.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Scheduled date<input type='date' value={date} onChange={event => setDate(event.target.value)} /></label>
      {hasFilter && <button type='button' className='secondary' onClick={resetFilters}>Clear filters</button>}
    </div>
    {loading ? <p className='it-mhelp-state' role='status'>Loading your current Ticket Lead references…</p> : error ? <p className='it-mhelp-state it-mhelp-error' role='alert'>{error}</p> : snapshot && <>
      <p className='it-mhelp-caption' role='status'>{visible.length} of {items.length} references · Read {new Date(snapshot.generatedAt).toLocaleString()}</p>
      {items.length === 0 ? <p className='it-mhelp-state'>No MHelp references were returned for your current Ticket Lead tickets.</p> : visible.length === 0 ? <p className='it-mhelp-state'>No references match these filters.</p> : <div className='it-mhelp-list'>
        {visible.map(item => <article className='it-mhelp-ticket' key={item.ticketNumber} aria-label={'MHelpDesk reference ' + item.ticketNumber}>
          <header><h3>MHelpDesk #{item.ticketNumber}</h3><span className={'it-mhelp-status ' + (item.finished ? 'is-finished' : '')}>{item.finished ? 'Tech Check finished' : 'Open Tech Check work'}</span></header>
          <h4>{item.site || 'Site not recorded'}</h4>
          <dl><div><dt>Work type</dt><dd>{item.workType || 'Not recorded'}</dd></div><div><dt>Scheduled date</dt><dd>{dateLabel(item.scheduledFor)}</dd></div><div><dt>Scheduled time</dt><dd>{item.scheduledTime ? item.scheduledTime.slice(0, 5) + ' · as recorded' : 'Not recorded'}</dd></div></dl>
          <div className='it-mhelp-equipment'><b>Recorded equipment</b>{item.equipment.length ? <ul>{item.equipment.map((equipment, index) => <li key={index}>{equipment}</li>)}</ul> : <p>No equipment listed.</p>}</div>
        </article>)}
      </div>}
    </>}
    <footer className='it-mhelp-footer'><p>Continue checklists and review the original work in Tech Checks.</p><button type='button' onClick={() => openLegacy('it')}>Open existing IT Tech Checks →</button></footer>
  </section>;
}
