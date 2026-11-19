import {useState} from 'react';
import {fleetEquipmentTotals,unverifiedTile,type EquipmentGroup} from './fleetEquipmentTotalsModel';
import {countForPath, type SharedMonitoredCount} from './watchfulMonitoredCounts';
import {formatObservedCt} from './watchfulObservation';
import type {FleetCommandCenterData,FleetCommandProduct} from './fleetCommandCenterModel';
import FleetCardIcon from './FleetCardIcon';
import FleetVerifyNow from './FleetVerifyNow';
const titles={cameras:'Camera units',helios:'Helios',stands:'Stands'};
type Status='all'|'online'|'offline'|'unverified'|'device_link'|'no_reading';
export default function FleetEquipmentTotals({upload,data,now,onView,onOpen,onVerified,onDeviceLinks,healthCurrent=true,readingNote='',monitored=null}:{readingNote?:string;upload:unknown;data:FleetCommandCenterData|null;now:number;onView:(group:EquipmentGroup,placement:'field'|'shop'|'all')=>void;onOpen:(product:FleetCommandProduct)=>void;onVerified?:(connections?:unknown)=>Promise<unknown>;onDeviceLinks?:()=>void;healthCurrent?:boolean;monitored?:SharedMonitoredCount|null}){
 const totals=fleetEquipmentTotals(upload,data,now);
 const shared=monitored??countForPath('FleetEquipmentTotals',{snapshot:null,mhelp:[],now});
 const [selection,setSelection]=useState<{group:EquipmentGroup;status:Status}|null>(null);
 const [verificationBusy,setVerificationBusy]=useState(false);
 const current=totals?.find(t=>t.key===selection?.group);
 const products=current?.products.filter(p=>{if(!selection||selection.status==='all')return true;if(selection.status==='device_link')return unverifiedTile(p)==='device_link';if(selection.status==='no_reading')return p.status==='unverified'&&unverifiedTile(p)==='no_reading';return p.status===selection.status;})||[];
 const stands=totals?.find(t=>t.key==='stands');
 const cameras=totals?.find(t=>t.key==='cameras');
 return <section className='cos-equipment-totals' aria-label='Equipment family totals'>
  <p className='cos-monitored-count'>Monitored units {shared.fresh&&shared.units!==null?shared.units:'Unknown'} · Cameras {shared.cameras?shared.cameras.up+' up, '+shared.cameras.down+' down':'Unknown'}{shared.oldestObservedAt?' · Observed '+formatObservedCt(shared.oldestObservedAt):''}</p>
  {shared.monitoredOnImmix.length>0&&<p className='cos-immix-monitored'>{shared.monitoredOnImmix[0].groupLabel} · {shared.monitoredOnImmix.length} · {shared.monitoredOnImmix[0].statusLabel}</p>}
  {shared.amberFlags.map(flag=><p className='cos-monitored-amber' key={flag.name}>{flag.flag}</p>)}
  {shared.matchExceptions.map(flag=><p className='cos-monitored-exception' key={flag.name}>{flag.name}: {flag.reason}</p>)}
  {shared.needsCheck.map(flag=><p className='cos-monitored-check' key={flag.name}>{flag.name}: {flag.reason}</p>)}
  <div className='cos-equipment-total-grid'>{(['cameras','helios','stands'] as const).map(key=>{
   const total=totals?.find(t=>t.key===key);
   return <article key={key} className={'cos-equipment-total-card cos-equipment-total-'+key}>
    <h2><FleetCardIcon kind={key==='helios'?'battery':key==='stands'?'inventory':'camera'}/>{titles[key]}</h2>
    <button className='cos-equipment-total-number' disabled={!total} onClick={()=>onView(key,'all')} aria-label={'View all '+titles[key]}><span>Inventory</span><strong>{total?.total??'—'}</strong></button>
    {key!=='stands'&&<><small className='cos-equipment-health-scope'>Field camera / connection status</small><div className='cos-equipment-total-statuses'>{(['online','offline'] as const).map(status=><button key={status} className={'cos-total-status-'+status} disabled={!total||!data||!healthCurrent} aria-pressed={selection?.group===key&&selection.status===status} aria-label={titles[key]+' '+status+' '+(healthCurrent?(total?.[status]??'unavailable'):'update needed')} onClick={()=>setSelection({group:key,status})}><i aria-hidden='true'/><span>{status==='online'?'Online':'Offline'}</span><b>{healthCurrent?(total?.[status]??'—'):'—'}</b></button>)}<button className='cos-total-status-device-link' disabled={!total||!data||!healthCurrent} aria-pressed={selection?.group===key&&selection.status==='device_link'} aria-label={titles[key]+' unverified, device link needed '+(healthCurrent?(total?.unverifiedDeviceLink??'unavailable'):'update needed')} onClick={()=>onDeviceLinks?onDeviceLinks():setSelection({group:key,status:'device_link'})}><i aria-hidden='true'/><span>Unknown</span><b>{healthCurrent?(total?.unverifiedDeviceLink??'—'):'—'}</b></button><button className='cos-total-status-unverified' disabled={!total||!data||!healthCurrent} aria-pressed={selection?.group===key&&selection.status==='no_reading'} aria-label={titles[key]+' unverified, no reading '+(healthCurrent?(total?.unverifiedNoReading??'unavailable'):'update needed')} onClick={()=>setSelection({group:key,status:'no_reading'})}><i aria-hidden='true'/><span>Unknown</span><b>{healthCurrent?(total?.unverifiedNoReading??'—'):'—'}</b></button></div></>}
    <footer><small>{key==='stands'?'Power & support · 0 cameras':key==='helios'?'Victron power inside Helios cards':'Helios included in camera totals · inventory count, not a live reading'}</small><button disabled={!total} onClick={()=>onView(key,'field')}>View {key==='cameras'?'cameras':key} →</button></footer>
   </article>;
  })}</div>
  <p className='cos-equipment-totals-note'>{readingNote&&<strong>{readingNote} </strong>}{healthCurrent?'Online, Offline and Unknown count Field units only.':'Inventory remains visible from the saved board. Health counts stay hidden until a fresh completed board is available.'} Helios is included in camera totals; stands stay outside camera outages. {cameras&&stands?<>Online + offline + Unknown + no-camera = Field ({cameras.online}+{cameras.offline}+{cameras.unverified}+{stands.field}).</>:null}</p>
  <details className='cos-equipment-admin'><summary>Admin inventory details</summary><div className='cos-equipment-placements'>{totals?.map(total=><div key={total.key}>{(['field','shop'] as const).map(placement=><button key={total.key+placement} disabled={!total} onClick={()=>onView(total.key,placement)}>{placement==='field'?'Field':'Shop'} <b>{total[placement]}</b></button>)}</div>)}{healthCurrent&&totals?.filter(total=>total.key==='helios').map(total=><p key={total.key} className='cos-helios-count-equation'>{total.total} inventory = {total.field} Field + {total.shop} Shop. Field: {total.online} online + {total.offline} offline + {total.unverified} unverified.</p>)}<p>Field + Shop totals stay on this admin detail. They are not the monitored count.</p></div></details>
  {selection&&current&&<section className='cos-equipment-status-list' aria-label={titles[selection.group]+' '+(selection.status==='no_reading'?'unverified':selection.status)+' Field units'}>
   <div><h3>{titles[selection.group]} · {selection.status==='device_link'?'Unverified, device link needed':selection.status==='no_reading'?'Unverified, no reading':selection.status==='unverified'?'Unverified':selection.status==='online'?'Online':selection.status==='offline'?'Offline':'All'} · {products.length} Field units</h3><button onClick={()=>setSelection(null)} aria-label='Close status list'>×</button></div>
   {(selection.status==='unverified'||selection.status==='no_reading')&&onVerified&&<FleetVerifyNow disabled={verificationBusy} onBusyChange={setVerificationBusy} key={selection.group} products={products} onComplete={onVerified} label={products.length?'Verify all '+products.length+' now':'No units left to verify'}/>}
   {products.length?<ul>{products.map(p=><li key={p.productId}><div><strong>{p.unitNumber}</strong><small>{p.customer||'Customer not supplied'} · Product {p.productId}</small><small>{p.address||'Address not supplied'}</small><small>{p.reason}</small></div>{p.status==='unverified'&&onVerified&&<FleetVerifyNow disabled={verificationBusy} onBusyChange={setVerificationBusy} products={[p]} onComplete={onVerified}/>}<button onClick={()=>onOpen(p)}>Open record →</button></li>)}</ul>:<p>{!data?'Validated health is unavailable.':'No Field units match this status.'}</p>}
  </section>}
 </section>;
}
