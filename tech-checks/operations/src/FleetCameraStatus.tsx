import {useCallback,useEffect,useMemo,useState} from 'react';
import {api} from './api';
import {cameraTime} from './fieldCameraHealth';
import {STAR_UNIT_STATUS_CONTRACT,type HandEditField,type UnitCameraStatus,type UnitCameraStatusReport,type UnitSource} from '../shared/starUnitStatus';
import UnitStatusMap from './UnitStatusMap';
import {savedAddressByUnit,type SavedAddressPin} from './unitStatusPins';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {safeVrmPower,type SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import {vrmPortalUrl} from '../../supabase/functions/cos-operations-pages/vrm';
import './fleetCameraStatus.css';

type Report=UnitCameraStatusReport&{refreshedAt?:string;source?:string;handEditsRead?:boolean;otherSourcesRead?:boolean;canEdit?:boolean;
 recorded?:{unit:string;field:string;action:string;value:string|null;by:string;role:string;duplicate:boolean;pinned?:boolean;pinNote?:string|null}};
import {type Group,type StateFilter,GROUPS,FAMILY_LABEL,familyOf,sourceOf,groupedUnits} from './cameraStatusFilters';
export {groupedUnits};
type Draft={unit:string;placement:'FIELD'|'SHOP';site:string;address:string;publicIp:string;reason:string};

const DOT:Record<UnitCameraStatus['state'],string>={GREEN:'online',YELLOW:'offline',RED:'offline',UNKNOWN:'unknown'};
const STATE_LABEL:Record<UnitCameraStatus['state'],string>={GREEN:'All cameras up',YELLOW:'Some cameras down',RED:'All cameras down',UNKNOWN:'Not verified'};
// Where each reading comes from. Avigilon units (Snipers, CAMVs) are a reachability
// check on the unit, so they are Up or Down as a whole, never camera by camera.
const AVIGILON_STATE:Record<UnitCameraStatus['state'],string>={GREEN:'Up',YELLOW:'Down',RED:'Down',UNKNOWN:'Not verified'};
const VICTRON:[string,string][]=[['solar_power','Solar'],['load_power','Load'],['battery_voltage','Battery'],['battery_soc','Charge']];

/** One Helios, one Victron installation: matched only when the name is unique on both sides. */
export function victronByUnit(units:UnitCameraStatus[],vrm:any,now:number):Map<string,SafeVrmPower>{
 const found=new Map<string,SafeVrmPower>();
 if(!vrm||!Array.isArray(vrm.items)||!Array.isArray(vrm.power))return found;
 let power:SafeVrmPower[];
 try{power=safeVrmPower(vrm.power,vrm.items,now);}catch{return found;}
 for(const unit of units){
  const key=canonicalCameraUnit(unit.unit);
  if(!key?.startsWith('HELIOS|'))continue;
  const matches=power.filter(row=>canonicalCameraUnit(row.name)===key);
  if(matches.length===1&&units.filter(other=>canonicalCameraUnit(other.unit)===key).length===1)found.set(unit.unit,matches[0]);
 }
 return found;
}
function victronLine(power:SafeVrmPower):string{
 const newest=(metric:string)=>power.measurements.filter(item=>item.metric===metric).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
 return VICTRON.map(([metric,label])=>{const item=newest(metric);return item?label+' '+item.value+' '+item.unit:'';}).filter(Boolean).join(' · ');
}
const FIELD_LABEL:Record<HandEditField,string>={placement:'Field or shop',site:'Site',address:'Address',public_ip:'Public IP',camera:'Cameras on this unit'};

/** A read-only check, so a bad shape is reported rather than guessed at. */
function checkedReport(value:unknown):Report{
 const report=value as Report;
 if(!report||typeof report!=='object'||report.contract!==STAR_UNIT_STATUS_CONTRACT||!Array.isArray(report.units)||!report.counts)throw Error('The Star4Live unit status could not be read.');
 return report;
}


const draftOf=(unit:UnitCameraStatus):Draft=>({unit:unit.unit,placement:unit.placement,site:unit.site||'',address:unit.address||'',publicIp:unit.publicIp||'',reason:''});

export default function FleetCameraStatus({now=Date.now(),savedAddresses}:{now?:number;savedAddresses?:readonly SavedAddressPin[]|null}){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [group,setGroup]=useState<Group>('field'),[query,setQuery]=useState(''),[stateFilter,setStateFilter]=useState<StateFilter>('all');
 const [draft,setDraft]=useState<Draft|null>(null),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[saved,setSaved]=useState('');
 const [vrm,setVrm]=useState<any>(null);
 // Victron readings for Helios lines. A failed or refused read leaves the lines without power; it is never an outage.
 useEffect(()=>{let cancelled=false;api.get('/api/vrm-fleet').then(result=>{if(!cancelled)setVrm(result.data);}).catch(()=>{});return ()=>{cancelled=true;};},[]);
 const read=useCallback(async(signal?:{cancelled:boolean})=>{
  setLoading(true);
  try{
   const result=await api.get<Report>('/api/unit-camera-status');
   if(signal?.cancelled)return;
   setReport(checkedReport(result.data));setError('');
  }catch(failure:any){
   if(signal?.cancelled)return;
   // The previous reading stays on screen under its own time; it is never relabelled as current.
   setError(failure?.response?.data?.error||failure?.message||'The Star4Live unit status is unavailable.');
  }finally{if(!signal?.cancelled)setLoading(false);}
 },[]);
 useEffect(()=>{const signal={cancelled:false};read(signal);return ()=>{signal.cancelled=true;};},[read]);

 const submit=useCallback(async(unit:UnitCameraStatus,field:HandEditField,value:string|null,reason:string,clearValue?:string)=>{
  setSaving(true);setSaveError('');
  try{
   const body:Record<string,unknown>={unitKey:unit.unit,field,requestId:crypto.randomUUID()};
   if(value===null){body.action='clear';if(clearValue)body.value=clearValue;}else body.value=value;
   if(reason.trim())body.reason=reason.trim();
   const result=await api.post<Report>('/api/unit-camera-status/edit',body);
   const next=checkedReport(result.data);
   setReport(next);setDraft(null);
   setSaved(next.recorded?(field==='camera'?(value===null?(clearValue?clearValue+' is back on '+unit.unit:'Every camera is back on '+unit.unit):value+' is no longer on '+unit.unit)
    :value===null?'Cleared the '+FIELD_LABEL[field].toLowerCase()+' edit on '+unit.unit:unit.unit+' '+FIELD_LABEL[field].toLowerCase()+' set to '+value+(next.recorded.pinned===false?' · saved without a pin: '+(next.recorded.pinNote||'no location found'):next.recorded.pinned?' · pin dropped':'')):'Saved.');
  }catch(failure:any){
   setSaveError(failure?.response?.data?.error||failure?.message||'The edit could not be saved. Nothing was changed.');
  }finally{setSaving(false);}
 },[]);

 const counts=report?.counts,feed=report?.feed,canEdit=report?.canEdit===true&&report?.handEditsRead===true;
 const savedByUnit=useMemo(()=>savedAddressByUnit(savedAddresses),[savedAddresses]);
 const savedAddressOf=useCallback((unit:UnitCameraStatus)=>{const key=canonicalCameraUnit(unit.unit);return key?savedByUnit.get(key):undefined;},[savedByUnit]);
 const victron=useMemo(()=>report?victronByUnit(report.units,vrm,now):new Map<string,SafeVrmPower>(),[report,vrm,now]);
 const shown=useMemo(()=>report?groupedUnits(report.units,group,query,stateFilter):[],[report,group,query,stateFilter]);
 // Every tile is a filter: clicking one shows exactly the units it counts.
 const tiles:{label:string;count:number;kind:string;group:Group;state:StateFilter}[]=counts?[
  {label:'FIELD UNITS',count:counts.field.units,kind:'field',group:'field',state:'all'},
  {label:'UP',count:counts.field.green,kind:'online',group:'field',state:'GREEN'},
  {label:'SOME CAMERAS DOWN',count:counts.field.yellow,kind:'offline',group:'field',state:'YELLOW'},
  {label:'DOWN',count:counts.field.red,kind:'offline',group:'field',state:'RED'},
  {label:'NOT VERIFIED',count:counts.field.unknown,kind:'unknown',group:'field',state:'UNKNOWN'},
  {label:'ONLINE IN THE SHOP',count:counts.shop.onlineInShop,kind:'shop',group:'shop-online',state:'all'},
 ]:[];
 const pick=(nextGroup:Group,nextState:StateFilter)=>{setGroup(nextGroup);setStateFilter(nextState);setQuery('');};
 return <section className='cos-camera-status' aria-label='Unit camera status'>
  <header>
   <div>
    <h2>Camera status</h2>
    <p>Every unit, one line each: Avigilon (Snipers and CAM Vs), Recon II and Alibi. Only you and IT can change where a unit is; nothing moves on its own.</p>
   </div>
   <div className='cos-camera-status-read'>
    <button type='button' disabled={loading||saving} onClick={()=>read()}>{loading?'↻ Reading…':'↻ Refresh'}</button>
    <small>{feed?.syncedAt?'Star4Live reading '+cameraTime(feed.syncedAt,now):loading?'Reading Star4Live…':'No Star4Live reading'}</small>
   </div>
  </header>
  {feed&&!feed.fresh&&<p className='cos-camera-status-stale' role='status'>
   <strong>Star4Live has not reported recently.</strong> Every Star4Live unit reads Not verified until the next good sync. No unit is called offline on an old reading.
   {feed.status&&feed.status!=='ok'?' Last sync status: '+feed.status+'.':''}
  </p>}
  {report&&report.handEditsRead===false&&<p className='cos-camera-status-stale' role='status'>
   <strong>Saved hand edits could not be read.</strong> The readings below are the provider's own. Editing is off until they can be read again.
  </p>}
  {report&&report.otherSourcesRead===false&&<p className='cos-camera-status-stale' role='status'>
   <strong>Avigilon and Reconeyez readings could not be read.</strong> Only Star4Live units are listed until they can be.
  </p>}
  {error&&<p className='cos-camera-status-error' role='alert'>{error}{report?' The readings below are from the time above.':''}</p>}
  {saved&&<p className='cos-camera-status-saved' role='status'>{saved}</p>}
  {counts&&<div className='cos-camera-status-tiles'>{tiles.map(tile=><button key={tile.label} type='button'
   className={'cos-camera-status-tile cos-camera-tile-'+tile.kind} aria-pressed={group===tile.group&&stateFilter===tile.state}
   onClick={()=>pick(tile.group,tile.state)}>
   {['online','offline','unknown'].includes(tile.kind)&&<i className={'cos-board-status-dot cos-board-dot-'+tile.kind} aria-hidden='true'/>}
   <span>{tile.label}</span><strong>{tile.count}</strong>
  </button>)}</div>}
  <nav className='cos-camera-status-groups' aria-label='Camera status groups'>{GROUPS.map(item=><button key={item.id} type='button' aria-current={group===item.id?'page':undefined} onClick={()=>pick(item.id,'all')}>
   {item.label}{report&&<b>{groupedUnits(report.units,item.id,'').length}</b>}
  </button>)}</nav>
  <p className='cos-camera-status-note'>{GROUPS.find(item=>item.id===group)!.note}
   {stateFilter!=='all'&&<> Showing only {STATE_LABEL[stateFilter].toLowerCase()}. <button type='button' className='cos-camera-status-clear-filter' onClick={()=>setStateFilter('all')}>Show all</button></>}</p>
  {report&&(group==='field'||group==='attention')&&<UnitStatusMap savedAddresses={savedAddresses} units={group==='attention'?report.units.filter(unit=>unit.state!=='GREEN'):report.units}
   onSelect={unit=>{setStateFilter('all');setQuery(unit);}}/>}
  <div className='cos-camera-status-search'>
   <label className='sr-only' htmlFor='cos-camera-status-search'>Find a unit, site or IP</label>
   <input id='cos-camera-status-search' type='search' placeholder='Find a unit, site or IP…' value={query} onChange={event=>setQuery(event.target.value)}/>
   {query&&<button type='button' aria-label='Clear search' onClick={()=>setQuery('')}>×</button>}
  </div>
  <ul className='cos-camera-status-list'>
   {shown.map(unit=><li key={unit.unit} className={'cos-camera-status-row cos-camera-state-'+unit.state.toLowerCase()}>
    <div className='cos-camera-status-main'>
     <div className='cos-camera-status-unit'>
      <strong><i className={'cos-board-status-dot cos-board-dot-'+DOT[unit.state]} aria-hidden='true'/>{unit.unit}</strong>
      <small>{unit.placement==='FIELD'?(unit.siteNamePending?unit.site+' · name not entered yet':unit.site):unit.onlineInShop?'ONLINE IN THE SHOP'+(sourceOf(unit)==='star4live'?' · root':''):'SHOP'+(sourceOf(unit)==='star4live'?' · root':'')}</small>
      {unit.placement==='FIELD'&&<small className='cos-camera-status-address'>{unit.location?'📍 '+(unit.address||unit.location.matchedAddress):unit.address?unit.address+' · no pin yet (the address service could not place it)':savedAddressOf(unit)?'◌ '+savedAddressOf(unit)!.address+' · address on file, nobody has confirmed it':'No address on the map yet'}</small>}
      {unit.handEdits&&Object.entries(unit.handEdits).filter(([field])=>field!=='address').map(([field,edit])=><small key={field} className='cos-camera-status-edit-note'>
       {FIELD_LABEL[field as HandEditField]} set by hand to “{edit.value}” by {edit.by}{edit.at?' '+cameraTime(edit.at,now):''}
       {edit.providerAgrees?' · '+FAMILY_LABEL[familyOf(unit)]+' now agrees':edit.providerValue?' · '+FAMILY_LABEL[familyOf(unit)]+' still says “'+edit.providerValue+'”':' · '+FAMILY_LABEL[familyOf(unit)]+' has no value'}
       {edit.reason?' · '+edit.reason:''}
      </small>)}
     </div>
     <div className='cos-camera-status-detail'>
      <span><b className={'cos-camera-status-source cos-camera-family-'+familyOf(unit)}>{FAMILY_LABEL[familyOf(unit)]}</b>{sourceOf(unit)==='ip_check'?AVIGILON_STATE[unit.state]:STATE_LABEL[unit.state]+' · '+unit.online+' of '+unit.cameras+' up'}</span>
      {sourceOf(unit)==='ip_check'?<small>{unit.state==='GREEN'?'The unit answers. Each camera is not checked.':unit.publicIp?unit.state==='UNKNOWN'?'No recent check on this unit.':'The unit did not answer.':'No IP on file for this unit.'}</small>
       :unit.down.length>0&&<small>Down: {unit.down.map(camera=>camera.name+(camera.status==='unknown'?' (not verified)':'')).join(', ')}</small>}
      {victron.has(unit.unit)&&<small className='cos-camera-status-victron'>Victron · {victronLine(victron.get(unit.unit)!)||'no saved power readings'} · <a href={vrmPortalUrl(victron.get(unit.unit)!.installationId)} target='_blank' rel='noopener noreferrer'>Open Victron ↗</a></small>}
      <small>{unit.publicIp?unit.publicIp+' · ':''}{unit.observedAt?'read '+cameraTime(unit.observedAt,now):'no reading time'}</small>
      <button type='button' className='cos-camera-status-edit-open' aria-expanded={draft?.unit===unit.unit}
       onClick={()=>{setSaveError('');setSaved('');setDraft(draft?.unit===unit.unit?null:draftOf(unit));}}>
       {draft?.unit===unit.unit?'Close':canEdit?'Open \u2192':'Details \u2192'}
      </button>
     </div>
    </div>
    {draft?.unit===unit.unit&&<form className='cos-camera-status-edit' onSubmit={event=>event.preventDefault()} aria-label={'Unit panel for '+unit.unit}>
     <h3 className='cos-camera-status-panel-heading'>{unit.unit}</h3>
     <ul className='cos-camera-status-cameras' aria-label={'Cameras on '+unit.unit}>
      {(unit.cameraList||[]).map(camera=><li key={camera.name} className={'cos-camera-status-camera'+(camera.removed?' cos-camera-status-camera-off':'')}>
       <i className={'cos-board-status-dot cos-board-dot-'+(camera.removed?'unknown':camera.status==='online'?'online':camera.status==='offline'?'offline':'unknown')} aria-hidden='true'/>
       <span>{camera.name}</span>
       <small>{camera.removed?'Taken off this unit by hand \u00b7 not counted'
        :camera.status==='online'?'Online':camera.status==='offline'?'Offline':'Not verified'}
        {!camera.removed&&!camera.atSite&&unit.placement==='FIELD'?' \u00b7 in the shop, not at this site':''}</small>
       {canEdit&&(camera.removed
        ?<button type='button' disabled={saving} onClick={()=>submit(unit,'camera',null,draft.reason,camera.name)}>Put back</button>
        :<button type='button' disabled={saving} onClick={()=>submit(unit,'camera',camera.name,draft.reason)}>Swapped out</button>)}
      </li>)}
      {!(unit.cameraList||[]).length&&<li className='cos-camera-status-camera'><small>{FAMILY_LABEL[familyOf(unit)]} reports no camera list for this unit.</small></li>}
     </ul>
     {!canEdit&&<p>Only you and IT can change a unit.</p>}
     {canEdit&&<p>Where a unit is, its site, its address and which cameras are on it are yours to set. Up or down always stays whatever {FAMILY_LABEL[familyOf(unit)]} reports.</p>}
     {canEdit&&<>
     <div className='cos-camera-status-edit-row'>
      <span id={'placement-'+unit.unit}>Field or shop</span>
      <div role='group' aria-labelledby={'placement-'+unit.unit} className='cos-camera-status-toggle'>
       {(['FIELD','SHOP'] as const).map(value=><button key={value} type='button' aria-pressed={draft.placement===value} disabled={saving}
        onClick={()=>setDraft({...draft,placement:value})}>{value==='FIELD'?'In the field':'In the shop'}</button>)}
      </div>
      <button type='button' disabled={saving||draft.placement===unit.placement} onClick={()=>submit(unit,'placement',draft.placement,draft.reason)}>Save</button>
      {unit.handEdits?.placement&&<button type='button' disabled={saving} onClick={()=>submit(unit,'placement',null,draft.reason)}>Use {FAMILY_LABEL[familyOf(unit)]}</button>}
     </div>
     {draft.placement==='FIELD'&&<div className='cos-camera-status-edit-row'>
      <label htmlFor={'site-'+unit.unit}>Customer and site</label>
      <input id={'site-'+unit.unit} type='text' maxLength={120} value={draft.site} disabled={saving}
       placeholder='Customer - site' onChange={event=>setDraft({...draft,site:event.target.value})}/>
      <button type='button' disabled={saving||!draft.site.trim()||draft.site.trim()===(unit.site||'')} onClick={()=>submit(unit,'site',draft.site.trim(),draft.reason)}>Save</button>
      {unit.handEdits?.site&&<button type='button' disabled={saving} onClick={()=>submit(unit,'site',null,draft.reason)}>Use Star4Live</button>}
     </div>}
     {draft.placement==='FIELD'&&<div className='cos-camera-status-edit-row'>
      <label htmlFor={'address-'+unit.unit}>Address (drops the pin)</label>
      <input id={'address-'+unit.unit} type='text' maxLength={200} value={draft.address} disabled={saving||unit.placement!=='FIELD'} autoComplete='street-address'
       placeholder='123 Main St, Houston, TX 77002' onChange={event=>setDraft({...draft,address:event.target.value})}/>
      <button type='button' disabled={saving||unit.placement!=='FIELD'||!draft.address.trim()||draft.address.trim()===(unit.address||'')} onClick={()=>submit(unit,'address',draft.address.trim(),draft.reason)}>Save</button>
      {unit.handEdits?.address&&<button type='button' disabled={saving} onClick={()=>submit(unit,'address',null,draft.reason)}>Remove pin</button>}
      {unit.placement!=='FIELD'&&<small>Save “In the field” first, then add the address.</small>}
     </div>}
     {sourceOf(unit)==='star4live'&&<div className='cos-camera-status-edit-row'>
      <label htmlFor={'ip-'+unit.unit}>Public IP</label>
      <input id={'ip-'+unit.unit} type='text' inputMode='decimal' maxLength={15} value={draft.publicIp} disabled={saving}
       placeholder='38.246.0.0' onChange={event=>setDraft({...draft,publicIp:event.target.value})}/>
      <button type='button' disabled={saving||!draft.publicIp.trim()||draft.publicIp.trim()===(unit.publicIp||'')} onClick={()=>submit(unit,'public_ip',draft.publicIp.trim(),draft.reason)}>Save</button>
      {unit.handEdits?.public_ip&&<button type='button' disabled={saving} onClick={()=>submit(unit,'public_ip',null,draft.reason)}>Use Star4Live</button>}
     </div>}
     <div className='cos-camera-status-edit-row'>
      <label htmlFor={'reason-'+unit.unit}>Why (optional)</label>
      <input id={'reason-'+unit.unit} type='text' maxLength={400} value={draft.reason} disabled={saving}
       placeholder='Tech moved it today' onChange={event=>setDraft({...draft,reason:event.target.value})}/>
     </div>
     {saveError&&<p className='cos-camera-status-error' role='alert'>{saveError}</p>}
     <small>Every edit is kept with your name and the time. No provider is ever written to; a tech still changes VCC.</small>
     </>}
    </form>}
   </li>)}
   {!shown.length&&<li className='cos-camera-status-empty'>{loading?'Reading Star4Live…':error?'No readings to show.':query?'No unit matches that search.':'No units in this group.'}</li>}
  </ul>
 </section>;
}
