import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api as operationsApi } from './api';
import { availableFinanceDecisions, checkedFinanceDetail, checkedFinanceList, createFinanceDecisionSaver, financeDecisionLabels, financeDetailMatchesRow, financeMoney, financePath, financeStatus, type FinanceApi, type FinanceDecision, type FinanceKind, type FinanceRecord } from './financePersistence';
import './financeWorkspaces.css';

type Props = { show: (message: string) => void; api?: FinanceApi; referenceUrl?: string };
const defaultReference = 'https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/';
const labels: Record<FinanceKind, string> = { quotes: 'Quotes', invoices: 'Invoices', purchasing: 'Purchasing' };
const text = (value: unknown) => value == null ? '—' : String(value);
const reference = (kind: FinanceKind, row: FinanceRecord) => text(kind === 'quotes' ? row.quoteNumber : kind === 'invoices' ? row.invoiceNumber : row.po || row.poNumber);
const context = (kind: FinanceKind, row: FinanceRecord) => [kind === 'purchasing' ? row.vendor || row.vendorName : row.customer || row.customerName, row.site || row.siteName, row.jobNumber || row.job].filter(Boolean).join(' · ');
const descriptions: Record<FinanceKind, string> = {
  quotes: 'Owner quote approval · return decisions',
  invoices: 'Invoice records · Owner approval · issuing',
  purchasing: 'Purchase requests · three-way matching · AP approval',
};
const features: Record<FinanceKind, string[]> = {
  quotes: ['Quote builder', 'Customer acceptance', 'Quote documents'],
  invoices: ['Invoice creation and charge review', 'Customer payments', 'Invoice documents'],
  purchasing: ['Purchase order builder', 'Receiving and vendor invoices', 'Vendor payments and documents'],
};
function RecordDetails({ kind, row }: { kind: FinanceKind; row: FinanceRecord }) {
  const fields = kind === 'quotes'
    ? [['Customer', row.customerName], ['Site', row.siteName], ['Issue date', row.issueDate], ['Valid until', row.validUntil], ['Revision', row.revision], ['Total', financeMoney(row.total ?? row.amount)]]
    : kind === 'invoices'
      ? [['Customer', row.customerName || row.customer], ['Billing email', row.billingEmail], ['Issue date', row.issueDate], ['Due date', row.dueDate], ['Total', financeMoney(row.total ?? row.amount)], ['Amount due', financeMoney(row.amountDue)]]
      : [['Vendor', row.vendorName || row.vendor], ['Vendor email', row.vendorEmail], ['Job', row.jobNumber || row.job], ['Purpose', row.purpose], ['Total', financeMoney(row.total ?? row.amount)], ['Receiving', row.receiptStatus || row.receipt], ['Vendor invoice', row.invoiceNumber || row.invoice], ['Match', row.match]];
  return <div className='finance-record-content'>
    <dl className='finance-detail-fields'>{fields.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{text(value)}</dd></div>)}</dl>
    {(row.title || row.scope || row.description || row.notes || row.terms) && <section><h3>Record notes and terms</h3>{[row.title, row.scope, row.description, row.notes, row.terms].filter(Boolean).map((value, index) => <p className='finance-note' key={index}>{text(value)}</p>)}</section>}
    {Array.isArray(row.lines) && <section><h3>Line items</h3>{row.lines.length ? <div className='finance-lines'>{row.lines.map((line: FinanceRecord, index: number) => <article key={line.id || index}><strong>{text(line.name || line.description)}</strong>{line.name && line.description && <p>{text(line.description)}</p>}<span>{text(line.quantity)} {text(line.unit || 'each')} × {financeMoney(line.unitPrice)}</span><b>{financeMoney(line.total ?? line.amount ?? (typeof line.quantity === 'number' && typeof line.unitPrice === 'number' ? line.quantity * line.unitPrice : null))}</b></article>)}</div> : <p>No line items in this record.</p>}</section>}
    {Array.isArray(row.activity) && <section><h3>Activity</h3>{row.activity.length ? row.activity.map((entry: unknown, index: number) => <p key={index}>{typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? [text((entry as FinanceRecord).at || (entry as FinanceRecord).createdAt), text((entry as FinanceRecord).action || (entry as FinanceRecord).eventType), text((entry as FinanceRecord).note || (entry as FinanceRecord).notes)].join(' · ') : text(entry)}</p>) : <p>No activity in the returned record.</p>}</section>}
    {Array.isArray(row.payments) && <section><h3>Recorded payments</h3>{row.payments.length ? row.payments.map((payment: FinanceRecord, index: number) => <p key={payment.id || index}>{financeMoney(payment.amount)} · {text(payment.reference)} · {text(payment.paidAt || payment.recordedAt)}</p>) : <p>No payments in the returned record.</p>}</section>}
  </div>;
}
function FinanceWorkspace({ kind, show, api = operationsApi, referenceUrl = defaultReference }: Props & { kind: FinanceKind }) {
  const [rows, setRows] = useState<FinanceRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [tab, setTab] = useState(kind === 'purchasing' ? 'Purchase Requests' : 'All Records');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<FinanceRecord | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [decision, setDecision] = useState<FinanceDecision | ''>('');
  const [reason, setReason] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);
  const mounted = useRef(false);
  const revision = useRef(0);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const saver = useMemo(() => createFinanceDecisionSaver(api), [api]);
  const selected = rows?.find(row => row.id === selectedId) || null;
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true); setError('');
    if (selectedId) setDetail(null);
    try {
      const response = await api.get(financePath[kind]);
      const next = checkedFinanceList(response.data);
      if (!mounted.current || request !== revision.current) return;
      setRows(next); setSelectedId(current => next.some(row => row.id === current) ? current : '');
      saver.acknowledgeRefresh(response.data); setNeedsRefresh(false); setNotice('');
    } catch (cause) {
      if (mounted.current && request === revision.current) setError(cause instanceof Error ? cause.message : labels[kind] + ' could not be loaded.');
    } finally { if (mounted.current && request === revision.current) setLoading(false); }
  }, [api, kind, saver, selectedId]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; revision.current += 1; };
    // Selection does not start another list request; refresh controls reads.
  }, [api, kind, saver]);
  useEffect(() => {
    if (!selected) { setDetail(null); setDetailError(''); return; }
    let current = true;
    setDetail(null); setDetailError(''); setDetailLoading(true);
    api.get(financePath[kind] + '/' + selected.id).then(response => {
      const value = checkedFinanceDetail(response.data, selected.id);
      if (current) setDetail(value);
    }).catch(cause => {
      if (current) setDetailError(cause instanceof Error ? cause.message : 'Record details could not be loaded.');
    }).finally(() => { if (current) setDetailLoading(false); });
    return () => { current = false; };
  }, [api, kind, selected, detailRevision]);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  const close = () => { if (!saving) { setSelectedId(''); setDecision(''); setReason(''); setDetailError(''); } };
  const review = (row: FinanceRecord, action: FinanceDecision | '' = '') => {
    setSelectedId(row.id); setDecision(action); setReason(''); setDetailError(''); setError(''); setNotice('');
  };
  const save = async () => {
    if (!selected || !decision || !detail || detailLoading || loading || saver.busy || saver.needsRefresh) return;
    setSaving(true); setError(''); setNotice('');
    const baseline = selected;
    if (!financeDetailMatchesRow(kind, baseline, detail)) { setError('This record changed after the list loaded. Close the record and refresh before reviewing it.'); setSaving(false); return; }
    try {
      const result = await saver.save(kind, baseline, decision, reason);
      if (!mounted.current) return;
      if (result.status === 'confirmed') {
        revision.current += 1;
        setRows(result.rows); setDetail(result.detail); setDecision(''); setReason('');
        setNotice(financeDecisionLabels[decision] + ' saved and verified.');
        show(financeDecisionLabels[decision] + ' saved and verified.');
        window.dispatchEvent(new Event('cos-finance-updated'));
      } else if (result.status === 'unconfirmed' || result.status === 'accepted_unverified') {
        setNeedsRefresh(true); setError(result.message);
      } else if (result.status === 'refresh_required') {
        setNeedsRefresh(true); setError('Refresh this workspace before making another decision.');
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The decision could not be saved.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  const pending = (rows || []).filter(row => availableFinanceDecisions(kind, row).length > 0);
  const visible = (rows || []).filter(row => {
    const status = financeStatus(row.status);
    const group = tab === 'All Records' || tab === 'Purchase Orders' || tab === '3-Way Match' || tab === 'Pending Review' && availableFinanceDecisions(kind, row).length > 0 || tab === 'Purchase Requests' && ['pending owner po approval', 'purchase request returned'].includes(status) || tab === 'AP Approvals' && financeStatus(row.match) === 'matched';
    const search = [reference(kind, row), context(kind, row), row.title, row.status].filter(Boolean).join(' ').toLowerCase();
    return group && (!query.trim() || search.includes(query.trim().toLowerCase()));
  });
  const tabs = kind === 'purchasing' ? ['Purchase Requests', 'Purchase Orders', '3-Way Match', 'AP Approvals'] : ['All Records', 'Pending Review'];
  const actions = selected ? availableFinanceDecisions(kind, selected) : [];
  return <section className='panel module finance-workspace' aria-label={labels[kind] + ' review'}>
    <div className='panelhead'><div><h2>{labels[kind]}</h2><span>{descriptions[kind]}</span></div><button className='secondary' disabled={loading || saving} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh ' + labels[kind]}</button></div>
    <div className='purchase-actions'><span>{rows === null ? 'Record counts unavailable' : rows.length + ' records · ' + pending.length + ' ready for Owner review'}</span><label className='finance-search'>Search records<input aria-label={'Search ' + labels[kind]} type='search' value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <div className='tabs finance-tabs' aria-label={labels[kind] + ' filters'}>{tabs.map(name => <button key={name} className={tab === name ? 'selected' : ''} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    {error && <div className='operations-error' role='alert'>{rows ? 'Showing the last loaded records. ' : ''}{error}</div>}
    {notice && <p className='operations-notice' role='status'>{notice}</p>}
    {needsRefresh && <p role='status'>Refresh {labels[kind]} before making another decision.</p>}
    {rows === null && loading ? <p role='status'>Loading {labels[kind].toLowerCase()}…</p> : <div className='records finance-records'>{visible.map(row => <article className='record op-record' key={row.id}>
      <div><strong>{reference(kind, row)} · {kind === 'purchasing' ? text(row.vendor || row.vendorName) : text(row.customer || row.customerName)}</strong><small>{context(kind, row)} · {financeMoney(row.amount ?? row.total)}{kind === 'quotes' ? ' · Rev ' + text(row.revision) : ''}</small>{kind === 'purchasing' && tab === '3-Way Match' && <div className='finance-match'><span>PO: {financeMoney(row.amount)}</span><span>Receiving: {text(row.receipt)}</span><span>Vendor invoice: {text(row.invoice)} · {financeMoney(row.invoiceAmount)}</span><b>{text(row.match)}</b></div>}</div>
      <div className='row-actions'><em>{text(row.status)}</em><button className='secondary' disabled={saving} onClick={() => review(row)}>Open Record</button>{availableFinanceDecisions(kind, row).map(action => <button key={action} disabled={saving || loading || needsRefresh} className={action.startsWith('return') ? 'secondary' : ''} onClick={() => review(row, action)}>{financeDecisionLabels[action]}</button>)}</div>
    </article>)}{rows && visible.length === 0 && <p>No records match these filters in the loaded records.</p>}</div>}
    <div className='finance-feature-links'><h3>Additional {labels[kind].toLowerCase()} tools</h3><p>Select {labels[kind]} in AppDeploy to use these tools.</p>{features[kind].map(feature => <a key={feature} href={referenceUrl} target='_blank' rel='noopener noreferrer'>{feature} ↗</a>)}</div>
    {selected && <dialog ref={dialog} className='finance-detail-dialog' aria-label={labels[kind] + ' record'} onCancel={event => { if (saving) event.preventDefault(); else close(); }}><section>
      <div className='finance-detail-heading'><div><small>{labels[kind].toUpperCase()} RECORD</small><h2>{reference(kind, selected)}</h2><p>{context(kind, selected)}</p><strong>{text(detail?.status || selected.status)}</strong></div><button className='secondary' disabled={saving} onClick={close}>Close record</button></div>
      {detailLoading ? <p role='status'>Loading record details…</p> : detailError ? <div className='operations-error' role='alert'>{detailError}<button className='secondary' onClick={() => setDetailRevision(value => value + 1)}>Retry record details</button></div> : detail && <RecordDetails kind={kind} row={detail}/>}
      {error && <div className='operations-error' role='alert'>{error}</div>}
      {notice && <p className='operations-notice' role='status'>{notice}</p>}
      {actions.length > 0 && <div className='finance-review-actions'><h3>Owner decision</h3><label>Decision<select aria-label='Owner decision' disabled={saving || needsRefresh || !detail || detailLoading} value={decision} onChange={event => { setDecision(event.target.value as FinanceDecision | ''); setReason(''); }}><option value=''>Select decision</option>{actions.map(action => <option key={action} value={action}>{financeDecisionLabels[action]}</option>)}</select></label>{['return_quote', 'return_po'].includes(decision) && <label>Return reason<textarea disabled={saving || needsRefresh} value={reason} onChange={event => setReason(event.target.value)} maxLength={4000}/></label>}<button disabled={saving || loading || needsRefresh || !detail || detailLoading || !decision} onClick={() => void save()}>{saving ? 'Saving…' : decision ? financeDecisionLabels[decision] : 'Select decision'}</button>{needsRefresh && <p>Close this record and refresh {labels[kind]} before trying again.</p>}</div>}
    </section></dialog>}
  </section>;
}
export function QuotesWorkspace(props: Props) { return <FinanceWorkspace {...props} kind='quotes'/>; }
export function InvoicesWorkspace(props: Props) { return <FinanceWorkspace {...props} kind='invoices'/>; }
export function PurchasingWorkspace(props: Props) { return <FinanceWorkspace {...props} kind='purchasing'/>; }
