import {useMemo,useState} from 'react';
import {buildFleetCommandCenter,fleetVerificationBlockers,type FleetCommandStatus,type FleetCommandProduct} from './fleetCommandCenterModel';
import type {ProviderProduct} from './mhelpProviderFleet';
import type {FieldProduct} from './mhelpFieldHealth';
import type {FleetDashboardRow} from './fleetDashboardModel';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';
import './fleetCommandCenter.css';

type Props={
 uploadInventory:unknown;
 fieldHealth:{total:number;items:FieldProduct[]}|null;
 healthReadSucceeded:boolean;
 rows:FleetDashboardRow[];
 addressMap:MhelpAddressMapResult|null;
 vrm:unknown;
 now:number;
 cameraCheckedAt:string|null;
 onOpen:(product:ProviderProduct)=>void;
 onShop:()=>void;
 onMap:()=>void;
 onImport:()=>void;
 onRefresh:()=>void;
};
type StatusFilter='all'|FleetCommandStatus;
type FamilyFilter='all'|'star4live'|'avigilon'|'reconeyez'|'victron'|'support'|'walle'|'other';
type FocusFilter='all'|'attention'|'mapping'|'link_review';
const names:Record<FleetCommandStatus,string>={online:'Online',offline:'Offline',unverified:'Unverified',not_applicable:'No camera'};
const date=(time:string|null)=>time&&Number.isFinite(Date.parse(time))
 ?new Date(time).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})
 :'No successful check recorded';

/** Single-line verification explanation; every count refers to source Product IDs.
 * These are blockers, not additional offline cameras. */
function verificationSummary(products:FleetCommandProduct[]):string{
 const blockers=fleetVerificationBlockers(products);
 return [
  blockers.identity?blockers.identity+' need COS equipment association':'',
  blockers.provider?blockers.provider+' need a conclusive provider / power observation':'',
  blockers.inactive?blockers.inactive+' flagged inactive in mHelp':''
 ].filter(Boolean).join(' · ');
}

export default function FleetCommandCenter({
 uploadInventory,fieldHealth,healthReadSucceeded,rows,addressMap,vrm,now,cameraCheckedAt,
 onOpen,onShop,onMap,onImport,onRefresh
}:Props){
 const [query,setQuery]=useState(''),[family,setFamily]=useState<FamilyFilter>('all');
 const [status,setStatus]=useState<StatusFilter>('all'),[limit,setLimit]=useState(35),[selectedId,setSelectedId]=useState(''),[focus,setFocus]=useState<FocusFilter>('all');
 const data=useMemo(()=>buildFleetCommandCenter(
   uploadInventory,fieldHealth,healthReadSucceeded,rows,addressMap,vrm,now,cameraCheckedAt),
   [uploadInventory,fieldHealth,healthReadSucceeded,rows,addressMap,vrm,now,cameraCheckedAt]);
 const entries=useMemo(()=>{
  if(!data)return [];
  const source=family==='victron'?data.panels.find(p=>p.key==='victron')?.products||[]:data.items.filter(p=>family==='all'||p.system===family);
  const term=query.trim().toLowerCase();
  return source.filter(p=>(status==='all'||p.status===status)
   &&(focus==='all'||focus==='attention'&&(p.status==='offline'||p.status==='unverified'||p.mappingIssue)
     ||focus==='mapping'&&p.mappingIssue
     ||focus==='link_review'&&Boolean(p.linked&&['unlinked','review'].includes(p.linked.state)))&&(
    !term||[p.unitNumber,p.productId,p.customer,p.address,p.category,p.provider,p.site]
     .join(' ').toLowerCase().includes(term)));
 },[data,family,status,query,focus]);
 const selected=entries.find(p=>p.productId===selectedId);
 if(!data)return <p className="cos-command-source-warning" role="status">
  Complete, verified mHelpDesk Product-ID source is currently unavailable. No inventory or provider totals are being estimated.
  <button type="button" onClick={onRefresh}>Retry saved data</button>
 </p>;
 const filter=(next:FamilyFilter,state:StatusFilter='all')=>{
  setFamily(next);setStatus(state);setLimit(35);setSelectedId('');setFocus('all');
  document.getElementById('cos-command-product-list')?.scrollIntoView({block:'nearest'});
 };
 const cameraTotal=data.counts.online+data.counts.offline+data.counts.unverified;
 const linkReview=data.healthVerified?data.items.filter(p=>p.linked&&['unlinked','review'].includes(p.linked.state)).length:null;
 const showFocus=(next:FocusFilter)=>{setFamily('all');setStatus('all');setFocus(next);setSelectedId('');setLimit(35);document.getElementById('cos-command-product-list')?.scrollIntoView({block:'nearest'});};
 return <section className="cos-fleet-command" aria-label="Complete mHelpDesk Fleet command center">
  <header className="cos-command-head">
   <div><h2>Fleet command center</h2><p>All {data.field} Field Product IDs · camera, power and placement shown separately</p></div>
   <button type="button" onClick={onRefresh}>↻ Refresh saved evidence</button>
  </header>
  {data.sourceStale&&<p role="status" className="cos-command-source-warning">mHelpDesk source refresh is delayed. These are the last validated assignments, not a live provider read.</p>}
  {!data.healthVerified&&<p role="status" className="cos-command-source-warning">Camera Health is incomplete or its latest read failed. Camera-capable units are Unverified, not automatically Offline.</p>}
  <div className="cos-command-kpis" aria-label="Full equipment and camera summary">
   <button type="button" onClick={()=>filter('all')}><span>Field equipment</span><strong>{data.field}</strong><small>All recorded Field products</small></button>
   <button type="button" className="cos-command-positive" onClick={()=>filter('all','online')}><span>Online linked equipment</span><strong>{data.counts.online}</strong><small>Saved camera / connection observations</small></button>
   <button type="button" className="cos-command-negative" onClick={()=>filter('all','offline')}><span>Offline linked equipment</span><strong>{data.counts.offline}</strong><small>Only verified recent outage evidence</small></button>
   <button type="button" className="cos-command-muted" onClick={()=>filter('all','unverified')}><span>Camera status unverified</span><strong>{data.counts.unverified}</strong><small>Unknown, missing or stale observations</small></button>
   <button type="button" onClick={onShop}><span>Shop / ROOT</span><strong>{data.shop}</strong><small>Excluded from Field map</small></button>
   <button type="button" onClick={()=>filter('all')}><span>Total COS inventory</span><strong>{data.total}</strong><small>Field + Shop · unique Product IDs</small></button>
  </div>
  <div className="cos-command-provider-grid" aria-label="Four independently reported monitoring systems">
   {data.panels.map(panel=><article key={panel.key} className={'cos-command-provider cos-command-provider-'+panel.key}>
    <div className="cos-command-provider-title">
     <div><h3>{panel.title}</h3><small>{panel.count===null?'Provider count unavailable':panel.count+' associated Field equipment'}</small></div>
     <strong>{panel.count===null?'—':panel.count}</strong>
    </div>
    <div className="cos-command-provider-states">
     {(['online','offline','unverified'] as const).map(state=><button key={state} type="button"
       className={'cos-command-status-'+state} disabled={panel.counts===null}
       onClick={()=>filter(panel.key,state)}>
       <strong>{panel.counts?.[state]??'—'}</strong><small>{names[state]}</small>
     </button>)}
    </div>
    <p className="cos-command-provider-time">{panel.key==='victron'?'Last successful VRM sync:':'Last saved Camera Health read:'} {date(panel.lastCheck)}</p>
    <p className="cos-command-provider-note">{panel.counts?.unverified
      ?(!data.healthVerified&&panel.key!=='victron'?'Camera Health read unavailable; reload saved evidence before assigning a cause.':verificationSummary(panel.products))
      :panel.note}</p>
    <button type="button" className="cos-command-all-provider" onClick={()=>filter(panel.key)}>View {panel.title} units →</button>
   </article>)}
  </div>
  <div className="cos-command-metadata">
   <span><b>Physical inventory:</b> {data.field} Field + {data.shop} Shop = {data.total} products</span>
   <span><b>Camera-capable:</b> {cameraTotal} · <b>Solar/support without cameras:</b> {data.counts.support}</span>
   <span><b>mHelp source:</b> {date(data.sourceAt)}</span>
   <span><b>Camera Health:</b> {data.healthVerified?date(cameraCheckedAt):'Unverified — read unavailable'}</span>
   <span><b>Address map:</b> {data.addressCoverage?data.addressCoverage.located+' located · '+data.addressCoverage.missing+' needing mapping':'No validated map coverage snapshot'}</span>
  </div>
  <div className="cos-command-attention-actions" aria-label="Support equipment and Field issues">
   <button type="button" onClick={()=>filter('support','not_applicable')}><strong>{data.counts.support}</strong><span>Support equipment · no cameras</span></button>
   <button type="button" disabled={linkReview===null} onClick={()=>showFocus('link_review')}><strong>{linkReview??'—'}</strong><span>Camera identities to review</span></button>
   <button type="button" onClick={()=>showFocus('attention')}><strong>{data.counts.attention}</strong><span>Needs attention · includes unknowns, not necessarily outages</span></button>
   <button type="button" disabled={!data.addressCoverage} onClick={()=>showFocus('mapping')}><strong>{data.addressCoverage?.missing??'—'}</strong><span>Map address lookups needed</span></button>
  </div>
  <section id="cos-command-product-list" className="cos-command-inventory" aria-label="Every Field Product ID and connectivity status">
   <div className="cos-command-list-head">
    <div><h3>Field inventory</h3><p>{entries.length} of {data.field} Field Product IDs in this view · 1 product = 1 equipment record</p></div>
    <div className="cos-command-list-actions">
     <button type="button" onClick={onMap}>View map ↓</button>
     <button type="button" onClick={onImport}>mHelpDesk CSV / sync →</button>
    </div>
   </div>
   <div className="cos-command-filters">
    <label>Find equipment, Product ID, customer or address
     <input aria-label="Search all Field Product IDs" type="search" value={query} placeholder="Unit, Product ID, customer or address…" onChange={e=>{setQuery(e.target.value);setLimit(35);}}/>
    </label>
    <label>System
     <select aria-label="Filter all Field products by monitoring system" value={family} onChange={e=>filter(e.target.value as FamilyFilter,status)}>
      <option value="all">All Field equipment</option><option value="avigilon">Avigilon</option><option value="star4live">Star4Live</option>
      <option value="reconeyez">Recon / Recon II</option><option value="victron">Victron / Helios</option>
      <option value="support">Solar stand / support</option><option value="walle">Wall-E</option><option value="other">Other</option>
     </select>
    </label>
    <label>Connectivity
     <select aria-label="Filter all Field products by connectivity status" value={status} onChange={e=>{setStatus(e.target.value as StatusFilter);setFocus('all');setLimit(35);}}>
      <option value="all">All health states</option><option value="online">Online</option><option value="offline">Offline</option>
      <option value="unverified">Unverified</option><option value="not_applicable">No camera / support</option>
     </select>
    </label>
    <button type="button" onClick={()=>{setFamily('all');setStatus('all');setFocus('all');setSelectedId('');setQuery('');setLimit(35);}}>Clear filters</button>
   </div>
   <div className="cos-command-rows">
    {entries.slice(0,limit).map(p=><button type="button" className="cos-command-row" key={p.productId} aria-expanded={selectedId===p.productId} onClick={()=>setSelectedId(p.productId)}>
     <span className={'cos-command-dot cos-command-dot-'+p.status} aria-hidden="true">●</span>
     <span className="cos-command-row-main"><strong>{p.unitNumber}</strong><small>Product {p.productId} · {p.category||'Unclassified'}</small>
      <small>{p.customer||'Customer not supplied'}{p.address?' · '+p.address:''}</small>
      {p.mappingIssue&&<small className="cos-command-issue">Address pin needs mapping — remains in Field inventory</small>}
     </span>
     <span className={'cos-command-status-pill cos-command-pill-'+p.status}>{names[p.status]}</span>
     <span className="cos-command-arrow" aria-hidden="true">›</span>
    </button>)}
    {!entries.length&&<p className="cos-command-empty">No Field products match these filters. No equipment has been removed.</p>}
   </div>
   {selected&&<section className="cos-command-product-detail" role="region" aria-label="Selected Field equipment details">
    <div className="cos-command-detail-head"><div><h4>{selected.unitNumber}</h4><p>Product {selected.productId} · {selected.category} · {selected.provider}</p></div><button type="button" onClick={()=>setSelectedId('')}>Close details ×</button></div>
    <dl><div><dt>Customer</dt><dd>{selected.customer||'Not supplied'}</dd></div><div><dt>Recorded service address</dt><dd>{selected.address||'Not supplied'}</dd></div><div><dt>Source placement</dt><dd>FIELD · mHelpDesk</dd></div><div><dt>Connectivity</dt><dd>{names[selected.status]}</dd></div><div><dt>Camera identity</dt><dd>{selected.linked?.unitId?'Reviewed COS unit association':selected.linked?.recordId?'Source equipment record only':'No verified camera association'}</dd></div><div><dt>Map location</dt><dd>{selected.mappingIssue?'Customer address needs mapping':'Source address lookup not flagged'}</dd></div></dl>
    <p>{selected.reason}</p>
    {(selected.linked?.unitId||selected.linked?.recordId)&&<button type="button" onClick={()=>onOpen(selected)}>Open COS unit and diagnostics →</button>}
    {!selected.linked?.unitId&&!selected.linked?.recordId&&<p>Camera troubleshooting is held until an exact Product-ID association is verified. This equipment remains visible in Field inventory.</p>}
   </section>}
   {entries.length>limit&&<button className="cos-command-more" type="button" onClick={()=>setLimit(v=>v+50)}>Show next {Math.min(50,entries.length-limit)} products ({entries.length-limit} remaining)</button>}
  </section>
  <p className="cos-command-disclaimer">System panels report saved, verified associations. Equipment-family assignments do not establish that a provider is reachable. A single Helios unit may appear in both Star4Live and Victron but counts once in physical inventory. Camera video, router reachability, Victron battery telemetry and manual Tracker LIVE STATUS are separate signals.</p>
 </section>;
}
