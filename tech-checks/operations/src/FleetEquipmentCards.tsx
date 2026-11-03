import type {FleetDashboardRow,Signal} from './fleetDashboardModel';
import FleetVerifyNow from './FleetVerifyNow';
import FleetCardIcon from './FleetCardIcon';
import FleetBatterySummary from './FleetBatterySummary';
import FleetVictronSummary from './FleetVictronSummary';
import LastKnownCameraStatus from './LastKnownCameraStatus';
import type {LastKnownCamera} from './cameraLastKnown';
import {unitHealthLabel} from './fieldCameraHealth';

const words:Record<Signal,string>={online:'Online',offline:'Offline',unknown:'Unverified',support:'No cameras',not_available:'Not available'};
function SignalValue({label,state}:{label:string;state:Signal}){return <div className={'cos-equipment-signal cos-signal-'+state}><span>{label}</span><strong><i aria-hidden='true'/> {words[state]}</strong></div>;}
/** Presentation of reconciled rows only; never creates status, identity, or power evidence. */
export default function FleetEquipmentCards({rows,now,onOpen,lastKnown,onVerified,verifyProduct}:{onVerified?:(connections?:unknown)=>Promise<unknown>;verifyProduct?:(row:FleetDashboardRow)=>{productId:string;unitNumber:string}|null;rows:FleetDashboardRow[];now:number;lastKnown:(row:FleetDashboardRow)=>LastKnownCamera|null;onOpen:(id:string)=>void}){
 return <div className='cos-equipment-grid'>{rows.map(row=>{
 const product=verifyProduct?.(row);
 const helios=row.family.toUpperCase().startsWith('HELIOS');
 return <article key={row.id} className={'cos-equipment-card'+(helios?' cos-equipment-helios':'')+(row.support?' cos-equipment-stand':'')}>
  <header><div className='cos-equipment-icon'><FleetCardIcon kind={row.support?'inventory':helios?'battery':'camera'}/></div><div><small>{row.support?'STANDS & SUPPORT':helios?'HELIOS / SOLAR POWER':row.family}</small><h3>{row.displayName||row.name}</h3></div><span className={'cos-equipment-placement cos-placement-'+row.placement}>{row.placement==='field'?'Field':row.placement==='shop'?'Shop':'Review'}</span></header>
  <div className='cos-equipment-site'><strong>{row.displayCustomer||row.unit.site||row.unit.customer||'Customer not supplied'}</strong><p>{(row.displayAddress?.text??row.unit.address)||'Address not supplied'}</p><small>{row.displayAddress?.label||'Installation address'}</small></div>
  {row.support?<div className='cos-equipment-support-note'><FleetCardIcon kind='inventory'/><div><strong>Power & support equipment</strong><small>0 cameras · excluded from camera outages</small></div></div>:<><div className='cos-equipment-signals'><SignalValue label='Camera / connection' state={row.cameraState}/><SignalValue label='Router' state={row.routerState}/></div><small className='cos-equipment-evidence'>{unitHealthLabel(row.camera)}</small><LastKnownCameraStatus observation={lastKnown(row)} now={now}/></>}
  {row.cameraState==='unknown'&&row.placement==='field'&&!row.support&&product&&onVerified&&<FleetVerifyNow products={[product]} onComplete={onVerified}/>}
  {helios?<div className='cos-equipment-power'><FleetBatterySummary row={row} now={now}/><FleetVictronSummary row={row} now={now}/></div>:!row.support&&<FleetBatterySummary row={row} now={now} compact/>}
  <div className='cos-equipment-actions'><small>{row.locationVerified?'Verified installation':row.displayAddress?.text||row.unit.address?'Recorded service address':'Address needed'}</small><button data-unit-id={row.id} onClick={()=>onOpen(row.id)}>Open unit <span aria-hidden='true'>↗</span></button></div>
 </article>;})}</div>;
}
