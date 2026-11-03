import {useState} from 'react';
import {fleetEquipmentTotals,type EquipmentGroup} from './fleetEquipmentTotalsModel';
import type {FleetCommandCenterData,FleetCommandProduct} from './fleetCommandCenterModel';
import FleetCardIcon from './FleetCardIcon';
import FleetVerifyNow from './FleetVerifyNow';
const titles={cameras:'Camera units',helios:'Helios',stands:'Stands'};
type Status='all'|'online'|'offline'|'unverified';
export default function FleetEquipmentTotals({upload,data,now,onView,onOpen,onVerified}:{upload:unknown;data:FleetCommandCenterData|null;now:number;onView:(group:EquipmentGroup,placement:'field'|'shop'|'all')=>void;onOpen:(product:FleetCommandProduct)=>void;onVerified?:()=>Promise<unknown>}){
 const totals=fleetEquipmentTotals(upload,data,now);
 const [selection,setSelection]=useState<{group:EquipmentGroup;status:Status}|null>(null);
 const [verificationBusy,setVerificationBusy]=useState(false);
 const current=totals?.find(t=>t.key===selection?.group);
 const products=current?.products.filter(p=>selection?.status==='all'||p.status===selection?.status)||[];
 return <section className='cos-equipment-totals' aria-label='Equipment family totals'>
  <div className='cos-equipment-total-grid'>{(['cameras','helios','stands'] as const).map(key=>{
   const total=totals?.find(t=>t.key===key);
   return <article key={key} className={'cos-equipment-total-card cos-equipment-total-'+key}>
    <h2><FleetCardIcon kind={key==='helios'?'battery':key==='stands'?'inventory':'camera'}/>{titles[key]}</h2>
    <button className='cos-equipment-total-number' disabled={!total} onClick={()=>onView(key,'all')} aria-label={'View all '+titles[key]}><span>Inventory</span><strong>{total?.total??'—'}</strong></button>
    <div className='cos-equipment-placements'>{(['field','shop'] as const).map(placement=><button key={placement} disabled={!total} onClick={()=>onView(key,placement)}>{placement==='field'?'Field':'Shop'} <b>{total?.[placement]??'—'}</b></button>)}</div>
    {key!=='stands'&&<><small className='cos-equipment-health-scope'>Field camera / connection status</small><div className='cos-equipment-total-statuses'>{(['online','offline','unverified'] as const).map(status=><button key={status} className={'cos-total-status-'+status} disabled={!total||!data} aria-pressed={selection?.group===key&&selection.status===status} aria-label={titles[key]+' '+status+' '+(total?.[status]??'unavailable')} onClick={()=>setSelection({group:key,status})}><i aria-hidden='true'/><span>{status==='online'?'Online':status==='offline'?'Offline':'Unverified'}</span><b>{total?.[status]??'—'}</b></button>)}</div></>}
    {key==='helios'&&total&&<p className='cos-helios-count-equation'>{total.total} inventory = {total.field} Field + {total.shop} Shop. Field: {total.online} online + {total.offline} offline + {total.unverified} unverified.</p>}
    <footer><small>{key==='stands'?'Power & support · 0 cameras':key==='helios'?'Victron power inside Helios cards':'Helios included in camera totals'}</small><button disabled={!total} onClick={()=>onView(key,'field')}>View {key==='cameras'?'cameras':key} →</button></footer>
   </article>;
  })}</div>
  <p className='cos-equipment-totals-note'>Totals include Field + Shop. Online, Offline and Unverified count Field units only. Helios is included in camera totals; stands stay outside camera outages.</p>
  {selection&&current&&<section className='cos-equipment-status-list' aria-label={titles[selection.group]+' '+selection.status+' Field units'}>
   <div><h3>{titles[selection.group]} · {selection.status==='unverified'?'Unverified':selection.status==='online'?'Online':selection.status==='offline'?'Offline':'All'} · {products.length} Field units</h3><button onClick={()=>setSelection(null)} aria-label='Close status list'>×</button></div>
   {selection.status==='unverified'&&onVerified&&<FleetVerifyNow disabled={verificationBusy} onBusyChange={setVerificationBusy} key={selection.group} products={products} onComplete={onVerified} label={products.length?'Verify all '+products.length+' now':'No units left to verify'}/>}
   {products.length?<ul>{products.map(p=><li key={p.productId}><div><strong>{p.unitNumber}</strong><small>{p.customer||'Customer not supplied'} · Product {p.productId}</small><small>{p.address||'Address not supplied'}</small><small>{p.reason}</small></div>{p.status==='unverified'&&onVerified&&<FleetVerifyNow disabled={verificationBusy} onBusyChange={setVerificationBusy} products={[p]} onComplete={onVerified}/>}<button onClick={()=>onOpen(p)}>Open record →</button></li>)}</ul>:<p>{!data?'Validated health is unavailable.':'No Field units match this status.'}</p>}
  </section>}
 </section>;
}
