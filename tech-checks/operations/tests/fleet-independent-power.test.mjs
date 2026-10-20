import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFleetCommandCenter} from '../src/fleetCommandCenterModel.ts';
import {verifiedFleetPower} from '../src/fleetPowerVerification.ts';
import {automaticRefreshDue,AUTO_REFRESH_MS,POWER_SAVED_REFRESH_MS} from '../src/refreshCadence.ts';

const now=Date.parse('2026-10-20T12:45:00Z');
const time=new Date(now-60_000).toISOString();
const uid='11111111-1111-4111-8111-111111111111';
const uid2='22222222-2222-4222-8222-222222222222';
function fixture(){
 const source={productId:'2000001',recordId:'mhelp_product:2000001',unitNumber:'Helios 001',category:'Helios Solar Tower',
  placement:'FIELD',customer:'Synthetic customer',uploadLifecycle:'UNFLAGGED',
  sourceAddress:{street:'1 Test Road',city:'Houston',state:'TX',zip:'77001'},
  binding:{state:'linked',unitIds:[uid],candidateUnitIds:[],placementHeld:false}};
 const upload={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',source:'owner_supplied_mhelp_export',
  sourceSha256:'a'.repeat(64),receivedAt:time,summary:{totalRecords:1,fieldRecords:1,shopRecords:0,unflaggedFieldRecords:1,doNotUseRecords:0,missingRecords:0},records:[source]};
 const link={productId:source.productId,unitNumber:source.unitNumber,state:'unverified',unitId:uid,recordId:null,reason:'Camera provider unavailable'};
 const power={installationId:900001,name:'HELIOS 001',errorCode:null,lastAttemptAt:time,
  measurements:[{metric:'battery_soc',value:12,unit:'%',source:'battery',instance:0,observedAt:time}]};
 const rows=[{id:uid,placement:'field',retired:false,support:false,power}];
 const vrm={items:[{installationId:power.installationId,name:power.name,available:true,
  portalUrl:'https://vrm.victronenergy.com/installation/900001/dashboard',embedUrl:null}],
  sync:{state:'current',lastAttemptAt:time,lastSuccessAt:time,nextSyncAt:null,error:null,scheduleActive:true,connectionConfigured:true}};
 return {source,upload,link,health:{total:1,items:[link]},rows,vrm};
}
const panel=(f,cameraOk=false,inventoryOk=true)=>buildFleetCommandCenter(f.upload,f.health,cameraOk,f.rows,null,f.vrm,now,time,inventoryOk)?.panels.find(p=>p.key==='victron');

test('fresh uniquely linked power survives a failed camera read, without making cameras online',()=>{
 const f=fixture();
 const data=buildFleetCommandCenter(f.upload,f.health,false,f.rows,null,f.vrm,now,time,true);
 assert.equal(data.healthVerified,false);
 assert.deepEqual(data.counts,{online:0,offline:0,unverified:1,support:0,attention:1,unmapped:0});
 assert.deepEqual(data.panels.find(p=>p.key==='victron').counts,{online:1,offline:0,unverified:0,not_applicable:0});
 assert.equal(data.field,1);assert.equal(data.total,1);
 assert.match(data.panels.find(p=>p.key==='victron').products[0].reason,/independently of camera health/);
});

test('failed or unavailable inventory read cannot approve an independent power association',()=>{
 const f=fixture();assert.equal(panel(f,false,false).counts.online,0);
 f.health=null;assert.equal(panel(f).counts.online,0);
});

test('complete inventory and exact Product ID are required, not a matching equipment name',()=>{
 const f=fixture();f.health.items[0].productId='2000999';
 assert.equal(panel(f).counts.online,0);
 const g=fixture();g.health.items.push({...g.link});assert.equal(panel(g).counts.online,0);
 const h=fixture();h.health.total=2;assert.equal(panel(h).counts.online,0);
});

for(const [name,mutate] of [
 ['missing native identity',f=>{f.link.unitId=null;}],
 ['identity review',f=>{f.link.state='review';}],
 ['unlinked field record',f=>{f.link.state='unlinked';}],
 ['inactive registry',f=>{f.link.state='inactive';}],
 ['missing server binding',f=>{delete f.source.binding;}],
 ['held binding',f=>{f.source.binding.state='held';}],
 ['placement held',f=>{f.source.binding.placementHeld=true;}],
 ['candidate identity',f=>{f.source.binding.candidateUnitIds=[uid2];}],
 ['wrong bound native UUID',f=>{f.source.binding.unitIds=[uid2];}],
 ['duplicate bound UUID',f=>{f.source.binding.unitIds=[uid,uid];}],
 ['row moved to Shop',f=>{f.rows[0].placement='shop';}],
 ['retired row',f=>{f.rows[0].retired=true;}],
 ['duplicate row UUID',f=>{f.rows.push({...f.rows[0]});}],
 ['unavailable installation',f=>{f.vrm.items[0].available=false;}],
 ['missing installation',f=>{f.vrm.items=[];}],
 ['wrong installation ID',f=>{f.rows[0].power.installationId=900002;}],
 ['provider power error',f=>{f.rows[0].power.errorCode='provider';}],
 ['provider sync error',f=>{f.vrm.sync.error='Saved sync failed';}],
 ['provider syncing',f=>{f.vrm.sync.state='syncing';}],
 ['provider disconnected',f=>{f.vrm.sync.connectionConfigured=false;}],
 ['stale successful sync',f=>{f.vrm.sync.lastSuccessAt=new Date(now-21*60_000).toISOString();}],
 ['future measurement',f=>{f.rows[0].power.measurements[0].observedAt=new Date(now+60_000).toISOString();}],
 ['stale measurement',f=>{f.rows[0].power.measurements[0].observedAt=new Date(now-21*60_000).toISOString();}],
 ['absent measurement',f=>{f.rows[0].power.measurements=[];}],
])test(`power stays Unverified for ${name}`,()=>{
 const f=fixture();mutate(f);const p=panel(f);
 assert.ok(p);assert.equal(p.counts.online,0);assert.equal(p.counts.offline,0);assert.equal(p.counts.unverified,1);
});

test('two different equipment records claiming the same installation are both held',()=>{
 const f=fixture();f.rows.push({...f.rows[0],id:uid2});
 assert.equal(verifiedFleetPower(f.source,f.link,f.rows,f.vrm,now).online,false);
 const source2={...f.source,productId:'2000002',binding:{state:'linked',unitIds:[uid2],candidateUnitIds:[],placementHeld:false}};
 assert.equal(verifiedFleetPower(source2,{...f.link,productId:'2000002',unitId:uid2},f.rows,f.vrm,now).online,false);
});

test('Do Not Use is preserved, not reactivated by fresh power',()=>{
 const f=fixture();f.source.uploadLifecycle='DO_NOT_USE';f.upload.summary.unflaggedFieldRecords=0;f.upload.summary.doNotUseRecords=1;
 assert.equal(panel(f,true,true).counts.online,0);
 assert.equal(f.source.uploadLifecycle,'DO_NOT_USE');
});

test('refreshing a successful read never renews an old device timestamp',()=>{
 const f=fixture();f.rows[0].power.measurements[0].observedAt=new Date(now-40*60_000).toISOString();
 f.vrm.sync.lastAttemptAt=new Date(now).toISOString();f.vrm.sync.lastSuccessAt=new Date(now).toISOString();
 assert.equal(panel(f).counts.online,0);
});

test('saved power refresh is four minutes, hidden documents stay idle, router default stays 15 minutes',()=>{
 assert.equal(POWER_SAVED_REFRESH_MS,4*60_000);assert.equal(AUTO_REFRESH_MS,15*60_000);
 assert.equal(automaticRefreshDue(now-POWER_SAVED_REFRESH_MS,now,false,POWER_SAVED_REFRESH_MS),true);
 assert.equal(automaticRefreshDue(now-POWER_SAVED_REFRESH_MS+1,now,false,POWER_SAVED_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(now-POWER_SAVED_REFRESH_MS,now,true,POWER_SAVED_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(now-POWER_SAVED_REFRESH_MS,now,false),false);
});
