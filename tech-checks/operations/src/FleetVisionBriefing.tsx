import {useId,useMemo,useRef,useState} from 'react';
import type {FleetCommandCenterData,FleetCommandProduct} from './fleetCommandCenterModel';
import {productHealthLabel} from './FieldProductEvidence';
import './fleetVisionBriefing.css';

type Focus='offline'|'unverified'|'location';
type Props={data:FleetCommandCenterData|null;readingAt:number|null;retained:boolean;onOpen:(product:FleetCommandProduct)=>void;onMap:()=>void;onHealth:()=>void};
const time=(value:number|string|null)=>value!==null&&Number.isFinite(new Date(value).getTime())
 ?new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})
 :'No completed reading recorded';
const observed=(product:FleetCommandProduct)=>{
 const value=product.linked?.evidence?.observedAt;
 return typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
};

/** Presentation only. All identities, health classifications and observations
 * come from the existing verified Product-ID model. This component has no API. */
export default function FleetVisionBriefing({data,readingAt,retained,onOpen,onMap,onHealth}:Props){
 const [focus,setFocus]=useState<Focus>('offline'),[expanded,setExpanded]=useState(false),[query,setQuery]=useState('');
 const listId=useId(),priorityButtons=useRef<Record<Focus,HTMLButtonElement|null>>({offline:null,unverified:null,location:null});
 const retainedResults=Boolean(data&&retained);
 const matches=useMemo(()=>{
  const term=query.trim().toLocaleLowerCase();
  return (data?.items||[]).filter(product=>(focus==='location'?product.mappingIssue:product.status===focus)
   &&(!term||[product.unitNumber,product.productId,product.customer,product.address].join(' ').toLocaleLowerCase().includes(term)))
   .sort((a,b)=>a.unitNumber.localeCompare(b.unitNumber,undefined,{numeric:true})||a.productId.localeCompare(b.productId));
 },[data,focus,query]);
 const options:Array<{key:Focus;title:string;count:number|null;note:string}>=[
  {key:'offline',title:'Recorded offline',count:data?.counts.offline??null,note:'Saved offline observations'},
  {key:'unverified',title:'Needs verification',count:data?.counts.unverified??null,note:'Unknowns and identity holds'},
  {key:'location',title:'Location follow-up',count:data?.addressCoverage?.missing??null,note:'Field products without a map point'},
 ];
 const choose=(next:Focus)=>{setFocus(next);setExpanded(true);setQuery('');};
 const close=()=>{setExpanded(false);priorityButtons.current[focus]?.focus();};
 return <section className="cos-vision-brief" aria-label="VISION Field briefing">
  <div className="cos-vision-brief-lead">
   <div className="cos-vision-brief-kicker"><span aria-hidden="true">◉</span> VISION <i/> FIELD BRIEF</div>
   <h2>A clear view of what needs you.</h2>
   <p>Start with recorded outages. Keep unknowns and location follow-ups in their own queues.</p>
   <div className="cos-vision-reading"><span className={retainedResults?'cos-vision-reading-retained':''}/><strong>{!data?'Awaiting saved fleet readings':retainedResults?'Saved results retained':'Saved fleet readings'}</strong><small>{readingAt===null?'Observation times stay with each unit':time(readingAt)}</small></div>
  </div>
  <div className="cos-vision-priorities" aria-label="Field attention queues">
   {options.map(item=><button key={item.key} ref={node=>{priorityButtons.current[item.key]=node;}} type="button" className={'cos-vision-priority cos-vision-priority-'+item.key} disabled={item.count===null} aria-expanded={expanded&&focus===item.key} aria-controls={listId} onClick={()=>choose(item.key)}>
    <span>{item.title}</span><strong>{item.count===null?'—':item.count}</strong><small>{item.note}</small><b aria-hidden="true">↗</b>
   </button>)}
  </div>
  {!data&&<p className="cos-vision-brief-empty" role="status">The briefing will appear when the saved Field inventory is verified.</p>}
  {expanded&&data&&<section id={listId} className="cos-vision-attention" aria-label="VISION attention list">
   <header><div><h3>{options.find(item=>item.key===focus)?.title}</h3><p>{matches.length} Field Product {matches.length===1?'ID':'IDs'} · {focus==='offline'?'Source evidence; video status is separate.':focus==='unverified'?'Review the evidence before treating a unit as an outage.':'Address evidence is separate from connectivity.'}</p></div><button type="button" aria-label="Close VISION attention list" onClick={close}>Close ×</button></header>
   <label className="cos-vision-attention-search">Find in this queue<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Unit, Product ID, customer or address"/></label>
   <div className="cos-vision-attention-rows">
    {matches.slice(0,8).map(product=><button type="button" className="cos-vision-attention-row" key={product.productId} aria-label={'Review '+product.unitNumber+' Product '+product.productId} aria-describedby={listId+'-customer-'+product.productId+' '+listId+'-evidence-'+product.productId} onClick={()=>onOpen(product)}>
     <span className={'cos-vision-attention-dot cos-vision-attention-dot-'+product.status}/>
     <span className="cos-vision-attention-unit"><strong>{product.unitNumber}</strong><small id={listId+'-customer-'+product.productId}>Product {product.productId} · {product.customer||'Customer not recorded'}</small></span>
     <span className="cos-vision-attention-evidence" id={listId+'-evidence-'+product.productId}><strong>{focus==='location'?'Map point needed':productHealthLabel(product.status,product.linked?.evidence)}</strong><small>{product.address||'Address not recorded'}</small><small>{observed(product)?'Observed '+time(observed(product)):'No attributable observation'}</small></span>
     <span aria-hidden="true">→</span>
    </button>)}
    {!matches.length&&<p className="cos-vision-brief-empty">{query?'No equipment matches this search.':focus==='offline'?'No recorded offline Field products in this saved reading.':focus==='unverified'?'No Field products awaiting verification in this saved reading.':'No missing map points in this saved address layer.'}</p>}
   </div>
   {matches.length>8&&<p className="cos-vision-attention-more">Showing the first 8 of {matches.length}. Search this queue to find a specific Product ID.</p>}
   <footer><span>Shop and support equipment stay outside camera outage totals.</span><button type="button" onClick={onMap}>Open field map ↓</button><button type="button" onClick={onHealth}>Open fleet health →</button></footer>
  </section>}
 </section>;
}
