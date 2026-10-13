import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPlacementObservations,createPlacementSyncHandler} from '../../supabase/functions/cos-mhelp-placement-sync/index.ts';
import {collectFleetLocations} from '../../supabase/functions/cos-mhelp-placement-sync/fleetLocations.ts';
import {projectMhelpFieldPlacement,projectMhelpCameraPlacement,checkedMhelpPlacements} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
const native='11111111-1111-4111-8111-111111111111',tracker='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-10-12T18:00:00Z');
const link={equipmentId:'123',fullLabel:'Spotter 023.1',model:null};
const equipment={...link,name:link.fullLabel,active:null,customerId:'2',serviceLocationId:'3'};
const customers={2:{customerId:'2',name:'Example Builder',isServiceLocation:false,placement:'FIELD'},3:{customerId:'3',name:'North Job',isServiceLocation:true,placement:'FIELD'}};
const read=id=>Promise.resolve(customers[id]||null);
const entry={trackerId:tracker,nativeUnitId:native,trackerLabel:'Spotter 023.1',nativeLabel:'Spotter 023.1',guardCurrent:true,state:'confirmed',placement:'SHOP',customerLabel:'Cameras Onsite',siteLabel:'SHOP',observedAt:new Date(now).toISOString(),locationReview:false};
const receipt=(row={})=>({contract:'COS_MHELP_PLACEMENT_V1',lastSuccessAt:new Date(now).toISOString(),items:[{...entry,...row}]});
const snapshot=(row={})=>({items:[{id:native,unitNumber:entry.nativeLabel,latitude:30,longitude:-95}],inventoryItems:[{id:native,unitNumber:entry.nativeLabel,_sourceField:true,readOnly:false,latitude:30,longitude:-95,address:'Original address',site:'Original job',...row}],summary:{fieldUnits:1}});
const proof={identityVersion:1,unitIdentities:[{unitId:native,unitNumber:entry.nativeLabel,kind:'native_provider',deviceIds:['1','2'],unitKeys:['Spotter 023.1']}],identityWarnings:[]};
const withoutSourceMarker=rows=>rows.map(({mhelpConfirmedAssignment,...row})=>row);
test('exact live IDs retain decimal identities and resolve customer/service-location separately',async()=>{
 const result=await collectPlacementObservations([link],[equipment],read);
 assert.deepEqual(result,[{equipmentId:'123',state:'confirmed',customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Example Builder',siteLabel:'North Job'}]);
 assert.equal((await collectPlacementObservations([link],[{...equipment,name:'Spotter 023'}],read))[0].state,'held');
 assert.equal((await collectPlacementObservations([link],[{...equipment,model:'new model'}],read))[0].state,'held');
});
test('shop rule checks the assigned customer, and unknown/invalid field locations remain held',async()=>{
 const shop=await collectPlacementObservations([link],[equipment],id=>Promise.resolve(id==='2'?{customerId:'2',name:'Cameras Onsite LLC',isServiceLocation:false,placement:'SHOP'}:null));
 assert.equal(shop[0].placement,'SHOP');assert.equal(shop[0].siteLabel,'SHOP');
 const held=await collectPlacementObservations([link],[equipment],id=>Promise.resolve(id==='2'?customers[2]:null));
 assert.equal(held[0].reason,'service_location_unverified');
 assert.equal((await collectPlacementObservations([link],[{...equipment,active:false}],read))[0].reason,'identity_or_lifecycle_changed');
});
test('one failed customer cannot block independently verified assignments; reads use a bounded shared pool',async()=>{
 let active=0,max=0;
 const links=Array.from({length:12},(_,i)=>({...link,equipmentId:String(i+1)}));
 const rows=links.map((l,i)=>({...equipment,...l,customerId:String(i+100),serviceLocationId:String(i+200)}));
 const result=await collectPlacementObservations(links,rows,async id=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;if(id==='100')throw Error('private');return {customerId:id,name:'Synthetic '+id,isServiceLocation:+id>=200,placement:'FIELD'};});
 assert.ok(max<=3);assert.equal(result.filter(r=>r.state==='held').length,1);assert.equal(result.filter(r=>r.state==='confirmed').length,11);
});
test('Shop removes field pins and preserves the original snapshots',()=>{
 const s=snapshot(),before=structuredClone(s),result=projectMhelpFieldPlacement(s,receipt(),[],proof,now);
 assert.deepEqual(s,before);assert.equal(result.items.length,0);assert.equal(result.inventoryItems[0].placement,'SHOP');assert.equal(result.inventoryItems[0].latitude,null);
});
test('new assignment clears displayed old address/pin while keeping historical coordinates',()=>{
 const s=snapshot({historicalLatitude:30,historicalLongitude:-95});
 const result=projectMhelpFieldPlacement(s,receipt({placement:'FIELD',siteLabel:'New job',locationReview:true}),[],proof,now);
 assert.equal(result.items[0].address,null);assert.equal(result.items[0].latitude,null);assert.equal(result.items[0].site,'New job');assert.equal(result.items[0].historicalLatitude,30);assert.equal(s.inventoryItems[0].address,'Original address');
});
test('Owner/technician history, GPS, installed-site authority and changed labels are protected',()=>{
 for(const row of [{placementSource:'owner'},{hasUnitGps:true},{installedSiteId:tracker},{unitNumber:'Spotter 023'},{placementReviewReason:'Identity held'}]){
  const s=snapshot(row);assert.deepEqual(withoutSourceMarker(projectMhelpFieldPlacement(s,receipt(),[],proof,now).inventoryItems),s.inventoryItems);
 }
 const s=snapshot();assert.deepEqual(withoutSourceMarker(projectMhelpFieldPlacement(s,receipt(),[{unit_key:'Spotter 023.1',device_ids:['1']}],proof,now).inventoryItems),s.inventoryItems);
});
test('stale, future, held and duplicate observations cannot establish placement',()=>{
 for(const observedAt of [new Date(now-41*60*1000).toISOString(),new Date(now+1).toISOString()])assert.equal(checkedMhelpPlacements(receipt({observedAt}),now).length,0);
 assert.equal(checkedMhelpPlacements(receipt({state:'held'}),now).length,0);
 const r=receipt();r.items.push({...r.items[0]});assert.throws(()=>checkedMhelpPlacements(r,now));
});
test('stale confirmed placement remains recorded while old pins stay suppressed and manual authority is protected',()=>{
 const r=receipt({guardCurrent:true,observedAt:new Date(now-41*60*1000).toISOString()});
 const result=projectMhelpFieldPlacement(snapshot(),r,[],proof,now);assert.equal(result.items.length,0);assert.equal(result.inventoryItems[0].placement,'SHOP');assert.equal(result.inventoryItems[0].latitude,null);assert.equal(result.inventoryItems[0].placementEvidence.fresh,false);assert.equal(result.inventoryItems[0].placementEvidence.observedAt,r.items[0].observedAt);
 const manual=snapshot({placementSource:'owner'}),protectedRows=projectMhelpFieldPlacement(manual,r,[],proof,now).inventoryItems;
 assert.deepEqual(protectedRows.map(({mhelpConfirmedAssignment,...row})=>row),manual.inventoryItems);assert.equal(protectedRows[0].mhelpConfirmedAssignment.observedAt,r.items[0].observedAt);
});
test('camera scope uses complete verified native resource sets and leaves all provider telemetry unchanged',()=>{
 const devices=[{id:'1',unit_key:'Spotter 023.1',activation_state:'active',organization:'Example',source_status:'online',battery_percent:80},{id:'2',unit_key:'Spotter 023.1',activation_state:'active',organization:'Example',source_status:'offline'}];
 const before=structuredClone(devices),result=projectMhelpCameraPlacement(devices,receipt(),[],proof,now);
 assert.deepEqual(devices,before);assert.equal(result[0].organization,'ROOT');assert.equal(result[0].source_status,'online');assert.equal(result[1].source_status,'offline');assert.equal(result[0].battery_percent,80);
 assert.deepEqual(projectMhelpCameraPlacement(devices.slice(0,1),receipt(),[],proof,now),devices.slice(0,1));
 assert.deepEqual(projectMhelpCameraPlacement(devices,receipt(),[{unit_key:'Spotter 023.1'}],proof,now),devices);
});
test('authentication and strict action parsing happen before storage/provider work; failures are sanitized',async()=>{
 let calls=0;const rpc=async()=>{calls++;throw Error('private credential');};
 const request=body=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const denied=createPlacementSyncHandler({authenticate:async()=>false,rpc,equipment:async()=>[],customer:read});
 assert.equal((await denied(request({action:'run'}))).status,403);assert.equal(calls,0);
 const h=createPlacementSyncHandler({authenticate:async()=>true,rpc,equipment:async()=>[],customer:read});
 for(const body of [{action:'run',url:'https://evil.test'},{action:'run',token:'private'},{action:'other'}])assert.equal((await h(request(body))).status,400);
 assert.equal(calls,0);const response=await h(request({action:'run'}));assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);
});
test('lease refusal makes no provider calls; committed receipts report holds without claiming Google publication',async()=>{
 let reads=0;const h=createPlacementSyncHandler({authenticate:async()=>true,rpc:async name=>name.endsWith('begin')?{leaseId:null}:null,equipment:async()=>{reads++;return[];},customer:read});
 await h(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"run"}'}));assert.equal(reads,0);
});
test('aggregate read diagnostics appear only in an authenticated completed run',async()=>{
 const diagnostics={attempts:3,verified:2,failures:{http_401:1}};
 let snapshots=0;
 const h=createPlacementSyncHandler({authenticate:async()=>true,rpc:async name=>name.endsWith('begin')?{leaseId:'synthetic-lease',links:[link]}:name.endsWith('finish')?{committed:true,confirmed:1,held:0}:{enabled:true},equipment:async()=>[equipment],customer:read,readDiagnostics:()=>{snapshots++;return diagnostics;}});
 const request=action=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
 assert.deepEqual(await (await h(request('status'))).json(),{enabled:true});assert.equal(snapshots,0);
 assert.deepEqual((await (await h(request('run'))).json()).customerReads,diagnostics);assert.equal(snapshots,1);
 const denied=createPlacementSyncHandler({authenticate:async()=>false,rpc:async()=>{throw Error();},equipment:async()=>[],customer:read,readDiagnostics:()=>{snapshots++;return diagnostics;}});
 assert.equal((await denied(request('run'))).status,403);assert.equal(snapshots,1);
});


test('optional all-unit service-location failure preserves its prior cache and completes verified legacy placement reads',async()=>{
 const calls=[];const h=createPlacementSyncHandler({authenticate:async()=>true,rpc:async(name,body)=>{calls.push({name,body});return name.endsWith('begin')?{leaseId:'synthetic-lease',links:[link]}:name.endsWith('finish')?{committed:true,confirmed:1,held:0}:{};},equipment:async()=>[equipment],customer:read,locations:async()=>{throw Error('Synthetic bounded address failure; source details must remain private');}});
 const response=await h(new Request('https://synthetic.example/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run'})}));const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.state,'current');assert.equal(body.locationError,'service_location_refresh_unavailable');assert(!JSON.stringify(body).includes('source details'));
 const finish=calls.find(c=>c.name==='cos_mhelp_placement_finish');assert(finish);assert.equal(finish.body.p_observations.length,1);assert.equal(finish.body.p_observations[0].state,'confirmed');assert.equal('p_locations' in finish.body,false);
 assert(!calls.some(c=>['cos_mhelp_fleet_finish','cos_mhelp_placement_fail'].includes(c.name)),'a failed optional address read cannot overwrite location receipts or stop working placement evidence');
});

test('bounded location reads commit every candidate with verified successes and explicit per-unit holds',async()=>{
 const candidates=[10,11,12].map(n=>({kind:'equipment_unit',unitId:String(n),unitNumber:'Helios '+n,guard:'a'.repeat(64)}));
 const fleet=candidates.map((r,i)=>({equipmentId:String(900+i),name:r.unitNumber,active:true})),calls=[];
 const h=createPlacementSyncHandler({authenticate:async()=>true,rpc:async(name,body)=>{calls.push({name,body});return name.endsWith('begin')?{leaseId:'synthetic-lease',links:[link]}:name.endsWith('finish')?{committed:true,confirmed:1,held:0}:{};},equipment:async()=>[equipment,...fleet],customer:read,locations:rows=>collectFleetLocations(candidates,rows,async r=>{if(r.equipmentId!=='900')throw Error('Private source deadline detail');return {placement:'SHOP',customer:'Cameras Onsite',site:'Shop / ROOT',address:null,point:null,coordinateSource:null};})});
 const response=await h(new Request('https://synthetic.example/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"run"}'})),body=await response.json();
 assert.equal(response.status,200);assert.deepEqual(body.locationReads,{confirmed:1,held:2});assert.doesNotMatch(JSON.stringify(body),/Private/);
 const finish=calls.find(c=>c.name==='cos_mhelp_fleet_finish');assert(finish);assert.equal(finish.body.p_locations.length,3);assert.equal(finish.body.p_observations[0].state,'confirmed');
 assert.equal(finish.body.p_locations[0].state,'confirmed');assert(finish.body.p_locations.slice(1).every(r=>r.state==='held'&&r.reason==='mhelp_location_read_unavailable'));
});
