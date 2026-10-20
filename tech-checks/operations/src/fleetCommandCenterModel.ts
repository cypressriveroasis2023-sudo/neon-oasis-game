import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {mhelpProviderFleet,type ProviderProduct,type ProviderCounts,type FieldProvider} from './mhelpProviderFleet';
import {recordedAddressText} from './fleetDisplayAddress';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {readVrmFleetConfig} from '../../supabase/functions/cos-operations-pages/vrm';
import {verifiedFleetPower} from './fleetPowerVerification';
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

export type VerificationBlockers={identity:number;provider:number;inactive:number};
/** Explain why a Product ID is still unverified without treating missing
 * identity or stale provider data as an outage. This does not grant identity. */
export function fleetVerificationBlockers(products:ReadonlyArray<Pick<FleetCommandProduct,'status'|'linked'|'lifecycle'>>):VerificationBlockers {
 const blockers={identity:0,provider:0,inactive:0};
 for(const product of products){
  if(product.status!=='unverified')continue;
  if(product.lifecycle!=='UNFLAGGED'||product.linked?.state==='inactive')blockers.inactive++;
  else if(!product.linked?.unitId||['review','unlinked'].includes(product.linked.state))blockers.identity++;
  else blockers.provider++;
 }
 return blockers;
}

/** Reporting only: source Product IDs are never linked to devices by names, IPs, or site text. */
export function buildFleetCommandCenter(
  upload:unknown,fieldHealth:{total:number;items:FieldProduct[]}|null,
  healthReadSucceeded:boolean,rows:FleetDashboardRow[],
  addressMap:MhelpAddressMapResult|null,vrm:unknown,now=Date.now(),
  cameraCheckedAt:string|null=null,inventoryReadSucceeded=healthReadSucceeded
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
      lifecycle:typeof source.uploadLifecycle==='string'?source.uploadLifecycle:'UNFLAGGED'};
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
  // Inventory identity and power evidence have independent read boundaries.
  // A camera-provider failure must not erase a fresh, exact Product-ID power link.
  const powerProducts=mhelpProviderFleet(upload,fieldHealth,inventoryReadSucceeded,now);
  const inventoryLinks=new Map((powerProducts?.healthVerified?powerProducts.groups.flatMap(g=>g.items):[])
    .map(p=>[p.productId,p.linked]));
  const victron=helios.map(p=>{
    const linked=inventoryLinks.get(p.productId)||null;
    const evidence=verifiedFleetPower(recordById.get(p.productId),linked,rows,config,now);
    const status:FleetCommandStatus=evidence.online?'online':'unverified';
    vrmCounts[status]++;
    return {...p,linked,status,reason:evidence.reason};
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
