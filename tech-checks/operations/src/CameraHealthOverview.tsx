import {useEffect,useMemo,useRef,useState} from 'react';
import {cameraCardLinks,cameraCardTimes,cameraIpEditLinks,unitCardPath} from './cameraCardActions';
import {savedConnectionObservation} from './savedConnectionObservation';
import {cameraOverview,resourceBreakdown,cameraFamily,cameraResourcePath,cameraUnitStatusLabel,cameraUnitDisplayState,healthWithFieldInventory,type CameraUnitGroup} from './cameraHealthCounts';
import {cameraColors,cameraTime,fieldCameraHealth,unitDiagnosticsPath,type Health,type FieldHealthUnit} from './fieldCameraHealth';
import {providerState,resourceKind,cameraEvidenceLabel,serviceEvidenceLabel,observationAge,type CameraRow,type UnitEvidence,type ReconBatteryEvidence} from './cameraEvidence';
type Props={health:Health;now:number;units:FieldHealthUnit[]|null;createTicket?:(type:'SERVICE'|'PICKUP'|'DELIVERY'|'SWAP',id:string)=>void;canEditPlacement?:boolean;canEditConnection?:boolean};
const statusColor=(state:string)=>state==='online'?cameraColors.online:state==='offline'?cameraColors.offline:state==='degraded'||state==='service'?'#f1c36d':cameraColors.unknown;
export function UnitEvidenceDetails({classification}:{classification:(UnitEvidence&{rows?:CameraRow[]})|null}){
  if(!classification)return null;
  return <div className='camera-unit-evidence'><p className={'camera-status-pill camera-status-'+cameraUnitDisplayState(classification)} style={{color:statusColor(cameraUnitDisplayState(classification))}}>{cameraUnitStatusLabel(classification)}</p>{classification.scope==='unknown'&&<p className='placement-warning'>LOCATION REVIEW · Field or shop placement is not verified.</p>}<p>{cameraEvidenceLabel(classification.cameraState)}. Expected channel coverage is not established.</p><p>{['shop','inactive'].includes(classification.scope)?'Excluded from field operational totals. Saved connection observations remain available below.':serviceEvidenceLabel(classification.serviceState)+'. Service ports do not verify camera video.'}</p>{classification.recorderOffline&&<p role='note'>Recorder OFFLINE observation. Review the recorder separately from camera channel evidence.</p>}</div>;
}
export function ReconBatteryDetails({battery,now}:{battery?:ReconBatteryEvidence;now:number}){
  return <section className='recon-battery-evidence' aria-label='Recon battery health'><strong>Last reported battery</strong>
    <p>{battery?.percent!=null?Math.round(battery.percent)+'%':'Percentage not reported'}</p>
    {battery?.percent!=null&&<p>Level observed: {cameraTime(battery.percentObservedAt,now)} · {observationAge(battery.percentObservedAt,now)}</p>}
    <p>Battery condition: {battery?.status?battery.status.toUpperCase():'Not reported'}</p>
    {battery?.status&&<p>Condition observed: {cameraTime(battery.statusObservedAt,now)} · {observationAge(battery.statusObservedAt,now)}</p>}
    <small>Saved vendor readings. Refresh does not request a new battery measurement. Missing, invalid or older observation times do not verify the current battery.</small>
  </section>;
}
export function CameraResourceObservations({rows,now,trusted=true}:{rows:CameraRow[];now:number;trusted?:boolean}){
  return <div className='camera-device-cards'>{rows.map(row=>{
    const evidence=row.evidence,service=row.serviceEvidence||(evidence?.kind==='service_port'?evidence:undefined),provider=trusted?providerState(row,now):'verifying',port=trusted?savedConnectionObservation(row,now):'verifying';
    const resourcePath=cameraResourcePath(row),diagnosticsPath=unitDiagnosticsPath({id:String(row.id),unitNumber:row.unit});
    const kind=resourceKind(row),resource=kind==='recorders'?'RECORDER':kind==='detectors'?'DETECTOR':kind==='cameras'?'CAMERA':'PROVIDER';
    return <article key={row.id}><div><strong>{row.name}</strong><b style={{color:statusColor(provider)}}>{resource} {provider==='verifying'?'NOT VERIFIED':provider.toUpperCase()}</b></div><p>{[row.type,row.organization].filter(Boolean).join(' · ')||'Resource type not verified'}</p>
      {evidence?.kind==='provider'?<><p>{evidence.source} · Last reported {resource.toLowerCase()} state: <b>{String(evidence.status||'unknown').toUpperCase()}</b></p><p>{cameraTime(evidence.observedAt,now)} · {observationAge(evidence.observedAt,now)}</p><small>Last recorded successful provider connection: {cameraTime(evidence.lastOnlineAt,now)}</small></>:<p>No verified provider camera/recorder observation.</p>}
      {evidence?.source==='Reconeyez'&&<><ReconBatteryDetails battery={trusted?row.batteryEvidence:undefined} now={now}/><p>Cloud-managed detector. Direct camera IP / ports are not provided by this integration.</p><a className='camera-resource-access' href='https://na.reconeyez.com' target='_blank' rel='noopener noreferrer'>Open Reconeyez Cloud ↗</a></>}
      {kind==='recorders'&&<p>Camera channel status unavailable from this recorder observation.</p>}
      <p>{serviceEvidenceLabel(port)}{service?' · '+service.source:''}</p>{service&&<><p>Last reported service result: {service.status.toUpperCase()} · {cameraTime(service.observedAt,now)} · {observationAge(service.observedAt,now)}</p><small>Last recorded service-port success: {cameraTime(service.lastOnlineAt,now)}. Service reachability is not camera-status proof.</small></>}
      {!resourcePath&&diagnosticsPath&&<a href={diagnosticsPath} target='_blank' rel='noopener noreferrer'>Find unit in Camera Health diagnostics ↗</a>}
      {resourcePath&&<a className="camera-resource-access" href={resourcePath} target="_blank" rel="noopener noreferrer">{evidence?.source==='Reconeyez'?'Open Recon details & history ↗':'Open saved IP / ports ↗'}</a>}
    </article>;
  })}</div>;
}
export function CameraCardActions({group,now,onDetails,canEditPlacement=false,canEditConnection=false}:{group:CameraUnitGroup;now:number;onDetails:()=>void;canEditPlacement?:boolean;canEditConnection?:boolean}){
  const times=cameraCardTimes(group.rows,now),links=cameraCardLinks(group.rows),edits=cameraIpEditLinks(group.rows);
  return <><div className='camera-card-times'>
    <p>Last successful connection: <b>{cameraTime(times.success?.success,now)}</b><small>{times.success?[times.success.name,times.success.source,'Historical success; not current status'].join(' · '):'No successful connection recorded'}</small></p>
    <p>{times.checked?.kind==='provider'?'Last provider observation':'Last check attempted'}: <b>{cameraTime(times.checked?.checked,now)}</b><small>{times.checked?[times.checked.name,times.checked.source].join(' · '):'No check recorded'}</small></p>
  </div><div className='camera-card-actions' aria-label={group.name+' quick actions'}>
    {links.map(link=><a key={link.url} href={link.url} target='_blank' rel='noopener noreferrer'>{link.label} ↗</a>)}
    {!links.length&&<button type='button' onClick={onDetails}>Camera access details</button>}
    <a href={unitCardPath(group.name)} target='_blank' rel='noopener noreferrer'>Troubleshoot</a>
    <a href={'../../?fieldUnit='+encodeURIComponent(group.name)} target='_blank' rel='noopener noreferrer'>Field View</a>
    {canEditPlacement&&group.linkedIdentity&&group.rows.some(row=>!row.trackerOnly)&&<a href={unitCardPath(group.name,'edit-field')} target='_blank' rel='noopener noreferrer'>{['shop','inactive'].includes(group.scope)?'Move to Field':'Edit field information'}</a>}
    {canEditConnection&&(edits.length===1?<a href={edits[0].url} target='_blank' rel='noopener noreferrer'>Edit IP address</a>:edits.length>1?<details><summary>Edit IP address</summary>{edits.map(link=><a key={link.url} href={link.url} target='_blank' rel='noopener noreferrer'>{link.name}</a>)}</details>:null)}
  </div></>;
}
export default function CameraHealthOverview({health,now,units,createTicket,canEditPlacement=false,canEditConnection=false}:Props){
  const displayedHealth=useMemo(()=>healthWithFieldInventory(health,units||[]),[health,units]);
  const overview=useMemo(()=>cameraOverview(displayedHealth,now),[displayedHealth,now]);
  const [family,setFamily]=useState('all');
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[selectedKey,setSelectedKey]=useState(''),[ticketType,setTicketType]=useState<'SERVICE'|'PICKUP'|'DELIVERY'|'SWAP'>('SERVICE');
  const dialog=useRef<HTMLDialogElement|null>(null),opener=useRef<HTMLElement|null>(null);
  const selected=overview.groups.find(group=>group.key===selectedKey);
  const matches=selected&&units?units.filter(unit=>{const info=fieldCameraHealth(unit,units,health,now);return info.identity==='matched'&&info.rows.length===selected.rows.length&&info.rows.every(row=>selected.rows.some(other=>String(row.id)===String(other.id)));}):[];
  const fieldUnit=matches.length===1?matches[0]:null;
  const groups=overview.groups.filter(group=>{
    const active=['field','unknown'].includes(group.scope);
    const inFilter=filter==='unlinked'?!group.linkedIdentity:!group.linkedIdentity?false:
      filter==='shop'||filter==='inactive'?group.scope===filter:
      filter==='placement'?group.scope==='unknown':!active?false:
      filter==='all'?true:filter==='unknown'?!['online','offline'].includes(group.providerState):
      filter==='service'?group.serviceState==='online':filter==='service-failed'?group.serviceState==='offline':
      filter==='mixed'?group.providerState==='degraded':group.providerState===filter;
    return inFilter&&cameraFamily(group.rows,family)&&[group.name,group.site,...group.rows.map(row=>row.name)].join(' ').toLowerCase().includes(search.trim().toLowerCase());
  });
  const close=()=>{setSelectedKey('');dialog.current?.close();opener.current?.focus({preventScroll:true});};
  useEffect(()=>{if(selectedKey&&selected){if(!dialog.current?.open)dialog.current?.showModal();}else if(selectedKey){setSelectedKey('');dialog.current?.close();}},[selectedKey,Boolean(selected)]);
  const open=(group:CameraUnitGroup)=>{opener.current=document.activeElement as HTMLElement;setTicketType('SERVICE');setSelectedKey(group.key);};
  const total=(key:'monitored'|'online'|'offline'|'unknown')=>overview.scopeVerified?overview.summary[key]:'—';
  return <div className='camera-overview'>
    <div className='camera-overview-intro'><div><h3>How is the fleet doing?</h3><p>One card per saved unit. Provider system status, camera/detector observations, and service reachability are separate.</p></div><small>Last refresh<br/><b>{cameraTime(health.refreshedAt,now)}</b></small></div>
    {!overview.scopeVerified&&<p className='operations-error' role='alert'>Source-separated inventory scope is not verified by this response. Totals stay unavailable until confirmed-field, unresolved, shop and inactive records reconcile.</p>}
    <div className='camera-unit-kpis' aria-label='Provider system unit totals'>
      {[['monitored','Active / unresolved units','all'],['online','Provider systems online','online'],['offline','Provider systems offline','offline'],['unknown','Provider review','unknown']].map(([key,label,state])=><button key={key} className={'camera-unit-kpi '+(filter===state?'selected':'')} aria-pressed={filter===state} onClick={()=>setFilter(state)}><span>{label}</span><b className={'camera-status-'+state} style={state==='all'?{}:{color:cameraColors[state as keyof typeof cameraColors]}}>{total(key as 'monitored'|'online'|'offline'|'unknown')}</b><small>{state==='online'?'Reported provider resources online':state==='offline'?'Reported provider resources offline':state==='unknown'?'Mixed, service-only or unverified':'Confirmed field + location review'}</small></button>)}
    </div>
    <section className='camera-record-breakdown' aria-label='Individual camera coverage'>
      <div className='camera-actual-count'><b>{overview.scopeVerified?overview.cameras.total:'—'}</b><div><strong>Reported camera records</strong><small>{overview.cameras.online} online · {overview.cameras.offline} offline · {overview.cameras.unknown} unverified</small></div></div>
      <p>{overview.kinds.detectors} detectors · {overview.kinds.recorders} recorders · {overview.kinds.unitInventory} unit inventory records{overview.kinds.other?' · '+overview.kinds.other+' other resources':''}</p>
      <p className='camera-unit-coverage'>Camera/detector evidence by active or unresolved unit: {overview.coverage.cameraOnline} online · {overview.coverage.cameraOffline} offline · {overview.coverage.cameraMixed} mixed/unverified · {overview.coverage.cameraUnavailable} with channel status unavailable.</p>
      <p className='camera-service-coverage'>{overview.coverage.serviceReachable} of {overview.coverage.review} systems needing provider review have reachable service ports. {overview.coverage.degraded} systems have mixed provider status.</p>
      <small>NVR status describes the recorder. Service-port status describes reachability. Neither establishes camera channel coverage. Counts describe reported records and never prove all cameras are healthy.</small>
      {overview.scopeVerified&&<details><summary>How these totals add up</summary><p>{displayedHealth.inventory!.allRecords} inventory records = {displayedHealth.inventory!.activeFieldRecords} confirmed-field records + {displayedHealth.inventory!.activeShopRecords} shop/root records + {displayedHealth.inventory!.inactiveRecords} inactive records + {displayedHealth.inventory!.unknownScopeRecords||0} location-review records.</p><p>{overview.scopes.field} confirmed-field units + {overview.scopes.unknown} location-review units = {overview.summary.monitored} active / unresolved unit groups. {overview.scopes.shop} shop/root and {overview.scopes.inactive} inactive unit groups are excluded from operational totals.</p><p>{overview.summary.online} provider online + {overview.summary.offline} provider offline + {overview.summary.unknown} provider review = {overview.summary.monitored} groups. Mixed provider observations remain in review, even when individual camera outages are present. {overview.records} resource records are grouped by exact saved unit key.</p>{overview.unlinked>0&&<p>{overview.unlinked} resources have no unambiguous saved unit key and are excluded from unit totals.</p>}{displayedHealth.coverageNote&&<p>{displayedHealth.coverageNote}</p>}</details>}
    </section>
    <div className='camera-overview-toolbar'><input aria-label='Search Camera Health units' placeholder='Search unit, site or device…' value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label='Camera Health equipment family' value={family} onChange={event=>{setFamily(event.target.value);setFilter('all');}}><option value='all'>All equipment families</option><option value='sniper'>All Snipers</option><option value='camv'>All CAM V</option><option value='recon'>All Recons</option></select><select aria-label='Camera Health unit filter' value={filter} onChange={event=>setFilter(event.target.value)}><option value='all'>Active / unresolved units</option><option value='offline'>Provider systems offline</option><option value='unknown'>Provider review</option><option value='online'>Provider systems online</option><option value='mixed'>Mixed provider status</option><option value='service'>Service reachable</option><option value='service-failed'>Service check failed</option><option value='placement'>Location review ({overview.scopes.unknown})</option><option value='shop'>Shop / ROOT ({overview.scopes.shop})</option><option value='inactive'>Inactive ({overview.scopes.inactive})</option>{overview.unlinked>0&&<option value='unlinked'>Unlinked resources ({overview.unlinked})</option>}</select><span>{groups.length} shown</span></div>
    <p className='camera-overview-freshness'>The 20-minute window allows for the 15-minute saved-data refresh and timing jitter; it is a presentation threshold for recent observations, not an expected heartbeat. Older Reconeyez and other provider states retain their last reported status and age. Silence does not establish an outage. Refresh reads saved observations; it does not run a test.</p>
    <div className='camera-overview-grid' aria-label='Camera Health unit cards'>{groups.map(group=><article key={group.key} className='camera-overview-card'><button type='button' className='camera-card-main' aria-label={'Open '+group.name+' unit details'} onClick={()=>open(group)}><div><strong>{group.name}</strong><span className={'camera-status-pill camera-status-'+cameraUnitDisplayState(group)} style={{color:statusColor(cameraUnitDisplayState(group))}}>{cameraUnitStatusLabel(group)}</span></div>{group.scope==='unknown'&&<p className='placement-warning'>LOCATION REVIEW · Field or shop not verified</p>}<p>{group.scope==='unknown'?'Saved site: ':''}{group.site||'Site not linked'}</p><small>{resourceBreakdown(group.rows)}</small>{!group.linkedIdentity&&<small>Unit identity missing or conflicting; excluded from unit totals.</small>}<small>{cameraEvidenceLabel(group.cameraState)}</small>{group.online+group.offline+group.unknown>0&&<small>{group.online} camera/detector records online · {group.offline} offline · {group.unknown} unverified</small>}<small>{serviceEvidenceLabel(group.serviceState)}</small><small>Latest observation: {cameraTime(group.lastObservedAt,now)} · {observationAge(group.lastObservedAt,now)}</small><b className='camera-card-link'>View unit details →</b></button><CameraCardActions group={group} now={now} onDetails={()=>open(group)} canEditPlacement={canEditPlacement} canEditConnection={canEditConnection}/></article>)}</div>
    {!groups.length&&<p className='field-map-empty'>No unit groups match this view.</p>}
    {selected&&<dialog ref={dialog} className='camera-overview-detail' aria-label='Camera Health unit details' onCancel={event=>{event.preventDefault();close();}}><div className='camera-detail-top'><div><small>UNIT DETAILS</small><h3>{selected.name}</h3><p>{selected.site||'Site not linked'}</p></div><button className='secondary' onClick={close}>Back to units</button></div><UnitEvidenceDetails classification={selected}/><p>{resourceBreakdown(selected.rows)}</p><CameraResourceObservations rows={selected.rows} now={now} trusted={health.evidenceVersion===2}/>
      {createTicket&&<section className='camera-detail-ticket'><h4>Create a ticket for this unit</h4>{fieldUnit?<><p>Field record: {fieldUnit.unitNumber}. Customer and site are verified again in the ticket draft.</p><select aria-label='Unit detail ticket type' value={ticketType} onChange={event=>setTicketType(event.target.value as typeof ticketType)}><option value='SERVICE'>Service / repair</option><option value='PICKUP'>Pick up</option><option value='DELIVERY'>Install / Delivery</option><option value='SWAP'>Swap out</option></select><button onClick={()=>{const id=fieldUnit.id;close();createTicket(ticketType,id);}}>Create ticket</button></>:<p>No unique current field record is linked to this Camera Health unit. Select the correct unit in Field View before creating its ticket; customer and site will not be guessed.</p>}</section>}
    </dialog>}
  </div>;
}
