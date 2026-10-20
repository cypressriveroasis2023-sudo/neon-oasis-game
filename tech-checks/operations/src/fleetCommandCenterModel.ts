import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {mhelpProviderFleet,type ProviderProduct,type ProviderCounts,type FieldProvider} from './mhelpProviderFleet';
import {recordedAddressText} from './fleetDisplayAddress';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {cameraTimestamp} from './cameraEvidence';
import {readVrmFleetConfig} from '../../supabase/functions/cos-operations-pages/vrm';
import type {FieldProduct} from './mhelpFieldHealth';
import type {FleetDashboardRow} from './fleetDashboardModel';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';

export type FleetCommandStatus='online'|'offline'|'unverified'|'not_applicable';
export type FleetCommandProduct=ProviderProduct & {
  address:string;
  site:string;
  mappingIssue:boolean;
  lifecycle:string;
  status:FleetCommandStatus;
  system:FieldProvider;
};
export type FleetCommandPanel={
  key:'star4live'|'avigilon'|'reconeyez'|'victron';
  title:string;
  count:number|null;
  counts:ProviderCounts|null;
  products:FleetCommandProduct[];
  lastCheck:string|null;
  note:string;
};
export type FleetCommandCenterData={
  total:number;
  field:number;
  shop:number;
  sourceAt:string;
  sourceStale:boolean;
  healthVerified:boolean;
  items:FleetCommandProduct[];
  counts:{online:number;offline:number;unverified:number;support:number;attention:number;unmapped:number};
  panels:FleetCommandPanel[];
  addressCoverage:{located:number;missing:number}|null;
};

/** Reporting only: source Product IDs are never linked to devices by names, IPs, or site text. */
export function buildFleetCommandCenter(
  upload:unknown,fieldHealth:{total:number;items:FieldProduct[]}|null,
  healthReadSucceeded:boolean,rows:FleetDashboardRow[],
  addressMap:MhelpAddressMapResult|null,vrm:unknown,now=Date.now(),
  cameraCheckedAt:string|null=null
):FleetCommandCenterData|null {
  const authority=readMhelpInventoryAuthority(upload,now);
  const provider=mhelpProviderFleet(upload,fieldHealth,healthReadSucceeded,now);
  if(!authority||!provider||provider.total!==authority.field)return null;
  const sourceRecords=(upload as {records:Array<Record<string,unknown>>}).records.filter(p=>p.placement==='FIELD');
  const recordById=new Map(sourceRecords.map(p=>[String(p.productId),p]));
  const validAddresses=addressMap?.sourceSha256===authority.sourceSha256
    &&addressMap.totalField===authority.field ? addressMap : null;
  const points=new Set(validAddresses?.pins.map(p=>p.productId)||[]);
  const addressById=new Map([...(validAddresses?.pins||[]),...(validAddresses?.reviews||[])].map(p=>[p.productId,p.address]));
  const items:FleetCommandProduct[]=provider.groups.flatMap(group=>group.items.map(p=>{
    const source=recordById.get(p.productId);
    if(!source)throw Error('The Field source and provider Product IDs differ.');
    const location=source.sourceAddress;
    const address=(addressById.get(p.productId)||recordedAddressText(location)||'').trim();
    const status=group.provider==='support'?'not_applicable':p.healthStatus;
    return {...p,status,system:group.provider,address,
      site:typeof source.site==='string'?source.site:'',
      mappingIssue:Boolean(validAddresses)&&!points.has(p.productId),
      lifecycle:typeof source.lifecycle==='string'?source.lifecycle:'UNFLAGGED'};
  }));
  if(items.length!==authority.field||new Set(items.map(p=>p.productId)).size!==authority.field)
    throw Error('Field inventory violates unique Product-ID accounting.');
  const count=(status:FleetCommandStatus)=>items.filter(p=>p.status===status).length;
  const counts={
    online:count('online'),offline:count('offline'),unverified:count('unverified'),
    support:count('not_applicable'),
    attention:items.filter(p=>p.status==='offline'||p.status==='unverified'||p.mappingIssue).length,
    unmapped:validAddresses?validAddresses.unlocated:0
  };
  if(counts.online+counts.offline+counts.unverified+counts.support!==authority.field
    ||authority.field+authority.shop!==authority.total)throw Error('Fleet accounting does not reconcile.');

  const panels:FleetCommandPanel[]=(['star4live','avigilon','reconeyez'] as const).map(key=>{
    const group=provider.groups.find(g=>g.provider===key)!;
    return {key,title:key==='star4live'?'Star4Live':key==='avigilon'?'Avigilon':'Recon / Recon II',
      count:group.count,counts:group.counts,products:items.filter(p=>p.system===key),
      lastCheck:provider.healthVerified?cameraCheckedAt:null,
      note:'Equipment-family classification; saved connectivity may include recorder or service-port evidence.'};
  });

  // Victron is an overlapping support-system panel, not an additional physical
  // equipment census. Presence, battery percentage, and camera state are distinct.
  let config:ReturnType<typeof readVrmFleetConfig>|null=null;
  try{if(vrm)config=readVrmFleetConfig(vrm);}catch{/* unavailable provider cannot prove outages */}
  const helios=items.filter(p=>canonicalCameraUnit(p.unitNumber)?.startsWith('HELIOS|'));
  const vrmCounts:ProviderCounts={online:0,offline:0,unverified:0,not_applicable:0};
  const seenInstallations=new Set<number>();
  const victron=helios.map(p=>{
    const unitRows=p.linked?.unitId?rows.filter(r=>r.id===p.linked?.unitId):[];
    const row=unitRows.length===1?unitRows[0]:null;
    const power=row?.power;
    const available=config?.items.filter(i=>i.installationId===power?.installationId&&i.name===power?.name)||[];
    const recent=power?.measurements.some(m=>cameraTimestamp(m.observedAt,now).fresh)===true;
    const unique=Boolean(power&&available.length===1&&!seenInstallations.has(power.installationId));
    if(unique&&power)seenInstallations.add(power.installationId);
    const status:FleetCommandStatus=unique&&recent&&!power?.errorCode&&config?.sync.state==='current'?'online':'unverified';
    vrmCounts[status]++;
    return {...p,status,reason:status==='online'?'Fresh, uniquely linked Victron telemetry. A low battery is an alert, not an offline camera.':
      'No current uniquely linked Victron telemetry. Offline is not inferred.'};
  });
  panels.push({
    key:'victron',title:'Victron / Helios',
    count:config?victron.length:null,
    counts:config?vrmCounts:null,
    products:victron,
    lastCheck:config?.sync.lastSuccessAt||null,
    note:config?'Fresh Victron telemetry only; battery warnings are not camera outages. Helios remains counted once in inventory.':
      'Victron source is unavailable or not authorized; no online/offline estimate is shown.'
  });
  return {total:authority.total,field:authority.field,shop:authority.shop,
    sourceAt:authority.receivedAt,sourceStale:authority.stale,
    healthVerified:provider.healthVerified,items,counts,panels,
    addressCoverage:validAddresses?{located:validAddresses.pins.length,missing:validAddresses.unlocated}:null};
}
