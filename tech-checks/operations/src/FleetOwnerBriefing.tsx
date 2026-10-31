import {useEffect,useRef} from 'react';
import type {FleetCommandCenterData} from './fleetCommandCenterModel';

type Props={data:FleetCommandCenterData|null;onEvidence:()=>void;onLocations:()=>void;onUnverified:()=>void};
const count=(value:number|null|undefined)=>value??'Unavailable';
const time=(value:string|undefined)=>value&&Number.isFinite(Date.parse(value))
 ?new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})
 :'Unavailable';

/** Read-only presentation of the existing validated Product-ID model.
 * No new reads, inferred provider acceptance, approvals or persisted notes. */
export default function FleetOwnerBriefing({data,onEvidence,onLocations,onUnverified}:Props){
 const dialog=useRef<HTMLDialogElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const close=()=>dialog.current?.close();window.addEventListener('popstate',close);return()=>window.removeEventListener('popstate',close);},[]);
 const health=data?.healthVerified===true;
 return <section className="cos-vision-focus" aria-label="Owner fleet focus">
  <header><div><span className="cos-vision-eyebrow">OWNER FOCUS</span><h2>Evidence before the next step.</h2><p>Review the source, the signal and what remains unverified.</p></div>
   <button type="button" className="cos-vision-primary" ref={trigger} onClick={()=>dialog.current?.showModal()}>Owner briefing ↗</button>
  </header>
  <div className="cos-vision-decisions">
   <button type="button" onClick={onUnverified}><span className="cos-vision-decision-icon" aria-hidden="true">?</span><small>CONNECTIVITY</small><h3>Review unverified equipment</h3><p>{health?`${data.counts.unverified} Field products have unverified camera connectivity.`:'Current camera connectivity totals are unavailable.'} Missing evidence is not an outage.</p><b>Open unverified units →</b></button>
   <button type="button" onClick={onLocations}><span className="cos-vision-decision-icon" aria-hidden="true">⌖</span><small>LOCATION</small><h3>Check the installation evidence</h3><p>Recorded customer addresses and estimates remain separate from verified installation locations.</p><b>Open location review →</b></button>
   <button type="button" onClick={onEvidence}><span className="cos-vision-decision-icon" aria-hidden="true">≡</span><small>SAVED SOURCES</small><h3>Trace a status to its source</h3><p>Compare camera, router and power evidence. A reachable router does not confirm camera video or monitoring acceptance.</p><b>Review saved evidence →</b></button>
  </div>
  <dialog className="cos-vision-briefing" ref={dialog} aria-labelledby="cos-vision-briefing-title" onClose={()=>trigger.current?.focus()} onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();}}}>
   <div className="cos-vision-modal-head"><span className="cos-vision-eyebrow">OWNER BRIEFING · SAVED EVIDENCE</span><button type="button" aria-label="Close owner briefing" onClick={()=>dialog.current?.close()}>×</button></div>
   <h2 id="cos-vision-briefing-title">Your fleet, at a glance.</h2>
   <dl className="cos-vision-briefing-counts"><div><dt>Field equipment</dt><dd>{count(data?.field)}</dd></div><div><dt>Shop / ROOT</dt><dd>{count(data?.shop)}</dd></div><div><dt>Total Product IDs</dt><dd>{count(data?.total)}</dd></div></dl>
   <p>Inventory source: {time(data?.sourceAt)}.{data?.sourceStale?' Refresh delayed; these are saved assignments.':''}</p>
   {!data&&<p role="status">The complete Product-ID inventory is unavailable. No fleet totals are estimated.</p>}
   <ol><li><strong>Check the connectivity evidence.</strong><p>{health?`${data.counts.online} online · ${data.counts.offline} offline · ${data.counts.unverified} unverified · ${data.counts.support} support equipment without cameras.`:'Current health is unavailable. Refresh saved evidence before drawing a connectivity conclusion.'} These are equipment observations, not individual camera-channel or video acceptance counts.</p></li>
    <li><strong>Keep locations and health separate.</strong><p>{data?.addressCoverage?`${data.addressCoverage.located} Field products have address pins; ${data.addressCoverage.missing} need address mapping.`:'Validated Field address coverage is unavailable.'} An address pin does not verify the installation.</p></li>
    <li><strong>Confirm each operational handoff.</strong><p>Monitoring acceptance, technician completion, owner approval and billing readiness are not established by this fleet view. Review their original records. Reported work remains separate from confirmed approval.</p></li></ol>
   <p className="cos-vision-boundary">Viewing this briefing records no review decision, monitoring restart, dispatch or billing approval.</p>
   <button type="button" className="cos-vision-primary" onClick={()=>dialog.current?.close()}>Back to fleet</button>
  </dialog>
 </section>;
}
