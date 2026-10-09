import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto,randomUUID} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {fixture as nativeFixture,reset as nativeReset,seed as nativeSeed,install as installSource,rpc as nativeRPC,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
import {fixture as legacyFixture,reset as legacyReset,seed as legacySeed,OWNER} from './fixtures/geocodio-database-fixture.mjs';
import {createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {createSourceReader,checkedImportedSource,sourceIdentity,sourceAddress} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {validInstallation,matchesInstallation,censusInstallation} from '../../supabase/functions/camera-field-geocode/importedAddress.ts';
import {selectGeocodioInstallation} from '../../supabase/functions/camera-field-geocode/geocodioAddress.ts';
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding,importedLegacyConcern} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
import {fixture as ownerIdentityFixture,key as ownerIdentityKey} from './owner-identity-fixtures.mjs';
import {audit as ownerPlacementAudit} from './native-placement-alias-fixtures.mjs';
import {ownerIdentityDigest,OWNER_IDENTITY_CONTRACT} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
let native,legacy;before(async()=>{native=await nativeFixture();legacy=await legacyFixture({imported:true});});after(async()=>{await native?.close();await legacy?.close();});
beforeEach(async()=>{await legacyReset(legacy);await nativeReset(native);});
const KEY='a'.repeat(64),response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function serial(fn){let previous=Promise.resolve();return (...args)=>{const task=previous.then(()=>fn(...args));previous=task.catch(()=>{});return task;};}
function harness({censusMatch=false,providerZip5=false,geocodioEmpty=false,onCensus,onGeocodio,now=Date.now}={}){
 const counts={census:0,geocodio:0,bridge:0,addresses:[]};
 const rpc=serial(async(name,args)=>{
  await legacy.exec('reset role;set role service_role');
  try{return (await legacy.query(`select public.${name}(${Object.keys(args).map((key,i)=>key+'=>$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}finally{await legacy.exec('reset role');}
 });
 const bridge=createGeocodeSourcesHandler({readKey:' '+KEY+'\n',rpc:serial(async(name,args)=>nativeRPC(native,name.replace('cos_geocode_sources_',''),args))});
 const fetch=async(url,init)=>{
  const u=new URL(url);
  if(u.hostname==='tughscoxralhofrckvxy.supabase.co'){counts.bridge++;assert.equal(init.headers['x-cos-geocode-source-key'],KEY);assert.equal(init.headers.Authorization,undefined);return bridge(new Request(url,init));}
  const street=u.searchParams.get('street'),city=u.searchParams.get('city')||'Houston',state=u.searchParams.get('state')||u.searchParams.get('state_province'),sourceZip=u.searchParams.get('zip')||u.searchParams.get('postal_code')||'77002',zip=providerZip5?sourceZip.slice(0,5):sourceZip;
  counts.addresses.push([...u.searchParams.keys()]);
  if(u.hostname==='geocoding.geo.census.gov'){counts.census++;await onCensus?.();return response({result:{addressMatches:censusMatch?[{matchedAddress:`${street}, ${city}, ${state} ${zip}`,coordinates:{x:-95,y:29}}]:[]}});}
  assert.equal(u.origin,'https://api.geocod.io');counts.geocodio++;await onGeocodio?.();if(geocodioEmpty)return response({results:[]});
  const [number,...words]=street.split(' ');return response({results:[{address_components:{number,formatted_street:words.join(' '),city,state_province:state,postal_code:zip,country:'US'},formatted_address:`${street}, ${city}, ${state} ${zip}`,location:{lat:29,lng:-95},accuracy:1,accuracy_type:'range_interpolation',match_type:null,source:'Never passed onward'}]});
 };
 return {rpc,fetch,counts,reader:createSourceReader(' '+KEY+'\n',fetch),run:()=>processImportedGeocodes({rpc,fetch,sourceReadKey:' '+KEY+'\n',geocodioApiKey:'fixture-only',deadlineMs:now()+100000,now})};
}
async function prepare({kind='equipment_unit',label='HELIOS 099HDC4',product='12345',placement='FIELD',partial=null,siteLabel}={}){
 const record=await nativeSeed(native,{kind,label,product,placement});if(siteLabel!==undefined)record.siteLabel=siteLabel;
 if(partial){record.installation[partial]=null;record.suppliedComponents={street:true,city:record.installation.city!==null,state:true,zip:record.installation.zip!==null};record.addressSha256=hash([record.installation.street,record.installation.city,[record.installation.state,record.installation.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ').toLowerCase());}
 const [source]=await installSource(native,[record]);return {record,source};
}
const rawRow=source=>({id:source.nativeUnitId,unitNumber:source.unitNumber,readOnly:source.entityKind==='tracker',_sourceField:false,modelName:source.family,status:'available',currentLocationType:null,hasUnitGps:false,latitude:null,longitude:null,customer:'Historical customer',site:'Recorded site',address:'1 Historical Ave, Houston, TX 77002',addressSource:'Old tracker',recordSource:'Old tracker'});
async function projected(h,sources,audits=[],devices=[]){
 const rows=sources.map(rawRow),snapshot={items:[],inventoryItems:rows,summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:new Date().toISOString()};
 const sourceRows=await nativeRPC(native,'map_projection',{p_organization_id:ORG,p_identities:sources.map(s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}))});
 const overlay=await projectImportedSourceAddresses(snapshot,sourceRows,audits,devices);
 const placed=await projectOwnerPlacement(overlay,audits,devices);
 const bindings=(await Promise.all(placed.items.map(row=>checkedImportedBinding(row.importedInstallation)))).filter(Boolean);
 const records=await h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:bindings});
 return projectImportedGeocodes(placed,records,audits,devices);
}
test('actual native bridge to client to both SQL databases to effective DTO and honest pin',async()=>{
 const {source}=await prepare();const h=harness();const result=await h.run();assert.equal(result.geocodioSucceeded,1);assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,1);
 const map=await projected(h,[source]);assert.equal(map.items.length,1);assert.equal(map.items[0].address,'123 Main St, Houston, TX 77002-1234');assert.notEqual(map.items[0].address,rawRow(source).address);
 assert.equal(map.items[0].placementSource,null);assert.equal(map.items[0].placementAuditId,null);assert.equal(map.items[0].latitude,null);assert.equal(map.items[0].hasUnitGps,false);
 const estimate=await checkedAddressEstimate(map.items[0]);assert.equal(estimate.provider,'geocodio');assert.equal(estimate.accuracyType,'range_interpolation');assert.equal(estimate.latitude,29);
 assert.equal(Number((await legacy.query('select count(*) n from public.camera_inventory_audit')).rows[0].n),0);
 assert.equal(Number((await legacy.query('select sum(credits) n from app_private.cos_geocodio_daily_budget')).rows[0].n),1);
 const due=await h.rpc('cos_imported_geocode_list_due',{p_organization_id:ORG});assert.deepEqual(due,[]);await h.run();assert.equal(h.counts.geocodio,1);
});
test('same address shares one Census/Geocodio attempt across registered and tracker-only units',async()=>{
 const a=await prepare(),b=await prepare({kind:'tracker',label:'SOLAR STAND 72 001',product:'22222'});const h=harness();await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,1);
 const map=await projected(h,[a.source,b.source]);assert.equal(map.items.length,2);for(const row of map.items)assert.ok(await checkedAddressEstimate(row));
 assert.equal(map.items[1].readOnly,true);assert.equal(map.items[1].modelName,b.source.family);assert.equal(map.items[1].unitNumber,b.source.unitNumber);
});
test('tombstone-only and mixed pages advance cursor without poisoning current reads',async()=>{
 const a=await prepare({placement:'SHOP'}),b=await prepare({label:'HELIOS 100HDC4',product:'67890'});const h=harness();const result=await h.run();assert.equal(result.syncedSources,2);assert.equal(h.counts.geocodio,1);
 assert.deepEqual(await h.reader.currentMany([sourceIdentity(a.source)]),[null]);
 assert.equal((await h.rpc('cos_imported_geocode_cursor_read',{p_organization_id:ORG})).eventId,'0');
 const map=await projected(h,[{...a.source,unitNumber:a.record.unitNumber,family:'HELIOS'},b.source]);assert.deepEqual(map.items.map(row=>row.id),[b.source.nativeUnitId]);assert.equal(map.inventoryItems.find(row=>row.id===a.source.nativeUnitId).currentLocationType,'shop');
});
test('INACTIVE source tombstone retires only its queue binding and keeps budget/cache/history intact',async()=>{
 await native.exec(readFileSync(new URL('../db/cos-geocode-sources-admin-import.sql',import.meta.url),'utf8'));
 await native.exec(readFileSync(new URL('../db/cos-inactive-source-placement.sql',import.meta.url),'utf8'));
 const {record,source}=await prepare({kind:'tracker',label:'Spotter 905HD'}),h=harness();
 await h.run();assert.equal(h.counts.geocodio,1);
 const budgetBefore=(await legacy.query('select jsonb_agg(to_jsonb(b)) v from app_private.cos_geocodio_daily_budget b')).rows[0].v;
 const inactive={...record,placement:'INACTIVE',previousSourceRevision:source.sourceRevision,installation:null,addressSha256:null,sourceStatus:'DO NOT USE',sourceFullLabel:record.unitNumber+' - DO NOT USE',sourceObservedAt:'2026-10-01T00:00:00Z'};
 const [gone]=(await native.query('select app_private.cos_geocode_sources_admin_inactive_reviewed($1,$2) v',[ORG,[inactive]])).rows[0].v;
 assert.equal(gone.eligibility,'tombstone');await h.run();assert.equal(h.counts.geocodio,1);assert.equal(h.counts.census,1);
 assert.deepEqual((await legacy.query('select jsonb_agg(to_jsonb(b)) v from app_private.cos_geocodio_daily_budget b')).rows[0].v,budgetBefore);
 assert.deepEqual(await h.rpc('cos_imported_geocode_list_due',{p_organization_id:ORG}),[]);
 assert.deepEqual(await h.reader.currentMany([sourceIdentity(gone)]),[null]);
 const map=await projected(h,[{...gone,unitNumber:record.unitNumber,family:'SPOTTER'}]);
 assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].importedPlacement,'INACTIVE');assert.equal(map.inventoryItems[0].currentLocationType,'inactive');
 assert.equal(Number((await legacy.query('select count(*) n from public.camera_inventory_audit')).rows[0].n),0);
});
for(const partial of ['city','zip'])test('partial '+partial+' stays null at source and provider fills only omitted locality',async()=>{
 const {source}=await prepare({partial});const h=harness();await h.run();const current=(await h.reader.currentMany([sourceIdentity(source)]))[0];assert.equal(current.installation[partial],null);
 const map=await projected(h,[source]);const estimate=await checkedAddressEstimate(map.items[0]);assert.ok(estimate);assert.deepEqual(estimate.inferredComponents,[partial==='zip'?'ZIP':'city']);
 for(const keys of h.counts.addresses)assert.equal(keys.includes(partial==='zip'?'postal_code':'city'),false);
});
test('suppliedComponents JSONB order and160-character family/variant survive the contract',async()=>{
 const {source}=await prepare();source.family='F'.repeat(160);source.variant='V'.repeat(160);source.suppliedComponents={zip:true,state:true,city:true,street:true};assert.ok(await checkedImportedSource(source));assert.ok(await checkedImportedBinding(source));
});
test('source change during provider request cannot publish or refund',async()=>{
 const {source}=await prepare();const h=harness({onGeocodio:()=>native.query('update public.equipment_units set gps_latitude=31,gps_longitude=-96 where id=$1',[source.nativeUnitId])});await h.run();
 assert.equal(Number((await legacy.query('select sum(credits) n from app_private.cos_geocodio_daily_budget')).rows[0].n),1);
 assert.equal((await h.reader.currentMany([sourceIdentity(source)]))[0],null);
 const map=await projected(h,[source]);assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].address,rawRow(source).address);
});
test('existing Owner placement suppresses same-base imported source, never assigns its audit by suffix',async()=>{
 const {source}=await prepare({label:'SPOTTER 246HDC2'});await legacySeed(legacy,{id:1,unit:'SPOTTER 246',address:'1 owner road, houston, tx 77002'});const h=harness();await h.run();assert.equal(h.counts.census,0);assert.equal(h.counts.geocodio,0);
 const audits=[{id:'1',unit_key:'SPOTTER 246',action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2',device_ids:['1']}],devices=[{id:'1',unit_key:'SPOTTER 246'}];assert.equal(importedLegacyConcern(source.unitNumber,audits,devices),true);
 const rows=[rawRow(source)];const overlay=await projectImportedSourceAddresses({items:[],inventoryItems:rows,summary:{}},[{...source,placement:'FIELD'}],audits,devices);assert.deepEqual(overlay.inventoryItems,rows);
});
test('confirmed GPS and native authoritative site never receive imported source overlay',async()=>{
 const {source}=await prepare();for(const patch of [{hasUnitGps:true},{locationVerification:'owner_verified',latitude:31,longitude:-96},{installedSiteId:randomUUID()}]){
  const row={...rawRow(source),...patch};const map=await projectImportedSourceAddresses({items:[],inventoryItems:[row],summary:{}},[{...source,placement:'FIELD'}],[],[]);assert.deepEqual(map.inventoryItems[0],row);
 }
});
test('effective imported address prefills current field editor and revision detects source change',async()=>{
 const {source}=await prepare({label:'HELIOS 99HDC4'});const h=harness({censusMatch:true});await h.run();const map=await projected(h,[source]);
 const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),context);
 const health={evidenceVersion:2,identityVersion:1,rows:[{id:'1',unit:source.unitNumber}],unitIdentities:[],identityWarnings:[]};const state={unitKey:source.unitNumber,placement:'SHOP',auditId:null,siteLabel:'',streetAddress:'',canMove:true};
 const current=context.CameraPlacementControls.resolvePlacement(map,health,state,source.unitNumber);assert.equal(current.address,sourceAddress(source));assert.equal(current.field,true);
 const changed=structuredClone(map);for(const row of [...changed.items,...changed.inventoryItems])row.importedInstallation.sourceRevision=randomUUID();
 const next=context.CameraPlacementControls.resolvePlacement(changed,health,state,source.unitNumber);assert.notEqual(next.revision,current.revision);
});
test('missing or malformed bridge config fails closed before any RPC/network',async()=>{
 for(const key of [undefined,'bad','a'.repeat(63)+' ']){let calls=0;const result=await processImportedGeocodes({sourceReadKey:key,geocodioApiKey:'fixture',deadlineMs:Date.now()+100000,rpc:async()=>{calls++;throw Error()},fetch:async()=>{calls++;throw Error()}});assert.equal(result.configured,false);assert.equal(calls,0);}
});
test('near deadline starts no imported claim or reservation',async()=>{
 let calls=0;const result=await processImportedGeocodes({sourceReadKey:KEY,deadlineMs:Date.now()+1000,rpc:async()=>{calls++;throw Error()},fetch:async()=>{calls++;throw Error()}});assert.equal(calls,0);assert.equal(result.consideredAddresses,0);
});
test('partial matching never relaxes a supplied house/street/state/locality or secondary-unit rejection',()=>{
 const p={street:'123 Main St',city:null,state:'TX',zip:'77002'};assert.equal(validInstallation(p),true);assert.equal(matchesInstallation(p,'123 Main St, Houston, TX 77002'),true);
 for(const address of ['124 Main St, Houston, TX 77002','123 Wrong St, Houston, TX 77002','123 Main St, Houston, LA 77002','123 Main St, Houston, TX 77003'])assert.equal(matchesInstallation(p,address),false);
 assert.equal(validInstallation({...p,zip:null}),false);assert.equal(validInstallation({...p,street:'123 Main St Unit 5'}),false);
});
test('approved FIELD and SHOP transitions replace historical classification without fake Owner fields',async()=>{
 const {source}=await prepare();
 const historical={...rawRow(source),_sourceField:false,status:'readiness_unverified',placement:'SHOP',currentLocationType:'shop'};
 const field=await projectImportedSourceAddresses({items:[],inventoryItems:[historical],summary:{}},[{...source,placement:'FIELD'}],[],[]);
 assert.equal(field.items.length,1);assert.equal(field.items[0].placement,null);assert.equal(field.items[0].currentLocationType,'field');assert.equal(field.items[0].importedPlacement,'FIELD');
 const shop=await projectImportedSourceAddresses(field,[{...source,placement:'SHOP'}],[],[]);
 assert.equal(shop.items.length,0);assert.equal(shop.inventoryItems[0].placement,null);assert.equal(shop.inventoryItems[0].status,'readiness_unverified');assert.equal(shop.inventoryItems[0].currentLocationType,'shop');
});
test('fresh source after cross-project read governs address/SHOP and never revives historical pins',async()=>{
 const {source,record}=await prepare();const h=harness();await h.run();const oldMap=await projected(h,[source]);assert.ok(await checkedAddressEstimate(oldMap.items[0]));
 const changed={...record,previousSourceRevision:source.sourceRevision,installation:{...record.installation,street:'124 Main St'},addressSha256:hash('124 main st, houston, tx 77002-1234')};const [fresh]=await installSource(native,[changed]);
 const historical={...rawRow(source),_sourceField:true,placement:'FIELD',historicalLatitude:29,historicalLongitude:-95,historicalCoordinateSource:'us_census_address_range_estimate'};
 const snapshot={items:[historical],inventoryItems:[historical],summary:{}};
 const overlaid=await projectImportedSourceAddresses(snapshot,[{...fresh,placement:'FIELD'}],[],[],[{...source,placement:'FIELD'}]);assert.equal(overlaid.items[0].address,'124 Main St, Houston, TX 77002-1234');
 const staleRecord=oldMap.items[0].locationImportedGeocode;const freshMap=await projectImportedGeocodes(overlaid,[staleRecord],[],[]);assert.equal(await checkedAddressEstimate(freshMap.items[0]),null);
 const shop=await projectImportedSourceAddresses(snapshot,[{...fresh,placement:'SHOP'}],[],[],[{...source,placement:'FIELD'}]);assert.equal(shop.items.length,0);
 const removed=await projectImportedSourceAddresses(snapshot,[],[],[],[{...source,placement:'FIELD'}]);assert.equal(removed.items.length,0);assert.equal(removed.inventoryItems[0].importedSourceState,'source_changed');
});
test('Census-only imported success becomes an EST point with exact benchmark and no paid request',async()=>{
 const {source}=await prepare();const h=harness({censusMatch:true});await h.run();assert.equal(h.counts.geocodio,0);
 const map=await projected(h,[source]);const point=await checkedAddressEstimate(map.items[0]);assert.ok(point);assert.equal(point.source,'us_census_address_range_estimate');
});
test('credential stems are rejected before either external provider request',async()=>{
 const {geocodioInstallation}=await import('../../supabase/functions/camera-field-geocode/geocodioAddress.ts');
 for(const suffix of ['Mypassword123','Mytoken','password123','tokenABC','secret123','passwd123','credentialABC','loginABC','usernameABC','gatecode123']){
  const installation={street:'123 Main St '+suffix,city:'Houston',state:'TX',zip:'77002'};assert.equal(validInstallation(installation),false);let calls=0;
  const fetch=async()=>{calls++;throw Error('must not send')};assert.equal((await censusInstallation(installation,fetch)).status,'invalid_address');assert.equal((await geocodioInstallation(installation,'fixture',fetch)).status,'no_match');assert.equal(calls,0);
 }
});
test('native presentation keeps the complete current customer/site path without parsing it or reaching providers',async()=>{
 const record=await nativeSeed(native);record.siteLabel='Current customer: North site: Phase 2';const [source]=await installSource(native,[record]);const h=harness();await h.run();const map=await projected(h,[source]),row=map.items[0];
 assert.equal(row.site,record.siteLabel);assert.equal(row.customer,record.siteLabel);assert.equal(row.address,sourceAddress(source));assert.ok(await checkedAddressEstimate(row));
 assert.ok(!('siteLabel' in source));assert.ok(!('customer' in source));assert.ok(h.counts.addresses.every(keys=>!keys.includes('siteLabel')&&!keys.includes('customer')));
 const sources=await nativeRPC(native,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:source.entityKind,nativeUnitId:source.nativeUnitId}]});
 const before=rawRow(source),snapshot={items:[],inventoryItems:[before],summary:{}},saved=structuredClone(snapshot);
 const overlay=await projectImportedSourceAddresses(snapshot,sources,[],[]);assert.equal(overlay.inventoryItems[0].customer,record.siteLabel);assert.deepEqual(snapshot,saved,'presentation must not mutate raw source records');
});
test('source SHOP hides historical customer/street while retaining inventory and historical evidence',async()=>{
 for(const kind of ['equipment_unit','tracker']){
  const {source}=await prepare({kind,label:kind==='tracker'?'RANGER 002':'RANGER 001',product:kind==='tracker'?'22222':'11111'});
  const row={...rawRow(source),_sourceField:true,currentLocationType:'field',addressUpdatedAt:'2026-01-01T00:00:00Z',historicalLatitude:29,historicalLongitude:-95,historicalCoordinateSource:'prior_location',locationNote:'Recorded history remains',activeJobNumber:'JOB-123'};
  const snapshot={items:[row],inventoryItems:[row],summary:{}},saved=structuredClone(snapshot);
  const map=await projectImportedSourceAddresses(snapshot,[{...source,placement:'SHOP',siteLabel:'CamerasOnsite'}],[],[]),result=map.inventoryItems[0];
  assert.equal(map.items.length,0);assert.equal(map.inventoryItems.length,1);assert.equal(result.site,'SHOP / ROOT');assert.equal(result.customer,'CamerasOnsite');assert.equal(result.address,null);assert.equal(result.addressSource,null);assert.equal(result.addressUpdatedAt,null);
  assert.equal(result.historicalLatitude,row.historicalLatitude);assert.equal(result.historicalLongitude,row.historicalLongitude);assert.equal(result.historicalCoordinateSource,row.historicalCoordinateSource);assert.equal(result.locationNote,row.locationNote);assert.equal(result.activeJobNumber,row.activeJobNumber);assert.equal(result.id,row.id);assert.equal(result.readOnly,row.readOnly);
  assert.equal(result.latitude,null);assert.equal(result.longitude,null);assert.deepEqual(snapshot,saved);
 }
});
test('omitted current labels use bounded presentation and never blank protected Owner or native data',async()=>{
 const {source}=await prepare();
 for(const siteLabel of [undefined,null,'','   ','x'.repeat(251)]){
  const current={...source,placement:'FIELD',siteLabel},row=rawRow(source),snapshot={items:[],inventoryItems:[row],summary:{}};
  const map=await projectImportedSourceAddresses(snapshot,[current],[],[]);assert.equal(map.items[0].site,'Installation site');assert.equal(map.items[0].customer,null);assert.equal(map.items[0].address,sourceAddress(source));
  for(const protection of [{placementSource:'owner',placement:'FIELD'},{hasUnitGps:true,latitude:31,longitude:-96},{locationVerification:'owner_verified'},{installedSiteId:randomUUID()},{placementStatus:'needs_identity_review'},{placement:'UNKNOWN'}]){
   const protectedRow={...row,...protection};
   for(const placement of ['FIELD','SHOP']){
    const result=await projectImportedSourceAddresses({items:[],inventoryItems:[protectedRow],summary:{}},[{...current,placement}],[],[]);assert.deepEqual(result.inventoryItems[0],protectedRow);
   }
  }
 }
});
async function actualFieldRoute(h,source,{afterLegacyRead,identityFixture=null,placementAudits=[],transformMapSource}={}){
 const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';let changed=false,nativeReads=0,sourceReads=0,identityReads=0,epochReads=0;
 const afterRead=async()=>{if(!changed&&afterLegacyRead){changed=true;await afterLegacyRead();}};
 const historical={...rawRow(source),_sourceField:true,status:'field',currentLocationType:'field',historicalLatitude:27,historicalLongitude:-94,historicalCoordinateSource:'us_census_address_range_estimate'};
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'fixture-native-service',fetch:async(url,init={})=>{
  if(url.includes('/auth/v1/user'))return response({id:owner});
  if(url.includes('/rest/v1/profiles?'))return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(url.includes('/rest/v1/user_profiles?'))return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(url.includes('/rest/v1/user_roles?'))return response([{roles:{code:'owner',organization_id:ORG}}]);
  if(url.includes('/rest/v1/camera_devices?'))return response(identityFixture?.sources.devices||[]);
  if(url.includes('/rest/v1/equipment_units?'))return response((await native.query('select id,organization_id,unit_number,status from public.equipment_units order by id')).rows);
  if(url.includes('/rest/v1/vision_vigilant_unit_matches?')||url.includes('/rest/v1/vision_vigilant_devices?'))return response([]);
  const name=url.split('/rest/v1/rpc/')[1];const args=init.body?JSON.parse(init.body):{};
  if(name==='appdeploy_field_map_snapshot'){nativeReads++;return response({items:[historical],inventoryItems:[historical],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:new Date().toISOString()});}
  if(name==='cos_archived_representation_projection')return response([]);
  if(name==='cos_geocode_sources_map_projection'){sourceReads++;const rows=await nativeRPC(native,'map_projection',args);return response(transformMapSource?transformMapSource(rows,sourceReads):rows);}
  if(name==='cos_owner_identity_snapshot'){identityReads++;return response(identityFixture?.sources.ownerCrosswalk||{revision:'a'.repeat(64),nativeEpochs:[],claims:[]});}
  if(name==='cos_camera_identity_epochs_v1'){epochReads++;assert.ok(identityFixture,'Epoch reads require exact confirmed claims');assert.deepEqual(args.p_unit_keys,[ownerIdentityKey]);return response(identityFixture.sources.ownerEpochs);}
  if(name==='cos_fleet_placement_evidence_v1')return response(placementAudits);
  if(name==='cos_imported_geocode_read_many'){const data=await h.rpc(name,args);await afterRead();return response(data);}
  if(['cos_field_geocode_read_many','cos_field_geocode_fallback_read_many'].includes(name)){await afterRead();return response([]);}
  throw Error('Unexpected fixture path: '+new URL(url).pathname);
 }});
 const result=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/field-map',method:'GET',body:null})}));
 assert.equal(result.status,200,await result.clone().text());return {map:await result.json(),nativeReads,sourceReads,identityReads,epochReads};
}
test('actual Field Map endpoint wiring reads fresh native snapshots and returns bound imported point',async()=>{
 const {source}=await prepare();const h=harness();await h.run();const {map,nativeReads,sourceReads}=await actualFieldRoute(h,source);assert.equal(nativeReads,2);assert.equal(sourceReads,2);assert.equal(map.items[0].address,sourceAddress(source));assert.ok(await checkedAddressEstimate(map.items[0]));
});
test('actual Field Map endpoint drops pin and applies fresh SHOP if import changes during legacy read',async()=>{
 const {record,source}=await prepare();const h=harness();await h.run();const {map}=await actualFieldRoute(h,source,{afterLegacyRead:()=>installSource(native,[{...record,previousSourceRevision:source.sourceRevision,placement:'SHOP',installation:null,addressSha256:null}])});assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].currentLocationType,'shop');assert.equal(map.inventoryItems[0].site,'SHOP / ROOT');assert.equal(map.inventoryItems[0].customer,null);assert.equal(map.inventoryItems[0].address,null);
});
test('actual Field Map endpoint uses current label after cross-project read and rejects a stale bound point',async()=>{
 const record=await nativeSeed(native);record.siteLabel='Earlier customer: Earlier site';const [source]=await installSource(native,[record]);const h=harness();await h.run();
 const {map,sourceReads}=await actualFieldRoute(h,source,{afterLegacyRead:()=>installSource(native,[{...record,previousSourceRevision:source.sourceRevision,siteLabel:'Current customer: Current site'}])});
 assert.equal(sourceReads,2);assert.equal(map.items[0].site,'Current customer: Current site');assert.equal(map.items[0].customer,'Current customer: Current site');assert.equal(map.items[0].address,sourceAddress(source));assert.equal(await checkedAddressEstimate(map.items[0]),null);
});
test('actual Field Map endpoint holds vanished source after native GPS changes during legacy read',async()=>{
 const {source}=await prepare();const h=harness();await h.run();const {map}=await actualFieldRoute(h,source,{afterLegacyRead:()=>native.query('update public.equipment_units set gps_latitude=31,gps_longitude=-96 where id=$1',[source.nativeUnitId])});assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].importedSourceState,'source_changed');
});

async function confirmedAliasFor(source){
 const f=await ownerIdentityFixture();f.claim.native_unit_id=source.nativeUnitId;f.claim.native_unit_label=source.unitNumber;
 f.sources.ownerCrosswalk.nativeEpochs=[{unitId:source.nativeUnitId,epoch:'e'.repeat(64)}];return f;
}
test('combined actual route keeps current Owner-confirmed alias above an imported source and cached estimate',async()=>{
 const {source}=await prepare({label:'Spotter987654HDC2',siteLabel:'Imported customer: Imported site'}),h=harness();await h.run();const f=await confirmedAliasFor(source),audit=ownerPlacementAudit({unit_key:ownerIdentityKey});
 const {map,nativeReads,sourceReads,identityReads,epochReads}=await actualFieldRoute(h,source,{identityFixture:f,placementAudits:[audit]});
 assert.equal(nativeReads,2);assert.equal(sourceReads,2);assert.equal(identityReads,4);assert.equal(epochReads,4);assert.equal(map.items.length,1);
 const row=map.items[0];assert.equal(row.id,source.nativeUnitId);assert.equal(row.placementSource,'owner');assert.equal(row.placementUnitKey,ownerIdentityKey);assert.equal(row.placementAuditId,audit.id);assert.equal(row.address,audit.street_address);assert.equal(row.site,audit.site_label);assert.equal(row.customer,null);
 assert.equal(map.nativePlacementAliases.length,1);assert.equal(map.nativePlacementAliases[0].unitId,source.nativeUnitId);assert.equal(map.nativePlacementAliases[0].contract,'COS_NATIVE_PLACEMENT_ALIAS_V1');assert.equal(map.nativePlacementAliases[0].proof,await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT,f.claim.id,f.claim.revision,source.nativeUnitId,source.unitNumber,ownerIdentityKey,f.claim.device_ids,f.claim.resource_epoch,f.claim.physical_digest,'owner_confirmation']));assert.equal(await checkedAddressEstimate(row),null);assert.equal(JSON.stringify(map).includes('synthetic-serial'),false);
});
test('combined actual route revalidates revoked Owner-confirmed identity after legacy lookup and withholds imported pin',async()=>{
 const {source}=await prepare({label:'Spotter987654HDC2',siteLabel:'Imported customer: Imported site'}),h=harness();await h.run();const f=await confirmedAliasFor(source),audit=ownerPlacementAudit({unit_key:ownerIdentityKey});
 const {map,identityReads,epochReads}=await actualFieldRoute(h,source,{identityFixture:f,placementAudits:[audit],afterLegacyRead:()=>{f.claim.status='revoked';f.claim.revision='2';f.sources.ownerCrosswalk.revision='d'.repeat(64);}});
 assert.equal(identityReads,4);assert.equal(epochReads,4);assert.equal(map.items.length,0);assert.deepEqual(map.nativePlacementAliases,[]);assert.equal(map.inventoryItems[0].placementStatus,'needs_identity_review');assert.equal(map.inventoryItems[0].placement,'UNKNOWN');assert.equal(await checkedAddressEstimate(map.inventoryItems[0]),null);
});
test('actual Field Map route admits native-only address and lookup against one generic legacy label',async()=>{
 const {source}=await prepare();const h=harness();await h.run();
 const identityFixture={sources:{devices:[{id:'9101',unit_key:'HELIOS 099',source:'unreviewed',device_type:'IPC'}]}};
 const {map,nativeReads,sourceReads}=await actualFieldRoute(h,source,{identityFixture});
 assert.equal(nativeReads,2);assert.equal(sourceReads,2);assert.equal(map.items[0].address,sourceAddress(source));assert.ok(await checkedAddressEstimate(map.items[0]));assert.equal(map.items[0].placementSource,null);assert.deepEqual(map.nativePlacementAliases,[]);
});
test('actual Field Map route requires the freshly re-read source identity proof before final display',async()=>{
 const {source}=await prepare();const h=harness();await h.run();
 const identityFixture={sources:{devices:[{id:'9101',unit_key:'HELIOS 099',source:'unreviewed',device_type:'IPC'}]}};
 const {map}=await actualFieldRoute(h,source,{identityFixture,transformMapSource:(rows,read)=>read===1?rows:rows.map(({nativeSourceIdentity,...row})=>row)});
 assert.equal(map.items[0].importedInstallation,undefined);assert.equal(map.items[0].locationImportedGeocode,undefined);assert.equal(map.items[0].address,rawRow(source).address);
});
test('actual Field Map route rechecks complete legacy group after lookup and retains a new cross-device audit hold',async()=>{
 const {source}=await prepare();const h=harness();await h.run();
 const identityFixture={sources:{devices:[{id:'9101',unit_key:'HELIOS 099',source:'unreviewed',device_type:'IPC'}]}},placementAudits=[];
 const {map}=await actualFieldRoute(h,source,{identityFixture,placementAudits,afterLegacyRead:async()=>{placementAudits.push({id:'51',unit_key:'UNRELATED SYNTHETIC',action:'UPDATE',device_ids:['9101']});}});
 assert.equal(map.items[0].importedInstallation,undefined);assert.equal(map.items[0].locationImportedGeocode,undefined);assert.equal(map.items[0].address,rawRow(source).address);
});

for(const censusMatch of [true,false])test('ZIP+4 source to ZIP5 provider survives complete Census/Geocodio SQL and map contract '+censusMatch,async()=>{
 const {source}=await prepare(),original=structuredClone(source),h=harness({censusMatch,providerZip5:true});
 const result=await h.run();assert.equal(result[censusMatch?'censusSucceeded':'geocodioSucceeded'],1);
 assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,censusMatch?0:1);
 const current=(await h.reader.currentMany([sourceIdentity(source)]))[0];assert.deepEqual(current,original);
 const map=await projected(h,[source]),unit=map.items[0],estimate=await checkedAddressEstimate(unit);
 assert.ok(estimate);assert.match(estimate.matchedAddress,/77002$/);assert.match(unit.address,/77002-1234$/);
 assert.equal(unit.importedInstallation.addressSha256,source.addressSha256);assert.equal(unit.locationImportedGeocode.binding.sourceRevision,source.sourceRevision);
 assert.equal(unit.hasUnitGps,false);assert.equal(unit.latitude,null);assert.equal(estimate.confidence,censusMatch?'address_range_interpolation':'automatic_address_estimate');
 assert.equal(Number((await legacy.query('select coalesce(sum(credits),0) n from app_private.cos_geocodio_daily_budget')).rows[0].n),censusMatch?0:1);
 const census=(await legacy.query('select status,reason from app_private.cos_imported_census_cache')).rows[0];assert.equal(census.reason,censusMatch?null:'provider_empty');
 await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,censusMatch?0:1);
});

async function historicalPostalNoMatch(sources){
 const initial=harness({geocodioEmpty:true});await initial.run();
 assert.equal(initial.counts.census,1);assert.equal(initial.counts.geocodio,1);
 // Model pre-policy unknown failures without inventing their original cause.
 await legacy.exec("update app_private.cos_imported_census_cache set reason='no_match';update app_private.cos_field_geocode_fallback_cache set reason='no_match'");
 return initial;
}
const enroll=(h,bindings)=>h.rpc('cos_imported_geocode_postal_retry_enroll',{p_organization_id:ORG,p_bindings:bindings});
const totalCredits=async()=>Number((await legacy.query('select coalesce(sum(credits),0) n from app_private.cos_geocodio_daily_budget')).rows[0].n);
for(const censusMatch of [true,false])test('bounded enrolled recovery runs Census first, dedupes shared hash and retains source/charged credits '+censusMatch,async()=>{
 const a=await prepare(),b=await prepare({kind:'tracker',label:'SOLAR STAND 72 001',product:'22222'}),sources=[a.source,b.source];
 await historicalPostalNoMatch(sources);const h=harness({censusMatch,providerZip5:true});
 const before=(await h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:sources}));assert.ok(before.every(r=>r.status==='no_match'&&r.reason==='no_match'));
 assert.equal((await enroll(h,[a.source])).enrolled,1);assert.equal(await totalCredits(),1);
 const waiting=await h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:sources});assert.deepEqual(waiting,before);
 assert.equal((await enroll(h,[a.source])).enrolled,0);
 const result=await h.run();assert.equal(result.postalRetry.consideredAddresses,1);assert.equal(result.postalRetry[censusMatch?'censusSucceeded':'geocodioSucceeded'],1);assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,censusMatch?0:1);assert.equal(await totalCredits(),censusMatch?1:2);
 const map=await projected(h,sources);assert.equal(map.items.length,2);
 for(const row of map.items){assert.ok(await checkedAddressEstimate(row));assert.match(row.address,/77002-1234$/);assert.equal(row.importedInstallation.addressSha256,a.source.addressSha256);assert.equal(row.hasUnitGps,false);}
 for(const source of sources)assert.deepEqual((await h.reader.currentMany([sourceIdentity(source)]))[0],source);
 await enroll(h,[a.source]);await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,censusMatch?0:1);assert.equal(await totalCredits(),censusMatch?1:2);
});
test('cohort source change during Census cannot publish a recovered estimate or spend fallback credit',async()=>{
 const {source}=await prepare();await historicalPostalNoMatch([source]);
 const h=harness({censusMatch:true,providerZip5:true,onCensus:()=>native.query('update public.equipment_units set gps_latitude=31,gps_longitude=-96 where id=$1',[source.nativeUnitId])});
 await enroll(h,[source]);await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,0);assert.equal(await totalCredits(),1);
 assert.equal((await projected(h,[source])).items.length,0);await h.run();assert.equal(h.counts.census,1);
});
test('recovery cannot spend above daily cap or replace old no_match before a real fallback reservation',async()=>{
 const {source}=await prepare();await historicalPostalNoMatch([source]);const h=harness({providerZip5:true});
 await enroll(h,[source]);await legacy.exec('update app_private.cos_geocodio_daily_budget set credits=2400');
 await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,0);assert.equal(await totalCredits(),2400);
 const cache=(await legacy.query('select status,reason,attempts from app_private.cos_field_geocode_fallback_cache')).rows[0];assert.deepEqual(cache,{status:'no_match',reason:'no_match',attempts:1});
 await h.run();assert.equal(h.counts.geocodio,0);assert.equal(await totalCredits(),2400);
});
