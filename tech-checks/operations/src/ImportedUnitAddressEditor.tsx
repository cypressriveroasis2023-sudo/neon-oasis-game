import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { addressUuid, checkedImportedAddress, importedAddressChanged, importedAddressDraft, importedAddressMatches, importedAddressPayload, importedAddressProblem, type ImportedAddressDraft, type ImportedAddressRecord } from './importedUnitAddress';
import './importedUnitAddress.css';

type Props = { unitId: string; enabled: boolean; show: (message: string) => void; onSaved: () => Promise<void>; onActivityChange?: (active: boolean) => void };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The unit address could not be verified.';

export default function ImportedUnitAddressEditor({ unitId, enabled, show, onSaved, onActivityChange }: Props) {
  const [record, setRecord] = useState<ImportedAddressRecord | null>(null);
  const [draft, setDraft] = useState<ImportedAddressDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const running = useRef(false);
  const live = useRef(true);
  const allowed = enabled && addressUuid(unitId);
  const path = '/api/field-map/' + unitId + '/address';
  const refresh = async () => {
    if (!allowed || running.current) return;
    const request = ++generation.current;
    setLoading(true); setRecord(null); setDraft(null); setConfirmed(false); setError(''); setNotice('');
    try {
      const fresh = checkedImportedAddress((await api.get(path)).data, unitId);
      if (live.current && request === generation.current) { setRecord(fresh); setNeedsRefresh(false); }
    } catch (cause) { if (live.current && request === generation.current) setError(message(cause)); }
    finally { if (live.current && request === generation.current) setLoading(false); }
  };
  useEffect(() => {
    live.current = true;
    if (allowed) void refresh();
    else { setRecord(null); setDraft(null); setConfirmed(false); }
    return () => { live.current = false; generation.current += 1; };
  }, [unitId, allowed]);
  useEffect(() => { onActivityChange?.(Boolean(draft || saving || loading)); return () => onActivityChange?.(false); }, [Boolean(draft), saving, loading, onActivityChange]);
  const cancel = () => { if (!running.current) { setDraft(null); setConfirmed(false); setNotice('Address edits canceled.'); } };
  const update = (key: keyof ImportedAddressDraft, value: string) => { setDraft(current => current ? { ...current, [key]: value } : current); setConfirmed(false); setNotice(''); };
  const changed = Boolean(record && draft && importedAddressChanged(record, draft));
  const problem = draft ? importedAddressProblem(draft) : '';
  const save = async () => {
    if (!allowed || running.current || loading || needsRefresh || !record || record.unitId !== unitId || !draft || !confirmed || !changed || problem) return;
    const payload = importedAddressPayload(record, draft, crypto.randomUUID(), confirmed);
    if (!payload) return;
    const request = ++generation.current;
    running.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const response = (await api.post(path, payload)).data;
      const receipt = checkedImportedAddress(response?.record, unitId);
      if (typeof response.changed !== 'boolean' || response.changed && !receipt.revision || !importedAddressMatches(receipt, draft)) throw new Error('The save response was incomplete.');
      const fresh = checkedImportedAddress((await api.get(path)).data, unitId);
      if (fresh.revision !== receipt.revision || fresh.sourceRevision !== receipt.sourceRevision || !importedAddressMatches(fresh, draft)) throw new Error('The address changed before the save could be verified.');
      await onSaved();
      if (live.current && request === generation.current) {
        setRecord(fresh); setDraft(null); setConfirmed(false); setNeedsRefresh(false);
        const text = fresh.unitNumber + (response.changed ? ' address correction saved and verified.' : ' address unchanged; current address verified.');
        setNotice(text); show(text);
      }
    } catch (cause) {
      if (live.current && request === generation.current) { setNeedsRefresh(true); setConfirmed(false); setError(message(cause) + ' Refresh the address and Field Map before saving again. The request will not be repeated automatically.'); }
    } finally { running.current = false; if (live.current && request === generation.current) setSaving(false); }
  };
  return <section className='imported-address-editor' aria-label='Imported unit address correction'>
    <h3>Unit address</h3>
    {!allowed ? <p role='status'>Address correction is available to an authorized Owner or verified IT technician when enabled for this backend.</p> : <>
      <p>Correct this unit’s installation address in COS. The Google tracker stays unchanged, and later imports preserve this app correction.</p>
      {loading && <p role='status'>Loading verified address details…</p>}
      {error && <p role='alert'>{error}</p>}
      {notice && <p role='status'>{notice}</p>}
      {record?.sourceConflict && <p className='imported-address-conflict' role='alert'>The source tracker has changed since the app correction. The app address is retained. Review the current placement and address before confirming another correction.</p>}
      {record && !draft && <>
        <dl><div><dt>Placement</dt><dd>{record.placement}</dd></div><div><dt>Street</dt><dd>{record.installation?.street || 'Not recorded'}</dd></div><div><dt>City</dt><dd>{record.installation?.city || 'Not recorded'}</dd></div><div><dt>State</dt><dd>{record.installation?.state || 'Not recorded'}</dd></div><div><dt>ZIP</dt><dd>{record.installation?.zip || 'Not recorded'}</dd></div><div><dt>Site label</dt><dd>{record.siteLabel || 'Not recorded'}</dd></div></dl>
        <button className='secondary' disabled={loading || saving || needsRefresh} onClick={() => { setDraft(importedAddressDraft(record)); setConfirmed(false); setNotice(''); }}>Edit unit address</button>
      </>}
      {record && draft && <div onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } }}>
        <label>Placement<select aria-label='Address placement' disabled={saving || loading || needsRefresh} value={draft.placement} onChange={event => update('placement', event.target.value)}><option value='FIELD'>Field</option><option value='SHOP'>Shop</option><option value='INACTIVE'>Inactive / Do not use</option></select></label>
        {draft.placement === 'FIELD' ? <>
          <label>Street<input aria-label='Installation street' autoComplete='off' maxLength={300} disabled={saving || loading || needsRefresh} value={draft.street} onChange={event => update('street', event.target.value)}/></label>
          <div className='imported-address-grid'><label>City<input aria-label='Installation city' autoComplete='off' maxLength={100} disabled={saving || loading || needsRefresh} value={draft.city} onChange={event => update('city', event.target.value)}/></label><label>State<input aria-label='Installation state' autoComplete='off' maxLength={2} disabled={saving || loading || needsRefresh} value={draft.state} onChange={event => update('state', event.target.value)}/></label><label>ZIP<input aria-label='Installation ZIP' autoComplete='off' inputMode='numeric' maxLength={10} disabled={saving || loading || needsRefresh} value={draft.zip} onChange={event => update('zip', event.target.value)}/></label></div>
          <p>After a changed address is saved, COS automatically queues a lookup using US Census and the shared free Geocodio allowance. Your entered address stays as entered. Any resulting pin is an unverified estimate, not live GPS.</p>
        </> : <p>{draft.placement === 'SHOP' ? 'Shop units' : 'Inactive units'} have no current field address or field pin. Saving clears the current installation address.</p>}
        <label>Site label (optional)<input aria-label='Installation site label' autoComplete='off' maxLength={250} disabled={saving || loading || needsRefresh} value={draft.siteLabel} onChange={event => update('siteLabel', event.target.value)}/></label>
        {problem && <p role='status'>{problem}</p>}
        {!changed && <p role='status'>No changes to save. No address lookup will be requested.</p>}
        <label className='imported-address-confirm'><input type='checkbox' disabled={!changed || Boolean(problem) || saving || loading || needsRefresh} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I reviewed {record.unitNumber} and confirm this placement and installation address correction.</label>
        <div className='field-map-actions'><button disabled={!changed || Boolean(problem) || !confirmed || saving || loading || needsRefresh} onClick={() => void save()}>{saving ? 'Saving address…' : 'Save address correction'}</button><button className='secondary' disabled={saving} onClick={cancel}>Cancel address edits</button></div>
      </div>}
      {record && <details><summary>Address correction history ({record.history.length})</summary>{record.history.length ? <ul>{record.history.map((row, index) => <li key={index}>{['FIELD','SHOP','INACTIVE'].includes(String(row.placement)) ? String(row.placement) : 'Address correction'} · {row.actorRole === 'owner' ? 'Owner' : row.actorRole === 'it' ? 'IT' : 'Authorized user'} · {typeof row.savedAt === 'string' && Number.isFinite(Date.parse(row.savedAt)) ? new Date(row.savedAt).toLocaleString() : 'Time unavailable'}</li>)}</ul> : <p>No app address corrections recorded.</p>}</details>}
      <button className='secondary imported-address-refresh' disabled={loading || saving} onClick={async () => { if (needsRefresh) { try { await onSaved(); } catch { setError('Field Map could not be refreshed. Retry before editing.'); return; } } await refresh(); }}>Refresh address</button>
    </>}
  </section>;
}
