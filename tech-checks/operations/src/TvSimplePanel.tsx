import {useEffect,useState} from 'react';
import {loadTvFleetFeeds} from './tvFleetFeeds';
import {fleetInventorySnapshot} from './useFleetInventory';
import {manualShopInventory} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {mhelpProviderFleet,providerTitles} from './mhelpProviderFleet';
import {mhelpFieldHealth} from './mhelpFieldHealth';
import {readRecordedRoster} from './fleetRecordedRoster';
import {fleetDashboardRows} from './fleetDashboardModel';
import {readVrmFleetConfig} from '../../supabase/functions/cos-operations-pages/vrm';
import {readDashboardPower} from './vrmReadOnlyModel';
import VrmReadOnlyDashboard from './VrmReadOnlyDashboard';
import {readRouterSnapshot,routerStatus} from '../../supabase/functions/cos-operations-pages/routers';
import {readOwnerCustody,type OwnerCustody} from './ownerCustody';
import './vrm.css';
export const SIMPLE_TV_PANELS=[['overview','Fleet overview'],['camera','Camera outages'],['providers','Camera provider status'],['inventory','Inventory totals'],['map','Field map'],['power','Victron Power'],['routers','InHand Routers'],['team','Team and outstanding transfers']] as const;
export type SimpleTvPanel=typeof SIMPLE_TV_PANELS[number][0];
type Api={get:(path:string)=>Promise<{data:any}>};
export default function TvSimplePanel({mode,api,page,refreshId}:{mode:SimpleTvPanel;api:Api;page:number;refreshId:number}){
 const [value,setValue]=useState<any>(null),[error,setError]=useState(''),[readAt,setReadAt]=useState(0),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  let active=true,running=false;setValue(null);setError('');setReadAt(0);
  const load=async()=>{if(running)return;running=true;try{
   let result:any;
   if(mode==='team')result=await readOwnerCustody();
   else if(mode==='power'){const raw=(await api.get('/api/vrm-fleet')).data;const fleet=readVrmFleetConfig(raw);result={fleet,power:readDashboardPower(raw.power,fleet.items)};}
   else if(mode==='routers')result=readRouterSnapshot((await api.get('/api/routers')).data);
   else{let field:any=null,health:any=null;const failures=await loadTvFleetFeeds(api,{field:row=>{field=row;},health:row=>{health=row;},routers:()=>{}});if(!field)throw new Error(failures.join(' ')||'Inventory source unavailable.');result={field,health,failures};}
   if(active){setValue(result);setReadAt(Date.now());setError('');}
  }catch(cause){if(active){setValue(null);setError(cause instanceof Error?cause.message:'Source unavailable.');}}finally{running=false;}};
  const invalid=()=>{active=false;setValue(null);setError('Session changed. Sign in again.');};
  void load();const timer=setInterval(()=>{setNow(Date.now());void load();},60000);window.addEventListener('cos-private-data-invalidated',invalid);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('cos-private-data-invalidated',invalid);};
 },[mode,api,refreshId]);
 const chunk=<T,>(rows:T[],size=6)=>{const start=(page%Math.max(1,Math.ceil(rows.length/size)))*size;return rows.slice(start,start+size);};
 let content;
 if(!value)content=<p role={error?'alert':'status'}>{error?'UNAVAILABLE · '+error:'Reading saved source records…'}</p>;
 else if(mode==='team'){
  const custody=value as OwnerCustody,transfers=custody.sources.handoffs.value,returns=custody.sources.returns.value;
  content=<><p>Awaiting receipt / review: {transfers?transfers.items.filter(row=>['awaiting_service','discrepancy'].includes(row.state)).length:'Unavailable'}{transfers?.limited?' · loaded records only; feed limit reached':''} · Returns awaiting IT: {returns?.pending??'Unavailable'}</p>{Object.entries(custody.sources).map(([key,source])=>source.error&&<p role='alert' key={key}>{source.error}</p>)}<div className='tv-simple-grid'>{chunk(custody.sources.trucks.value||[]).map(truck=><article key={truck.id}><h3>{truck.name}</h3><p>{truck.units.map(unit=>unit.family+' '+unit.tag+' · '+unit.state).join(' / ')}</p><small>Saved truck inventory, not reconciled custody.</small></article>)}</div></>;
 }else if(mode==='power'){
  content=<><p>Fleet sync: {value.fleet.sync.state}</p>{value.fleet.items.length?chunk<any>(value.fleet.items,1).map(unit=><article key={unit.installationId}><h3>{unit.name} · Installation {unit.installationId}</h3><VrmReadOnlyDashboard unit={unit} rows={value.power.rows} invalid={value.power.invalid} now={now}/></article>):<p>No verified connected installations in this saved source.</p>}</>;
 }else if(mode==='routers')content=<><p>Port reachability only. Cellular/cloud connectivity and GPS are unverified.</p><div className='tv-simple-grid'>{chunk<any>(value.items).map(router=><article key={router.id}><h3>{router.name}</h3><b>{routerStatus(router,now)}</b><p>{router.candidateUnit?.unitNumber||'Equipment association unverified'} · Saved IP {router.publicIp||router.unitIp||'unavailable'}</p><small>{router.checkedAt||'Observation time unavailable'} · Camera Health port observation</small></article>)}</div>{!value.items.length&&<p>No routers in the saved source.</p>}</>;
 else{
  let inventory;try{inventory=fleetInventorySnapshot(value.field,now);}catch{}
  if(mode==='providers'){
   const units=value.field.inventoryItems||value.field.items,roster=readRecordedRoster(value.field.fleetRoster,units).roster;
   const products=mhelpFieldHealth(manualShopInventory(value.field.uploadInventory,value.field.manualPlacementOverrides),roster,fleetDashboardRows(units,value.health,null,null,now),now);
   const groups=mhelpProviderFleet(manualShopInventory(value.field.uploadInventory,value.field.manualPlacementOverrides),products,Boolean(value.health),now);
   content=groups?<div className='tv-simple-grid'>{groups.groups.filter(group=>group.provider!=='support').map(group=><article key={group.provider}><h3>{providerTitles[group.provider]}</h3><p>ONLINE {group.counts.online} · OFFLINE {group.counts.offline} · UNVERIFIED {group.counts.unverified}</p><small>{group.count} physical Field equipment records · not camera channels</small></article>)}</div>:<p role='alert'>Provider inventory unavailable. Missing evidence is not zero outages.</p>;
  }else content=inventory?<><div className='tv-simple-grid'>{[['Total equipment',inventory.authority.total],['Field',inventory.authority.field],['Shop / ROOT',inventory.authority.shop]].map(([label,count])=><article key={label}><h3>{label}</h3><strong>{count}</strong></article>)}</div><p>Each Product ID counted once in placement. Custody overlaps placement and is not added to these totals. Shop does not mean ready to deploy.</p><p>Inventory source saved {inventory.authority.receivedAt}{inventory.authority.stale?' · STALE':''}</p>{mode==='overview'&&<p>Camera evidence {value.health?'loaded; provider panel shows verified status':'UNAVAILABLE / UNVERIFIED'}. Map, power and router observations appear in their own panels.</p>}</>:<p role='alert'>Authoritative inventory unavailable. No substitute totals shown.</p>;
  if(value.failures.length)content=<>{content}<p role='alert'>{value.failures.join(' ')}</p></>;
 }
 return <section className='tv-simple-panel' aria-label={SIMPLE_TV_PANELS.find(([key])=>key===mode)?.[1]}>{content}<p className='tv-simple-timestamp'>{readAt?'Source read '+new Date(readAt).toLocaleString()+' · observation timestamps govern freshness':'No successful source read'}</p></section>;
}
