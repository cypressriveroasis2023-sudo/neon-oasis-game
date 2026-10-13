import {canonicalCameraUnit,fieldCameraHealth,isSupportEquipment,type FieldHealthUnit,type Health,type UnitCameraHealth} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';
import {isCurrentFieldPin,locationExplanation} from './fieldLocations';
import {routerStatus,type RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import {safeVrmPower,type SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import type {FleetDisplayAddress} from './fleetDisplayAddress';
import {cameraTimestamp} from './cameraEvidence';

export type Signal='online'|'offline'|'unknown'|'support'|'not_available';
export type DashboardUnit=FieldHealthUnit & Record<string,any>;
export type BatteryReading={source:string;percent:number;observedAt:string|null;fresh:boolean};
export type FleetDashboardRow={unit:DashboardUnit;displayAddress?:FleetDisplayAddress;displayCustomer?:string;id:string;name:string;displayName:string;family:string;provider:string;placement:'field'|'shop'|'unknown';retired:boolean;support:boolean;camera:UnitCameraHealth;cameraState:Signal;routerState:Signal;batteryState:Signal;batteryPercent:number|null;batteryReadIssue:string|null;batteryReadings:BatteryReading[];routers:RouterRow[];power:SafeVrmPower|null;locationVerified:boolean;locationNeedsReview:boolean;review:string[]};
export type FleetFilters={query:string;placement:string;family:string;provider:string;layer:'camera'|'router'|'battery';status:string;retired:boolean;nearbyId?:string;radius?:number;installationStatus?:string};
export const initialFleetFilters: FleetFilters={query:'',placement:'field',family:'all',provider:'all',layer:'camera',status:'all',retired:false,nearbyId:'',radius:10,installationStatus:'all'};
const combine=(states:Signal[]):Signal=>states.includes('offline')?'offline':states.length&&states.every(x=>x==='online')?'online':'unknown';
export function fleetDashboardRows(units:DashboardUnit[],health:Health|null,routers:RouterRow[]|null,vrm:any,now=Date.now()):FleetDashboardRow[]{
 const power=vrm&&Array.isArray(vrm.items)&&Array.isArray(vrm.power)?safeVrmPower(vrm.power,vrm.items,now):[];
 return units.map(unit=>{
  const key=canonicalCameraUnit(unit.unitNumber),family=key?.split('|')[0]||unit.modelName||'Other equipment',support=isSupportEquipment(unit),placement=inventoryPlacement(unit);
  const camera=fieldCameraHealth(unit,units,health,now),linkedRouters=(routers||[]).filter(r=>r.match==='exact_name'&&r.candidateUnit?.id===unit.id);
  const routerStates=linkedRouters.map(r=>routerStatus(r,now)).map(s=>s==='reachable'?'online':s==='unreachable'?'offline':'unknown') as Signal[];
  const matches=key?.startsWith('HELIOS|')?power.filter(r=>canonicalCameraUnit(r.name)===key):[];
  const p=matches.length===1&&vrm.items.filter((item:{name:string})=>canonicalCameraUnit(item.name)===key).length===1&&units.filter(u=>canonicalCameraUnit(u.unitNumber)===key).length===1?matches[0]:null;
  let batteryState:Signal='not_available',batteryPercent:number|null=null,batteryReadings:BatteryReading[]=[];
  const batteryReadIssue=key?.startsWith('HELIOS|')?(p?.errorCode||vrm?.sync?.error||vrm?.sync?.state==='error'?'Latest Victron read unavailable':vrm?.sync?.state==='stale'?'Victron sync is stale':null):null;
  if(key?.startsWith('HELIOS|')){
   batteryState='unknown';
   batteryReadings=(p?.measurements||[]).filter(m=>m.metric==='battery_soc').map(m=>({source:'Victron · '+m.source+' '+m.instance,percent:m.value,observedAt:cameraTimestamp(m.observedAt,now).at,fresh:cameraTimestamp(m.observedAt,now).fresh}));
   if(p&&!batteryReadIssue){const recent=p.measurements.filter(m=>cameraTimestamp(m.observedAt,now).fresh),soc=recent.filter(m=>m.metric==='battery_soc');
    // Multiple battery and system instances are normal in Victron. Surface the lowest recent charge.
    batteryPercent=soc.length?Math.min(...soc.map(m=>m.value)):null;
    batteryState=recent.some(m=>m.unit==='state'&&m.value>0)||batteryPercent!==null&&batteryPercent<20?'offline':batteryPercent!==null?'online':'unknown';}
  }else if(key?.startsWith('RECON2|')){
   const batteryRows=camera.identity==='matched'?camera.rows.filter(r=>r.evidence?.source==='Reconeyez'&&r.batteryEvidence):[];
   const readings=batteryRows.map(r=>r.batteryEvidence).filter(Boolean);
   batteryReadings=batteryRows.filter(r=>r.batteryEvidence!.percent!==null).map(r=>({source:'Reconeyez · '+r.name,percent:r.batteryEvidence!.percent!,observedAt:cameraTimestamp(r.batteryEvidence!.percentObservedAt,now).at,fresh:cameraTimestamp(r.batteryEvidence!.percentObservedAt,now).fresh}));
   const values=readings.filter(b=>b?.percent!==null&&cameraTimestamp(b?.percentObservedAt,now).fresh).map(b=>b!.percent!);
   batteryPercent=values.length?Math.min(...values):null;
   batteryState=combine(readings.map(b=>cameraTimestamp(b?.statusObservedAt,now).fresh&&b?.status?b.status==='normal'?'online':'offline':cameraTimestamp(b?.percentObservedAt,now).fresh&&b?.percent!==null?(b!.percent!<20?'offline':'online'):'unknown'));
  }
  const locationVerified=isCurrentFieldPin(unit),locationNeedsReview=placement==='field'&&!locationVerified;
  const review=[...(placement==='unknown'?['Placement is unresolved. Check tracker and current mHelpDesk assignment.']:[]),...(camera.state==='unknown'?[camera.reason]:[]),...(locationNeedsReview?[locationExplanation(unit)]:[]),...(unit.mhelpLocationReviewReason?[String(unit.mhelpLocationReviewReason)]:[])];
  const providers=[...new Set(camera.rows.map(r=>r.evidence?.source).filter(Boolean))];
  return {unit,id:unit.id,name:unit.unitNumber,displayName:unit.uploadDisplayUnitNumber||unit.unitNumber,family,provider:providers.join(' / ')||'Unmatched provider',placement,retired:unit.activeInventoryEligible===false||['retired','decommissioned','deleted','stolen'].includes(String(unit.status||'')),support,camera,cameraState:camera.state,routerState:routers?combine(routerStates):'unknown',batteryState,batteryPercent,batteryReadIssue,batteryReadings,routers:linkedRouters,power:p,locationVerified,locationNeedsReview,review};
 });
}
export function filterFleetDashboard(rows:FleetDashboardRow[],filters:FleetFilters,view='map'){
 const q=filters.query.trim().toLowerCase(),nearby=rows.find(r=>r.id===filters.nearbyId&&r.placement==='field'&&r.locationVerified);
 const miles=(r:FleetDashboardRow)=>{const rad=(v:number)=>v*Math.PI/180,a=rad(Number(nearby!.unit.latitude)),b=rad(Number(r.unit.latitude)),d=a-b,l=rad(Number(nearby!.unit.longitude)-Number(r.unit.longitude));return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,Math.sin(d/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(l/2)**2)));};
 return rows.filter(r=>{
  const state=r.support?'support':r[filters.layer+'State' as 'cameraState'|'routerState'|'batteryState'];
  return (filters.retired||!r.retired)&&(filters.placement==='all'||r.placement===filters.placement)&&(filters.family==='all'||r.family===filters.family)&&(filters.provider==='all'||r.provider===filters.provider)
   &&(!q||[r.name,r.displayName,r.family,r.provider,r.displayCustomer,r.displayAddress?.text,r.unit.customer,r.unit.site,r.unit.address,r.unit.activeJobNumber].filter(Boolean).join(' ').toLowerCase().includes(q))
   &&(filters.status==='all'||filters.status==='operational'&&['online','offline','support'].includes(state)||filters.status===state)
   &&(!nearby||r.placement==='field'&&r.locationVerified&&miles(r)<=(filters.radius||10))
   &&(!filters.installationStatus||filters.installationStatus==='all'||filters.installationStatus==='tracker'&&r.unit.readOnly===true||filters.installationStatus==='missing'&&r.locationNeedsReview||filters.installationStatus===r.unit.status)
   &&(view!=='verify'||r.locationNeedsReview);
 });
}
export function fleetDashboardSummary(rows:FleetDashboardRow[]){return {field:rows.filter(r=>r.placement==='field').length,online:rows.filter(r=>!r.support&&r.cameraState==='online').length,offline:rows.filter(r=>!r.support&&r.cameraState==='offline').length,unknown:rows.filter(r=>!r.support&&r.cameraState==='unknown').length,verify:rows.filter(r=>r.locationNeedsReview).length};}
export function discoveryNeedsSetup(items:any[],rows:FleetDashboardRow[]){
 return items.filter(item=>{const key=typeof item.name==='string'?canonicalCameraUnit(item.name):null;return key?.startsWith('HELIOS|')&&Number.isSafeInteger(item.installationId)&&rows.filter(r=>canonicalCameraUnit(r.name)===key).length!==1;});
}
/** Export only displayed safe fields; neutralize spreadsheet formulas. */
export function fleetDashboardCsv(rows:FleetDashboardRow[]){
 const cell=(v:unknown)=>{const text=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';};
 return ['Unit,Display label,Family,Provider,Placement,Customer,Site,Address,Camera,Router,Battery,Installation location verified,Review,Address source,Address recorded,Installation evidence address',...rows.map(r=>[r.name,r.displayName,r.family,r.provider,r.placement,r.displayCustomer??r.unit.customer,r.unit.site,r.displayAddress?.text??r.unit.address,r.cameraState,r.routerState,r.batteryState,r.locationVerified,r.review.join('; '),r.displayAddress?.label||'Installation address',r.displayAddress?.recordedAt||'',r.unit.address].map(cell).join(','))].join('\r\n');
}

export function fleetVrmReadAllowed(session:{role?:unknown;legacyOwner?:unknown;features?:Record<string,unknown>}){return session.features?.vrmRead===true||(session.role==='Owner'&&session.legacyOwner!==false&&session.features?.vrmRead!==false);}
