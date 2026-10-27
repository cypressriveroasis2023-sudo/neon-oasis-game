import test from 'node:test';
import assert from 'node:assert/strict';
import {tvFieldCensus,tvCensusOutages} from '../src/tvFieldCensus.ts';
import {buildFleetCommandCenter} from '../src/fleetCommandCenterModel.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {buildExactProductConnections,VERIFIED_TRACKER_IP_CONTRACT,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';

test('TV and Fleet share exact Product-ID membership while diagnostic units remain separate',()=>{
 const f=fieldProductFixture();
 const tv=tvFieldCensus(f.field,f.units,f.health,null,null,f.now);
 const fleet=buildFleetCommandCenter(f.upload,tv.products,true,tv.rows,null,null,f.now,f.health.refreshedAt);
 assert.deepEqual(tv.board,fleet);
 assert.equal(tv.board.field,7);assert.equal(tv.board.shop,1);
 assert.deepEqual(tv.board.counts,{online:1,offline:1,unverified:4,support:1,attention:5,unmapped:0});
 assert.equal(tv.board.items.length,7);assert.equal(new Set(tv.board.items.map(p=>p.productId)).size,7);
 const diagnostics=tv.rows.map(row=>({unit:row.unit,health:row.camera}));
 diagnostics.push({unit:{id:'unaccepted-extra-native-outage'},health:{state:'offline'}});
 const down=tvCensusOutages(tv.board,diagnostics);
 assert.deepEqual(down.map(p=>p.productId),['1002']);assert.equal(down.length,tv.board.counts.offline);
 assert(!tv.board.items.some(p=>p.productId==='1008'));
});

test('a failed or stale health read preserves Field census without fabricating outages',()=>{
 const f=fieldProductFixture();
 for(const [health,now] of [[null,f.now],[f.health,f.now+30*60000]]){
  const tv=tvFieldCensus(f.field,f.units,health,null,null,now);
  assert.equal(tv.board.field,7);assert.equal(tv.board.counts.online,0);assert.equal(tv.board.counts.offline,0);
  assert.equal(tv.board.counts.support,1);assert.equal(tv.board.counts.unverified,6);
  assert.deepEqual(tvCensusOutages(tv.board,tv.rows.map(row=>({unit:row.unit,health:row.camera}))),[]);
 }
});

test('held Product-ID association remains unknown even when its former device is online',()=>{
 const f=fieldProductFixture();f.upload.records[0].binding.placementHeld=true;
 const tv=tvFieldCensus(f.field,f.units,f.health,null,null,f.now);
 assert.equal(tv.board.counts.online,0);assert.equal(tv.board.items.find(p=>p.productId==='1001').status,'unverified');
});

test('without accepted source TV retains diagnostic rows without inventing a Product-ID census',()=>{
 const f=fieldProductFixture(),tv=tvFieldCensus(null,f.units,f.health,null,null,f.now);
 assert.equal(tv.board,null);
 assert.equal(tvCensusOutages(null,tv.rows.map(row=>({unit:row.unit,health:row.camera}))).length,1);
});

test('reported 284-product census remains 74 online, 2 offline, 125 unknown and 83 support despite 249 native rows',()=>{
 const f=fieldProductFixture(),units=[],records=[],roster=[],resources=[],identities=[];
 for(let i=0;i<1001;i++){
  const field=i<284,support=field&&i>=201,native=i<249,productId=String(2000+i),id='90000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  const unitNumber=(support?'ST ':'Spotter ')+(i+1),category=support?'STANDS':'Spotter';
  const unit={...f.units[0],id,unitNumber,modelName:category};
  if(native)units.push(unit);
  records.push({...f.upload.records[0],productId,recordId:'mhelp_product:'+productId,unitNumber,category,placement:field?'FIELD':'SHOP',binding:{state:native?'linked':'unlinked',unitIds:native?[id]:[],candidateUnitIds:[],placementHeld:false}});
  roster.push({...f.roster.items[0],id:native?'cos_unit:'+id:'mhelp_product:'+productId,kind:native?'unit':'source_equipment',unitId:native?id:null,unit:native?unit:null,unitNumber,placement:field?'field':'shop',productIds:[productId],sourceRecordIds:['mhelp_product:'+productId],representedUnitIds:native?[id]:[]});
  if(i<201){
   const base=f.health.rows[0];resources.push({...base,id:String(i+1),unit:unitNumber,evidence:{...base.evidence,status:i<74?'online':i<76?'offline':'unknown'}});
   identities.push({...f.health.unitIdentities[0],unitId:id,unitNumber,deviceIds:[String(i+1)],unitKeys:[unitNumber]});
  }
 }
 const health={...f.health,totalDevices:201,fieldDevices:201,review:201,rows:resources,unitIdentities:identities,inventory:{allRecords:201,activeFieldRecords:201,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}};
 const upload={...f.upload,records,summary:{totalRecords:1001,fieldRecords:284,shopRecords:717,unflaggedFieldRecords:284,unflaggedShopRecords:717,doNotUseRecords:0,missingRecords:0}};
 const field={...f.field,uploadInventory:upload,fleetRoster:{...f.roster,items:roster,summary:{totalRecords:1001,activeRecords:1001,field:284,shop:717,review:0,excludedLifecycle:0,sourceOnlyRecords:752,linkedUnitRecords:249}}};
 const tv=tvFieldCensus(field,units,health,null,null,f.now);
 assert.equal(tv.rows.length,249);assert.equal(tv.board.field,284);
 assert.deepEqual([tv.board.counts.online,tv.board.counts.offline,tv.board.counts.unverified,tv.board.counts.support],[74,2,125,83]);
 assert.equal(tv.board.items.length,284);assert.equal(new Set(tv.board.items.map(p=>p.productId)).size,284);
 assert.deepEqual(tvCensusOutages(tv.board,tv.rows.map(row=>({unit:row.unit,health:row.camera}))).map(p=>p.productId),['2074','2075']);
 assert.equal(tv.board.total,1001);assert.equal(tv.board.shop,717);
});

test('TV outage population honors current Product-ID TCP proof even when native provider status disagrees',()=>{
 const f=fieldProductFixture();
 const tracker={contract:VERIFIED_TRACKER_IP_CONTRACT,workbookId:TRACKER_IP_WORKBOOK,
  expectedMhelpSourceSha256:f.upload.sourceSha256,verifiedAt:f.fresh,
  records:f.upload.records.map(p=>({productId:p.productId,recordId:p.recordId,placement:p.placement,
    publicIp:p.productId==='1001'?'8.8.8.8':p.productId==='1005'?'9.9.9.9':null}))};
 const endpoint=(deviceId,ip)=>({deviceId,publicIp:ip,expectedPorts:[80],monitoringEnabled:true,connectionRevision:3,
  portStatus:{80:{online:false,attempted:true},_connection:{ip,revision:3,status:'offline',reachable:false,checkedAt:f.fresh,consecutiveFailures:1,confirmedOutage:false}}});
 const receipt=buildExactProductConnections(f.upload,tracker,[endpoint(55,'8.8.8.8'),endpoint(56,'9.9.9.9')],f.now);
 assert.ok(receipt);
 const tv=tvFieldCensus({...f.field,productConnections:receipt},f.units,f.health,null,null,f.now);
 // Product 1002 has a legacy provider Offline observation but no valid
 // Product-ID TCP check: the strict receipt records UNKNOWN, not an outage.
 assert.equal(tv.board.counts.offline,2);
 assert.equal(tv.board.items.find(p=>p.productId==='1002').status,'unverified');
 const physical=tv.rows.map(row=>({unit:row.unit,health:row.camera}));
 const outages=tvCensusOutages(tv.board,physical);
 assert.deepEqual(outages.map(v=>v.productId),['1001']);
 assert.equal(outages[0].health.state,'offline');
 assert.equal(outages[0].health.basis,'connection');
 const sourceOnly=tv.board.items.filter(p=>p.status==='offline'&&!outages.some(o=>o.productId===p.productId));
 assert.deepEqual(sourceOnly.map(p=>p.productId),['1005']);
 assert.equal(sourceOnly[0].linked.evidence.association,'exact_product_id_tracker_endpoint');
});
 
test('TV native rows use exact Unknown instead of older provider colors',()=>{
 const f=fieldProductFixture();
 const receipt={contract:'COS_EXACT_PRODUCT_CONNECTIONS_V1',sourceSha256:f.upload.sourceSha256,
  trackerVerifiedAt:f.fresh,
  items:f.upload.records.filter(r=>r.placement==='FIELD').map(r=>({
   productId:r.productId,status:'unknown',basis:'tcp_service_port',
   checkedAt:null,resourceId:null,reason:'Exact saved TCP check unavailable.'
  }))};
 const tv=tvFieldCensus({...f.field,productConnections:receipt},f.units,f.health,null,null,f.now);
 assert.equal(tv.board.counts.online,0);assert.equal(tv.board.counts.offline,0);
 assert.equal(tv.rows.find(row=>row.id===f.units[0].id).cameraState,'unknown');
 assert.equal(tv.rows.find(row=>row.id===f.units[1].id).cameraState,'unknown');
 assert.equal(tv.rows.find(row=>row.id===f.units[0].id).camera.basis,'connection');
 assert.deepEqual(tvCensusOutages(tv.board,tv.rows.map(row=>({unit:row.unit,health:row.camera}))),[]);
});
