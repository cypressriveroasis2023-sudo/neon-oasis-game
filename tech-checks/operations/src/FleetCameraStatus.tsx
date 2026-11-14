import {useCallback,useEffect,useMemo,useState} from 'react';
import {api} from './api';
import {cameraTime} from './fieldCameraHealth';
import {STAR_UNIT_STATUS_CONTRACT,type HandEditField,type UnitCameraStatus,type UnitCameraStatusReport,type UnitSource} from '../shared/starUnitStatus';
import UnitStatusMap from './UnitStatusMap';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {safeVrmPower,type SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import {vrmPortalUrl} from '../../supabase/functions/cos-operations-pages/vrm';
import './fleetCameraStatus.css';

type Report=UnitCameraStatusReport&{refreshedAt?:string;source?:string;handEditsRead?:boolean;otherSourcesRead?:boolean;canEdit?:boolean;
 recorded?:{unit:string;field:string;action:string;value:string|null;by:string;role:string;duplicate:boolean;pinned?:boolean;pinNote?:string|null}};
type Group='field'|'attention'|'shop-online'|'shop';
type Draft={unit:string;placement:'FIELD'|'SHOP';site:string;address:string;publicIp:string;reason:string};

const GROUPS:{id:Group;label:string;note:string}[]=[
 {id:'field',label:'In the field',note:'Units with a camera reporting from a customer site.'},
 {id:'attention',label:'Needs attention',note:'Field units with at least one camera not reporting as online.'},
 {id:'shop-online',label:'Online in the shop',note:'Online, still in root. It stays in the shop until somebody moves it to a site.'},
 {id:'shop',label:'In the shop',note:'Everything in root, online or not. Shop units never count as a field outage.'},
];
const DOT:Record<UnitCameraStatus['state'],string>={GREEN:'online',YELLOW:'offline',RED:'offline',UNKNOWN:'unknown'};
const STATE_LABEL:Record<UnitCameraStatus['state'],string>={GREEN:'All cameras up',YELLOW:'Some cameras down',RED:'All cameras down',UNKNOWN:'Not verified'};
// Where each reading comes from. Avigilon units (Snipers, CAMVs) are a reachability
// check on the unit, so they are Up or Down as a whole, never camera by camera.
const SOURCE_LABEL:Record<UnitSource,string>={star4live:'Star4Live',ip_check:'Avigilon',reconeyez:'Reconeyez'};
const AVIGILON_STATE:Record<UnitCameraStatus['state'],string>={GREEN:'Up',YELLOW:'Down',RED:'Down',UNKNOWN:'Not verified'};
const sourceOf=(unit:UnitCameraStatus):UnitSource=>unit.source||'star4live';
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
const FIELD_LABEL:Record<HandEditField,string>={placement:'Field or shop',site:'Site',address:'Address',public_ip:'Public IP'};

/** A read-only check, so a bad shape is reported rather than guessed at. */
function checkedReport(value:unknown):Report{
 const report=value as Report;
 if(!report||typeof report!=='object'||report.contract!==STAR_UNIT_STATUS_CONTRACT||!Array.isArray(report.units)||!report.counts)throw Error('The Star4Live unit status could not be read.');
 return report;
}

export function groupedUnits(units:UnitCameraStatus[],group:Group,query:string):UnitCameraStatus[]{
 const text=query.trim().toLowerCase();
 return units.filter(unit=>{
  if(group==='field'&&unit.placement!=='FIELD')return false;
  if(group==='attention'&&!(unit.placement==='FIELD'&&unit.state!=='GREEN'))return false;
  if(group==='shop-online'&&!unit.onlineInShop)return false;
  if(group==='shop'&&unit.placement!=='SHOP')return false;
  if(!text)return true;
  return [unit.unit,unit.site||'',unit.address||'',unit.publicIp||'',SOURCE_LABEL[sourceOf(unit)]].some(field=>field.toLowerCase().includes(text));
 });
}

const draftOf=(unit:UnitCameraStatus):Draft=>({unit:unit.unit,placement:unit.placement,site:unit.site||'',address:unit.address||'',publicIp:unit.publicIp||'',reason:''});

export default function FleetCameraStatus({now=Date.now()}:{now?:number}){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [group,setGroup]=useState<Group>('field'),[query,setQuery]=useState('');
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

 const submit=useCallback(async(unit:UnitCameraStatus,field:HandEditField,value:string|null,reason:string)=>{
  setSaving(true);setSaveError('');
  try{
   const body:Record<string,unknown>={unitKey:unit.unit,field,requestId:crypto.randomUUID()};
   if(value===null)body.action='clear';else body.value=value;
   if(reason.trim())body.reason=reason.trim();
   const result=await api.post<Report>('/api/unit-camera-status/edit',body);
   const next=checkedReport(result.data);
   setReport(next);setDraft(null);
   setSaved(next.recorded?(value===null?'Cleared the '+FIELD_LABEL[field].toLowerCase()+' edit on '+unit.unit:unit.unit+' '+FIELD_LABEL[field].toLowerCase()+' set to '+value+(next.recorded.pinned===false?' · saved without a pin: '+(next.recorded.pinNote||'no location found'):next.recorded.pinned?' · pin dropped':'')):'Saved.');
  }catch(failure:any){
   setSaveError(failure?.response?.data?.error||failure?.message||'The edit could not be saved. Nothing was changed.');
  }finally{setSaving(false);}
 },[]);

 const counts=report?.counts,feed=report?.feed,canEdit=report?.canEdit===true&&report?.handEditsRead===true;
 const victron=useMemo(()=>report?victronByUnit(report.units,vrm,now):new Map<string,SafeVrmPower>(),[report,vrm,now]);
 const shown=useMemo(()=>report?groupedUnits(report.units,group,query):[],[report,group,query]);
 const tiles:[string,number|'—',string][]=counts?[
  ['FIELD UNITS',counts.field.units,'field'],
  ['UP',counts.field.green,'online'],
  ['SOME CAMERAS DOWN',counts.field.yellow,'offline'],
  ['DOWN',counts.field.red,'offline'],
  ['NOT VERIFIED',counts.field.unknown,'unknown'],
  ['ONLINE IN THE SHOP',counts.shop.onlineInShop,'shop'],
 ]:[];
 return <section className='cos-camera-status' aria-label='Unit camera status'>
  <header>
   <div>
    <h2>Camera status</h2>
    <p>Every unit, one line each: Star4Live, Avigilon (Snipers and CAMVs) and Reconeyez (Recon II). Only you and IT can change where a unit is; nothing moves on its own.</p>
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
  {counts&&<div className='cos-camera-status-tiles'>{tiles.map(([label,count,kind])=><div key={label} className={'cos-camera-status-tile cos-camera-tile-'+kind}>
   {['online','offline','unknown'].includes(kind)&&<i className={'cos-board-status-dot cos-board-dot-'+kind} aria-hidden='true'/>}
   <span>{label}</span><strong>{count}</strong>
  </div>)}</div>}
  <nav className='cos-camera-status-groups' aria-label='Camera status groups'>{GROUPS.map(item=><button key={item.id} type='button' aria-current={group===item.id?'page':undefined} onClick={()=>setGroup(item.id)}>
   {item.label}{report&&<b>{groupedUnits(report.units,item.id,'').length}</b>}
  </button>)}</nav>
  <p className='cos-camera-status-note'>{GROUPS.find(item=>item.id===group)!.note}</p>
  {report&&(group==='field'||group==='attention')&&<UnitStatusMap units={group==='attention'?report.units.filter(unit=>unit.state!=='GREEN'):report.units}
   onSelect={unit=>{setQuery(unit);}}/>}
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
      {unit.placement==='FIELD'&&<small className='cos-camera-status-address'>{unit.location?'📍 '+(unit.address||unit.location.matchedAddress):unit.address?unit.address+' · no pin yet (the address service could not place it)':'No address on the map yet'}</small>}
      {unit.handEdits&&Object.entries(unit.handEdits).filter(([field])=>field!=='address').map(([field,edit])=><small key={field} className='cos-camera-status-edit-note'>
       {FIELD_LABEL[field as HandEditField]} set by hand to “{edit.value}” by {edit.by}{edit.at?' '+cameraTime(edit.at,now):''}
       {edit.providerAgrees?' · '+SOURCE_LABEL[sourceOf(unit)]+' now agrees':edit.providerValue?' · '+SOURCE_LABEL[sourceOf(unit)]+' still says “'+edit.providerValue+'”':' · '+SOURCE_LABEL[sourceOf(unit)]+' has no value'}
       {edit.reason?' · '+edit.reason:''}
      </small>)}
     </div>
     <div className='cos-camera-status-detail'>
      <span><b className={'cos-camera-status-source cos-camera-source-'+sourceOf(unit)}>{SOURCE_LABEL[sourceOf(unit)]}</b>{sourceOf(unit)==='ip_check'?AVIGILON_STATE[unit.state]:STATE_LABEL[unit.state]+' · '+unit.online+' of '+unit.cameras+' up'}</span>
      {sourceOf(unit)==='ip_check'?<small>{unit.state==='GREEN'?'The unit answers. Each camera is not checked.':unit.publicIp?unit.state==='UNKNOWN'?'No recent check on this unit.':'The unit did not answer.':'No IP on file for this unit.'}</small>
       :unit.down.length>0&&<small>Down: {unit.down.map(camera=>camera.name+(camera.status==='unknown'?' (not verified)':'')).join(', ')}</small>}
      {victron.has(unit.unit)&&<small className='cos-camera-status-victron'>Victron · {victronLine(victron.get(unit.unit)!)||'no saved power readings'} · <a href={vrmPortalUrl(victron.get(unit.unit)!.installationId)} target='_blank' rel='noopener noreferrer'>Open Victron ↗</a></small>}
      <small>{unit.publicIp?unit.publicIp+' · ':''}{unit.observedAt?'read '+cameraTime(unit.observedAt,now):'no reading time'}</small>
      {canEdit&&<button type='button' className='cos-camera-status-edit-open' onClick={()=>{setSaveError('');setSaved('');setDraft(draft?.unit===unit.unit?null:draftOf(unit));}}>
       {draft?.unit===unit.unit?'Close':'Edit by hand'}
      </button>}
     </div>
    </div>
    {canEdit&&draft?.unit===unit.unit&&<form className='cos-camera-status-edit' onSubmit={event=>event.preventDefault()} aria-label={'Hand edit for '+unit.unit}>
     <p>Where a unit is, its site and its address are yours to set. Up or down always stays whatever {SOURCE_LABEL[sourceOf(unit)]} reports.</p>
     <div className='cos-camera-status-edit-row'>
      <span id={'placement-'+unit.unit}>Field or shop</span>
      <div role='group' aria-labelledby={'placement-'+unit.unit} className='cos-camera-status-toggle'>
       {(['FIELD','SHOP'] as const).map(value=><button key={value} type='button' aria-pressed={draft.placement===value} disabled={saving}
        onClick={()=>setDraft({...draft,placement:value})}>{value==='FIELD'?'In the field':'In the shop'}</button>)}
      </div>
      <button type='button' disabled={saving||draft.placement===unit.placement} onClick={()=>submit(unit,'placement',draft.placement,draft.reason)}>Save</button>
      {unit.handEdits?.placement&&<button type='button' disabled={saving} onClick={()=>submit(unit,'placement',null,draft.reason)}>Use {SOURCE_LABEL[sourceOf(unit)]}</button>}
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
    </form>}
   </li>)}
   {!shown.length&&<li className='cos-camera-status-empty'>{loading?'Reading Star4Live…':error?'No readings to show.':query?'No unit matches that search.':'No units in this group.'}</li>}
  </ul>
 </section>;
}
