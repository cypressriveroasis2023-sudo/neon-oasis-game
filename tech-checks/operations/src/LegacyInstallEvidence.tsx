import {useCallback,useEffect,useRef,useState} from 'react';
import {api,openLegacy} from './api';
import {checkedLegacyInstallEvidence,legacyDispositionLabels,type LegacyInstallSnapshot} from './legacyInstallEvidenceData';
const when=(value:string|null)=>value?new Date(value).toLocaleString():'Not recorded';
export default function LegacyInstallEvidence(){
  const [data,setData]=useState<LegacyInstallSnapshot|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const revision=useRef(0),active=useRef(false),busy=useRef(false),expiry=useRef<ReturnType<typeof setTimeout>|null>(null);
  const clear=useCallback(()=>{revision.current++;busy.current=false;if(expiry.current)clearTimeout(expiry.current);expiry.current=null;setData(null);setLoading(false);setError('');},[]);
  const load=useCallback(async()=>{
    if(busy.current||!active.current)return;
    clear();busy.current=true;const request=++revision.current;setLoading(true);
    try{
      const next=checkedLegacyInstallEvidence((await api.get('/api/owner-review/legacy-evidence')).data);
      if(!active.current||request!==revision.current)return;
      setData(next);expiry.current=setTimeout(()=>{clear();setError('Evidence closed after one minute. Reload to check current access and saved status.');},60000);
    }catch{if(active.current&&request===revision.current){setData(null);setError('Legacy evidence is unavailable. Refresh to verify the saved records.');}}
    finally{if(active.current&&request===revision.current){busy.current=false;setLoading(false);}}
  },[clear]);
  useEffect(()=>{
    active.current=true;void load();
    const hide=()=>{if(document.visibilityState==='hidden')clear();};
    const authChanged=()=>{clear();setError('Legacy evidence is unavailable. Reload to verify current Owner access.');};
    const parentHidden=(event:MessageEvent)=>{if(window.parent!==window&&event.source===window.parent&&event.origin===location.origin&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')clear();};
    window.addEventListener('cos-private-data-invalidated',authChanged);window.addEventListener('message',parentHidden);window.addEventListener('pagehide',clear);document.addEventListener('visibilitychange',hide);
    return()=>{active.current=false;revision.current++;busy.current=false;if(expiry.current)clearTimeout(expiry.current);window.removeEventListener('cos-private-data-invalidated',authChanged);window.removeEventListener('message',parentHidden);window.removeEventListener('pagehide',clear);document.removeEventListener('visibilitychange',hide);};
  },[load,clear]);
  return <section className='legacy-install-evidence quote-card' aria-label='Legacy installation evidence' aria-busy={loading}>
    <div className='panelhead'><div><h2>IT → Service evidence</h2><p>Saved Tech Check records across all equipment families. Latest 10 recent records within 30 days.</p></div><div className='purchase-actions'><button type='button' className='secondary' disabled={loading} onClick={()=>void load()}>{loading?'Reading evidence…':data?'Refresh evidence':'Load recent evidence'}</button>{(data||loading)&&<button type='button' className='secondary' onClick={clear}>Close evidence</button>}</div></div>
    <p>Read-only. Review the technician’s completed work and installed equipment, then choose Ready for Billing or another appropriate status in mHelpDesk. You make that decision; this view does not change the mHelpDesk status.</p>
    {error&&<p role='alert'>{error}</p>}
    {data&&<><small>Snapshot {when(data.generatedAt)} · Times shown in your device timezone</small>{data.hasMore&&<p role='status'>More recent records exist. This is a bounded evidence view; use existing Tech Check review for the complete queue.</p>}{data.items.length===0&&<p role='status'>No recent saved handoff or Helios field submissions were found in this window.</p>}
      {data.items.map(record=><article className='audit-mini' key={record.prepId} aria-label={'Legacy ticket '+record.ticketNumber}>
        <h3>mHelpDesk #{record.ticketNumber} · {record.siteLabel}</h3>
        <p>{record.historical?'Historical preparation':record.fieldCompletedAt?'Helios field submission recorded':'Saved preparation / handoff evidence'} · Last saved completion {when(record.recordedAt)}</p>
        <p>{record.ownerVerifiedAt?'Helios Owner verification recorded '+when(record.ownerVerifiedAt):record.fieldCompletedAt?'Service installation submitted · Ops verification pending.':record.readyForOwnerReview?'Legacy workflow ready for Ops review; installation evidence still needs review.':'Review saved evidence in existing Owner Tech Checks.'}</p>
        {record.blockers.length>0&&<ul>{record.blockers.map(text=><li key={text}>{text}</li>)}</ul>}
        {record.units.map(unit=><div className='legacy-install-unit' key={unit.itemId}><strong>{unit.family} · {unit.unitTag} · {unit.purpose}</strong><span>{legacyDispositionLabels[unit.disposition]}</span><small>IT verification {when(unit.itVerifiedAt)} · Service receipt {when(unit.serviceReceiptAt)}</small><small>Saved IT checks: {unit.itChecks.map(check=>check.name+': '+(check.passed?'yes':'not confirmed')).join(' · ')}</small>{unit.rangerFieldUpdateAt&&<small>Ranger field Victron update {when(unit.rangerFieldUpdateAt)}. This alone does not confirm completed installation.</small>}</div>)}
        <details><summary>Saved checklist and evidence counts</summary>{record.heliosChecks.map(check=><small key={check.name}>{check.passed?'✓':'Not confirmed:'} {check.name}</small>)}{record.evidence.map(e=><p key={e.stage}>{e.stage==='it'?'IT handoff':e.stage==='service'?'Service receipt':'Helios final installation'}: {e.photos} photos · {e.signatures} signatures{e.signedAt?' · latest signature '+when(e.signedAt):''}</p>)}<small>Photos and signatures remain in the existing authenticated Tech Check viewer.</small></details>
        <p>{record.fieldMapNote}</p>
      </article>)}
    </>}
    <button type='button' className='secondary' onClick={()=>{clear();openLegacy('review');}}>Open existing Owner Tech Check review</button>
  </section>;
}
