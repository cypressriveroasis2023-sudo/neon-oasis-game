import {useState} from 'react';
import {SIM_CARRIERS, assessSimCancel, simCancelTodo, simLast4, type SimCancelRecord} from './simCancelChecklist';
import TechnicianTodoList from './TechnicianTodoList';
import './simCancelChecklist.css';

const EXAMPLE = { unit: 'SNIPER 014', productId: '900014' };

/** The cancellation step. Counts and the to-do stay on top. The full SIM
 * number is only in the open step. */
export default function SimCancelChecklist() {
  const [carrier, setCarrier] = useState('');
  const [canceledOn, setCanceledOn] = useState('');
  const [canceledBy, setCanceledBy] = useState('');
  const [simNumber, setSimNumber] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [noSim, setNoSim] = useState(false);
  const [noSimReason, setNoSimReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SimCancelRecord | null>(null);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(true);
  const todo = simCancelTodo(EXAMPLE);
  const waiting = done ? 0 : 1;
  const masked = saved?.simNumber ? simLast4(saved.simNumber) : '';

  const save = () => {
    const result = assessSimCancel({
      productId: EXAMPLE.productId,
      unit: EXAMPLE.unit,
      outcome: noSim ? 'no_sim' : 'canceled',
      carrier, canceledOn, canceledBy, confirmation,
      simNumber: noSim ? '' : simNumber,
      noSimReason,
    });
    if (!result.ok) { setSaved(null); setError(result.error); return; }
    setError('');
    setSaved(result.record);
  };

  return <main className='cos-sim-cancel' aria-label='SIM card canceled'>
    <p className='cos-sim-counts' role='group' aria-label='SIM cancellation counts'>
      <span>Waiting <b>{waiting}</b></span>
      <span>Done <b>{done ? 1 : 0}</b></span>
    </p>
    <TechnicianTodoList todos={done ? [] : [todo]} onOpen={() => setOpen(true)}/>
    <details className='cos-sim-about'>
      <summary>About this step</summary>
      <p>A pickup or cancellation stays incomplete until this step is saved. Lists and the board show the last four digits. The full SIM number stays on this step.</p>
    </details>
    {masked && <p className='cos-sim-board'>Board · Product {EXAMPLE.productId} · {masked}</p>}
    {saved?.outcome === 'no_sim' && <p className='cos-sim-board'>Board · Product {EXAMPLE.productId} · No SIM in this unit</p>}
    {open && <form className='cos-sim-step' aria-label='SIM card canceled step' onSubmit={event => { event.preventDefault(); save(); }}>
      <h2>SIM card canceled</h2>
      <p>{EXAMPLE.unit} · Product {EXAMPLE.productId}</p>
      <label>Carrier<select value={carrier} onChange={event => setCarrier(event.target.value)} disabled={noSim}>
        <option value=''>Choose</option>
        {SIM_CARRIERS.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <label>Date canceled<input type='date' value={canceledOn} onChange={event => setCanceledOn(event.target.value)} disabled={noSim}/></label>
      <label>Who canceled it<input value={canceledBy} onChange={event => setCanceledBy(event.target.value)} autoComplete='off'/></label>
      <label>SIM number<input value={simNumber} onChange={event => setSimNumber(event.target.value)} autoComplete='off' spellCheck={false} disabled={noSim} aria-label='SIM number'/></label>
      <label>Confirmation number or note, optional<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete='off'/></label>
      <label className='cos-sim-none'><input type='checkbox' checked={noSim} onChange={event => { setNoSim(event.target.checked); if (event.target.checked) setSimNumber(''); }}/> No SIM in this unit</label>
      {noSim && <label>Reason<input value={noSimReason} onChange={event => setNoSimReason(event.target.value)} autoComplete='off'/></label>}
      {error && <p role='alert'>{error}</p>}
      <button type='submit'>Save this step</button>
    </form>}
    <button type='button' disabled={!saved || done} onClick={() => setDone(true)}>Mark cancellation complete</button>
    {!saved && <p>This cancellation is not complete.</p>}
    {done && <p role='status'>Cancellation complete.</p>}
  </main>;
}
