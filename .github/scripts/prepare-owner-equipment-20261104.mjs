import fs from 'node:fs';
const root='tech-checks/operations/src/';
function patch(path,changes){let s=fs.readFileSync(path,'utf8');for(const [a,b] of changes){if(s.includes(b))continue;if(s.split(a).length!==2)throw Error('Expected unique patch anchor in '+path+': '+a.slice(0,90));s=s.replace(a,b);}fs.writeFileSync(path,s);}
patch(root+'api.ts',[
 ["const endpoint = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';", "const endpoint = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';\nconst ownerEndpoint=endpoint.replace(/cos-operations-pages$/,'cos-owner-equipment');\nconst ownerRoute=(path:string)=>path.startsWith('/api/owner-equipment/')||['/api/field-map','/api/fleet-map-source','/api/product-connections','/api/product-connections/verify'].includes(path);"],
 ["response = await fetch(endpoint, {","response = await fetch(ownerRoute(path)?ownerEndpoint:endpoint, {"],
 ["get: <T = any>(path: string) => request<T>('GET', path)","get: <T = any>(path: string, options?: {signal?:AbortSignal}) => request<T>('GET', path, undefined, options)"],
 ["if (!sharedReadPaths.has(path)) return sendRequest<T>(method, path, session.token, body);","if (!sharedReadPaths.has(path)) return sendRequest<T>(method, path, session.token, body, options?.signal);"],
 ["const timeoutMs = method==='POST'&&path==='/api/product-connections/verify' ? 100000", "const timeoutMs = method==='POST'&&path.startsWith('/api/owner-equipment/')&&path.endsWith('/check') ? 90000 : method==='POST'&&path==='/api/product-connections/verify' ? 100000"]
]);
patch(root+'mhelpFieldHealth.ts',[
 ["import {readMhelpInventoryAuthority}","import {checkedControl,ownerConnection} from './ownerEquipmentCore';\nimport {readMhelpInventoryAuthority}"],
 ["  // Connection does not depend",`  const owner=checkedControl(product.ownerControl,product.productId);
  if(owner?.active&&!owner.projectionHold&&product.uploadLifecycle==='UNFLAGGED'&&record?.active&&record.lifecycle==='active'&&related.length===1&&record.productIds.length===1){
   const observation=ownerConnection(owner,now)!;
   const state:FieldProductHealth=support?'support':observation.status==='online'?'online':observation.status==='offline'?'offline':'unverified';
   counts[state]++;
   return {productId:product.productId,unitNumber:label,state,reason:support?'Support equipment; no camera check applies.':observation.reason,unitId:record.kind==='unit'?record.unitId:null,recordId:record.kind!=='unit'?record.id:null,evidence:{gap:support?'not_applicable':state==='unverified'?'no_current_reading':null,association:'owner_product_endpoint',basis:'connection',observedAt:observation.checkedAt,video:'not_verified',observations:state==='online'||state==='offline'?[{resourceId:'owner:'+product.productId,source:'Owner-configured COS cloud TCP check',kind:'connection',observedAt:observation.checkedAt,fresh:true,reportedStatus:state,currentState:state}]:[]}};
  }
  // Connection does not depend`]
]);
patch(root+'productConnectionFleetRows.ts',[
 ["!['exact_product_id_tracker_endpoint','product_id_connection_unavailable'].includes(evidence?.association||'')","!['exact_product_id_tracker_endpoint','product_id_connection_unavailable','owner_product_endpoint'].includes(evidence?.association||'')"],
 ["const known=evidence.association==='exact_product_id_tracker_endpoint'", "const known=['exact_product_id_tracker_endpoint','owner_product_endpoint'].includes(evidence.association||'')"],
 ["&&['exact_product_id_tracker_endpoint','product_id_connection_unavailable'].includes(product.evidence?.association||'')","&&['exact_product_id_tracker_endpoint','product_id_connection_unavailable','owner_product_endpoint'].includes(product.evidence?.association||'')"],
 ["&&(product.evidence.association==='exact_product_id_tracker_endpoint'&&", "&&(['exact_product_id_tracker_endpoint','owner_product_endpoint'].includes(product.evidence.association||'')&&"]
]);
patch(root+'mhelpAddressMapPins.ts',[
 ["import {compareAddress", "import {ownerAddressPins} from './ownerEquipmentCore';\nimport {compareAddress"],
 ["export type MhelpAddressMapPin={", "export type MhelpAddressMapPin={ownerManaged?:boolean;"],
 [" us_census_address_range:'US Census address range',", " owner_manual:'Owner map location · not live GPS',\n us_census_address_range:'US Census address range',"],
 ["export function readMhelpAddressMapPins(raw:unknown,head:unknown,now=Date.now()):MhelpAddressMapResult|null{", "export function readMhelpAddressMapPins(raw:unknown,head:unknown,now=Date.now()):MhelpAddressMapResult|null{\n const h=head as any;return ownerAddressPins(readSourceMhelpAddressMapPins(raw,h?.ownerAddressSourceInventory||head,now),head);\n}\nfunction readSourceMhelpAddressMapPins(raw:unknown,head:unknown,now=Date.now()):MhelpAddressMapResult|null{"]
]);
{
 const p=root+'mhelpAddressMapPins.ts';let s=fs.readFileSync(p,'utf8');s=s.replace(/export type MhelpAddressMapReview=\{\n  id:/,'export type MhelpAddressMapReview={\n  ownerManaged?:boolean;id:');fs.writeFileSync(p,s);
}
patch(root+'fleetRecordedRoster.ts',[
 ["import {recordedAddressText}","import {ownerConnection} from './ownerEquipmentCore';\nimport {recordedAddressText}"],
 ["export type RecordedEquipment={id:string;", "export type RecordedEquipment={ownerControl?:any;id:string;"],
 ["export function filterSourceEquipment(items:RecordedEquipment[],filters:FleetFilters,view='map'){", "export function filterSourceEquipment(items:RecordedEquipment[],filters:FleetFilters,view='map',now=Date.now()){\n const status=(r:RecordedEquipment)=>r.ownerControl?.active?(ownerConnection(r.ownerControl,now)?.status||'unknown'):'unknown';"],
 ["&&['all','unknown'].includes(filters.status)&&!filters.nearbyId", "&&(filters.status==='all'||filters.status===status(r)||filters.status==='operational'&&['online','offline'].includes(status(r)))&&!filters.nearbyId"]
]);
patch(root+'fleetLocationPins.ts',[["ids.get(record.id)===1&&record.kind==='source_equipment'&&record.active", "ids.get(record.id)===1&&record.kind==='source_equipment'&&!record.ownerControl?.active&&record.active"]]);
patch(root+'FleetSourceEquipment.tsx',[
 ["?'MHelp address':'Recorded source address'", "?'MHelp address':record.ownerControl?.active?'Owner address':'Recorded source address'"],
 ["{record.kind==='identity_review'?'Identity review':'Health unlinked'}", "{record.ownerControl?.active?'Owner-managed target':record.kind==='identity_review'?'Identity review':'Health unlinked'}"],
 ["<p>{estimate?'An estimated address", "<p>{record.ownerControl?.active?'Owner placement and connection settings are saved. This does not create a provider-camera association.':estimate?'An estimated address"]
]);
patch(root+'FleetDashboard.tsx',[
 ["import FleetSourceEquipment", "import OwnerEquipmentEditor from './OwnerEquipmentEditor';\nimport {projectOwnerMap} from './ownerEquipmentCore';\nimport FleetSourceEquipment"],
 ["<FleetSourceEquipment record={selectedSource} now={snapshotNow} estimate={selectedSourcePin?.estimate}/>", "<FleetSourceEquipment record={selectedSource} now={snapshotNow} estimate={selectedSourcePin?.estimate}/>\n    {canManageOwner&&selectedSource.productIds.length===1&&<OwnerEquipmentEditor key={'owner:'+selectedSource.productIds[0]} productId={selectedSource.productIds[0]} onSaved={refresh} onBusyChange={setEditorBusy}/>}"],
 ["<section className='cos-fleet-recorded-address' aria-label='Unit recorded address'>", "{canManageOwner&&selectedRecord?.productIds.length===1&&<OwnerEquipmentEditor key={'owner:'+selectedRecord.productIds[0]} productId={selectedRecord.productIds[0]} onSaved={refresh} onBusyChange={setEditorBusy}/>}\n    <section className='cos-fleet-recorded-address' aria-label='Unit recorded address'>"],
 ["<div className='cos-fleet-eyebrow'>MHELP CUSTOMER ADDRESS</div><h2>{selectedMhelpAddress.unitNumber}</h2>", "<div className='cos-fleet-eyebrow'>{selectedMhelpAddress.ownerManaged?'OWNER MAP LOCATION':'MHELP CUSTOMER ADDRESS'}</div><h2>{selectedMhelpAddress.unitNumber}</h2>\n    {canManageOwner&&<OwnerEquipmentEditor key={'owner:'+selectedMhelpAddress.productId} productId={selectedMhelpAddress.productId} onSaved={refresh} onBusyChange={setEditorBusy}/>}"],
 ["FIELD · current mHelpDesk source", "FIELD · {selectedMhelpAddress.ownerManaged?'Owner override in COS':'current mHelpDesk source'}"],
 ["<dt>Original mHelpDesk address</dt>", "<dt>{selectedMhelpAddress.ownerManaged?'Owner service address':'Original mHelpDesk address'}</dt>"],
 ["const currentMap=connectionMapRef.current;const next=await fleetConnectionReadback", "const currentMap=(connections as any)?.ownerOverrides?projectOwnerMap(connectionMapRef.current,(connections as any).ownerOverrides):connectionMapRef.current;if(currentMap!==connectionMapRef.current)setMapSnapshot(currentMap);const next=await fleetConnectionReadback"],
 ["<footer>CAMERAS ONSITE / PRIVATE OPERATIONS", "{Boolean((map as any)?.ownerOverrides?.length)&&<p className='cos-fleet-message' role='status'>{(map as any).ownerOverrides.length} Owner override(s) active in COS. Effective placements, addresses and connection targets are labeled separately; mHelp and the 2027 tracker are unchanged.</p>}<footer>CAMERAS ONSITE / PRIVATE OPERATIONS"]
]);
{
 const p=root+'FleetDashboard.tsx';let s=fs.readFileSync(p,'utf8');s=s.replaceAll('onSelect={sourcePins.has(record.id)?()=>openSource(record.id):undefined}','onSelect={()=>openSource(record.id)}');
 s=s.replace("aria-label='Close equipment details' onClick={close}","aria-label='Close equipment details' disabled={editorBusy} onClick={close}");
 s=s.replace("<div className='cos-fleet-eyebrow'>UNLINKED EQUIPMENT</div>","<div className='cos-fleet-eyebrow'>{selectedSource.ownerControl?.active?'OWNER-MANAGED EQUIPMENT':'UNLINKED EQUIPMENT'}</div>");fs.writeFileSync(p,s);
 const q=root+'FleetSourceEquipment.tsx';let t=fs.readFileSync(q,'utf8');t=t.replace('  <details><summary>Equipment record details',"  {!estimate&&onSelect&&<button type='button' onClick={onSelect}>Equipment details →</button>}\n  <details><summary>Equipment record details");fs.writeFileSync(q,t);
 const r=root+'FleetDashboardMap.tsx';let v=fs.readFileSync(r,'utf8');v=v.replace("' · MHelp address: '+address.address","' · '+(address.ownerManaged?'Owner address: ':'MHelp address: ')+address.address").replace("locationLabel:'MHelp customer address · not GPS'","locationLabel:address.ownerManaged?'Owner map location · not live GPS':'MHelp customer address · not GPS'");fs.writeFileSync(r,v);
}
{
 const p='tech-checks/operations/tests/fleet-dashboard-fixtures.mjs';let s=fs.readFileSync(p,'utf8');s=s.replace("if(!url.endsWith('/functions/v1/cos-operations-pages'))", "if(!/\\/functions\\/v1\\/cos-(?:operations-pages|owner-equipment)$/.test(url))");fs.writeFileSync(p,s);
}
console.log('Owner editor patch prepared without modifying production records.');
