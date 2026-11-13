import {useCallback,useEffect,useMemo,useState} from 'react';
import {api} from './api';
import {cameraTime} from './fieldCameraHealth';
import {STAR_UNIT_STATUS_CONTRACT,type UnitCameraStatus,type UnitCameraStatusReport} from '../shared/starUnitStatus';
import './fleetCameraStatus.css';

type Report=UnitCameraStatusReport&{refreshedAt?:string;source?:string};
type Group='field'|'attention'|'shop-online'|'shop';

const GROUPS:{id:Group;label:string;note:string}[]=[
 {id:'field',label:'In the field',note:'Units with a camera reporting from a customer site.'},
 {id:'attention',label:'Needs attention',note:'Field units with at least one camera not reporting as online.'},
 {id:'shop-online',label:'Online in the shop',note:'Online, still in root. It stays in the shop until a technician moves it to a site.'},
 {id:'shop',label:'In the shop',note:'Everything in root, online or not. Shop units never count as a field outage.'},
];
const DOT:Record<UnitCameraStatus['state'],string>={GREEN:'online',YELLOW:'offline',RED:'offline',UNKNOWN:'unknown'};
const STATE_LABEL:Record<UnitCameraStatus['state'],string>={GREEN:'All cameras up',YELLOW:'Some cameras down',RED:'All cameras down',UNKNOWN:'Not verified'};

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
  return [unit.unit,unit.site||'',unit.publicIp||''].some(field=>field.toLowerCase().includes(text));
 });
}

export default function FleetCameraStatus({now=Date.now()}:{now?:number}){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [group,setGroup]=useState<Group>('field'),[query,setQuery]=useState('');
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
 const counts=report?.counts,feed=report?.feed;
 const shown=useMemo(()=>report?groupedUnits(report.units,group,query):[],[report,group,query]);
 const tiles:[string,number|'—',string][]=counts?[
  ['FIELD UNITS',counts.field.units,'field'],
  ['ALL CAMERAS UP',counts.field.green,'online'],
  ['SOME CAMERAS DOWN',counts.field.yellow,'offline'],
  ['ALL CAMERAS DOWN',counts.field.red,'offline'],
  ['NOT VERIFIED',counts.field.unknown,'unknown'],
  ['ONLINE IN THE SHOP',counts.shop.onlineInShop,'shop'],
 ]:[];
 return <section className='cos-camera-status' aria-label='Unit camera status from Star4Live'>
  <header>
   <div>
    <h2>Camera status</h2>
    <p>Star4Live only. One unit is one line. Nothing here moves a unit or changes inventory.</p>
   </div>
   <div className='cos-camera-status-read'>
    <button type='button' disabled={loading} onClick={()=>read()}>{loading?'↻ Reading…':'↻ Refresh'}</button>
    <small>{feed?.syncedAt?'Star4Live reading '+cameraTime(feed.syncedAt,now):loading?'Reading Star4Live…':'No Star4Live reading'}</small>
   </div>
  </header>
  {feed&&!feed.fresh&&<p className='cos-camera-status-stale' role='status'>
   <strong>Star4Live has not reported recently.</strong> Every unit reads Not verified until the next good sync. No unit is called offline on an old reading.
   {feed.status&&feed.status!=='ok'?' Last sync status: '+feed.status+'.':''}
  </p>}
  {error&&<p className='cos-camera-status-error' role='alert'>{error}{report?' The readings below are from the time above.':''}</p>}
  {counts&&<div className='cos-camera-status-tiles'>{tiles.map(([label,count,kind])=><div key={label} className={'cos-camera-status-tile cos-camera-tile-'+kind}>
   {['online','offline','unknown'].includes(kind)&&<i className={'cos-board-status-dot cos-board-dot-'+kind} aria-hidden='true'/>}
   <span>{label}</span><strong>{count}</strong>
  </div>)}</div>}
  <nav className='cos-camera-status-groups' aria-label='Camera status groups'>{GROUPS.map(item=><button key={item.id} type='button' aria-current={group===item.id?'page':undefined} onClick={()=>setGroup(item.id)}>
   {item.label}{report&&<b>{groupedUnits(report.units,item.id,'').length}</b>}
  </button>)}</nav>
  <p className='cos-camera-status-note'>{GROUPS.find(item=>item.id===group)!.note}</p>
  <div className='cos-camera-status-search'>
   <label className='sr-only' htmlFor='cos-camera-status-search'>Find a unit, site or IP</label>
   <input id='cos-camera-status-search' type='search' placeholder='Find a unit, site or IP…' value={query} onChange={event=>setQuery(event.target.value)}/>
   {query&&<button type='button' aria-label='Clear search' onClick={()=>setQuery('')}>×</button>}
  </div>
  <ul className='cos-camera-status-list'>
   {shown.map(unit=><li key={unit.unit} className={'cos-camera-status-row cos-camera-state-'+unit.state.toLowerCase()}>
    <div className='cos-camera-status-unit'>
     <strong><i className={'cos-board-status-dot cos-board-dot-'+DOT[unit.state]} aria-hidden='true'/>{unit.unit}</strong>
     <small>{unit.placement==='FIELD'?(unit.siteNamePending?unit.site+' · name not entered yet':unit.site):unit.onlineInShop?'ONLINE IN THE SHOP · root':'SHOP · root'}</small>
    </div>
    <div className='cos-camera-status-detail'>
     <span>{STATE_LABEL[unit.state]} · {unit.online} of {unit.cameras} up</span>
     {unit.down.length>0&&<small>Down: {unit.down.map(camera=>camera.name+(camera.status==='unknown'?' (not verified)':'')).join(', ')}</small>}
     <small>{unit.publicIp?unit.publicIp+' · ':''}{unit.observedAt?'read '+cameraTime(unit.observedAt,now):'no reading time'}</small>
    </div>
   </li>)}
   {!shown.length&&<li className='cos-camera-status-empty'>{loading?'Reading Star4Live…':error?'No readings to show.':query?'No unit matches that search.':'No units in this group.'}</li>}
  </ul>
 </section>;
}
