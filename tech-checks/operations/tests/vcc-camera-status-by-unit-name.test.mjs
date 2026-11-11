// Owner decision 2026-11-11 (James Martin): VCC is the status source for the
// VCC fleet. A Field unit takes its camera status from the VCC devices carrying
// its unit name when exactly one mHelp record and exactly one VCC unit group
// share that name: all cameras up = online, all down = offline, some down =
// online with the camera issues listed. It never overrides a held identity,
// an inactive record, support equipment or an existing status.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {resource,snapshot,withStatus} from './fixtures/camera-evidence-fixtures.mjs';
import {tvFieldCensus} from '../src/tvFieldCensus.ts';
import {cameraFieldProducts} from '../src/cameraFieldProducts.ts';
import {completedBoard} from '../durable-board/project.ts';
import {fleetAddressHealth} from '../src/fleetStatusPins.ts';
import {vccProductNameKey,vccGroupNameKey,cameraIssues,VCC_REPORTED} from '../src/vccUnitCameras.ts';

const f=fieldProductFixture();
const cam=(id,unit,status='online',options={})=>withStatus({...resource(id,unit,options),name:unit+' CAM '+id},status);
const health=extra=>Object.assign(snapshot([...f.health.rows,...extra]),{identityVersion:1,unitIdentities:f.health.unitIdentities,identityWarnings:[]});
const census=(extra,field=f.field)=>tvFieldCensus({...field,productConnections:f.connections},f.units,health(extra),null,null,f.now);
const states=(extra,field)=>Object.fromEntries(census(extra,field).products.items.map(p=>[p.productId,p]));
const base=states([]);

test('unit names are read conservatively',()=>{
 assert.equal(vccProductNameKey('Spotter 230HDC2'),'SPOTTER|230');assert.equal(vccProductNameKey('Solar Spotter 015 HDC2'),'SOLARSPOTTER|15');
 assert.equal(vccProductNameKey('Spotter 028.1 HDC4S - SOLAR COMPATIBLE'),'SPOTTER|28.1');assert.equal(vccProductNameKey('RANGER 029 .2'),null);
 assert.equal(vccProductNameKey('Sniper 148'),null);assert.equal(vccProductNameKey('Solar Stand 005'),null);assert.equal(vccProductNameKey('Spotter 2301'),'SPOTTER|2301');
 assert.equal(vccGroupNameKey('SOLARSPOTTER 045'),'SOLARSPOTTER|45');assert.equal(vccGroupNameKey('SPOTTER NVR 305'),'SPOTTER|305');assert.equal(vccGroupNameKey('SPOTTER 230 EXTRA'),null);
});
test('baseline: Ranger 901 has no status; held, Do Not Use and support units are as before',()=>{
 assert.ok(!['online','offline'].includes(base['1005'].state));assert.equal(base['1006'].state,'review');assert.equal(base['1007'].state,'inactive');assert.equal(base['1004'].state,'support');
});
test('all cameras up in VCC = online, labelled VCC-reported',()=>{
 const p=states([cam(51,'RANGER 901'),cam(52,'RANGER 901')])['1005'];
 assert.equal(p.state,'online');assert.ok(p.reason.startsWith(VCC_REPORTED),p.reason);assert.equal(p.evidence.association,'vcc_unit_name');
 assert.deepEqual(p.evidence.cameras,{source:'VCC',link:'unit_name',total:2,up:2,down:[],observedAt:new Date(f.fresh).toISOString()});assert.equal(cameraIssues(p),null);assert.equal(p.evidence.followUp,undefined);
});
test('all cameras down in VCC = offline',()=>{
 const p=states([cam(51,'RANGER 901','offline'),cam(52,'RANGER 901','offline')])['1005'];
 assert.equal(p.state,'offline');assert.match(p.reason,/All 2 cameras are offline in VCC/);assert.equal(cameraIssues(p),null);
});
test('some cameras down = online with the down cameras named',()=>{
 const p=states([cam(51,'RANGER 901'),cam(52,'RANGER 901','offline'),cam(53,'RANGER 901')])['1005'];
 assert.equal(p.state,'online');assert.deepEqual(cameraIssues(p).down,['RANGER 901 CAM 52']);assert.match(p.reason,/2 of 3 cameras online in VCC\. Offline: RANGER 901 CAM 52\./);
});
test('a recorder-only unit is read from its recorder',()=>{
 const p=states([cam(51,'RANGER 901','offline',{type:'NVR'})])['1005'];assert.equal(p.state,'offline');assert.equal(p.evidence.basis,'recorder');
});
test('a camera without a current VCC reading means no status is claimed',()=>{
 const p=states([cam(51,'RANGER 901'),withStatus(cam(52,'RANGER 901'),'online','2026-10-01T00:00:00Z')])['1005'];
 assert.equal(p.state,base['1005'].state);assert.equal(p.reason,base['1005'].reason);assert.equal(p.evidence.cameras,undefined);
});
test('two VCC unit groups with the same name, or two mHelp records with the same name, are never linked',()=>{
 let p=states([cam(51,'RANGER 901'),cam(52,'RANGER NVR 901')])['1005'];assert.equal(p.state,base['1005'].state);
 const records=f.upload.records.map(r=>r.productId==='1008'?{...r,unitNumber:'Ranger 901 HD'}:r);
 p=states([cam(51,'RANGER 901')],{...f.field,uploadInventory:{...f.upload,records}})['1005'];assert.equal(p.state,base['1005'].state);
});
test('held identity, Do Not Use and support units are never given a status by name',()=>{
 const s=states([cam(51,'RANGER 902'),cam(52,'RANGER 903'),cam(53,'ST 001')]);
 assert.equal(s['1006'].state,'review');assert.equal(s['1007'].state,'inactive');assert.equal(s['1004'].state,'support');
 for(const id of ['1006','1007','1004'])assert.equal(s[id].reason,base[id].reason,id);
});
test('units that already had a status keep it; every other unit is unchanged',()=>{
 const s=states([cam(51,'RANGER 901')]);
 for(const id of ['1001','1002','1003','1004','1006','1007']){assert.equal(s[id].state,base[id].state,id);assert.equal(s[id].reason,base[id].reason,id);}
});
test('devices already reviewed as another unit are never claimed by name',()=>{
 // Device 1 is the reviewed device of Helios 1 (Product 1001).
 const rows=f.health.rows.map(row=>String(row.id)==='1'?{...row,unit:'RANGER 901'}:row);
 const changed=Object.assign(snapshot(rows),{identityVersion:1,unitIdentities:f.health.unitIdentities.map(identity=>identity.deviceIds[0]==='1'?{...identity,unitKeys:['RANGER 901']}:identity),identityWarnings:[]});
 const p=tvFieldCensus({...f.field,productConnections:f.connections},f.units,changed,null,null,f.now).products.items.find(item=>item.productId==='1005');
 assert.ok(!['online','offline'].includes(p.state),p.state);
});
test('map pins take the VCC colour on the camera layer only',()=>{
 const c=census([cam(51,'RANGER 901','offline')]);
 assert.equal(fleetAddressHealth(c.products.items,c.rows,'camera').get('1005'),'offline');assert.equal(fleetAddressHealth(c.products.items,c.rows,'router').get('1005'),'unknown');
});
test('Fleet, TV and the saved board count it the same way',()=>{
 const before=completedBoard(health([]),f.field,f.connections,null,f.now),after=completedBoard(health([cam(51,'RANGER 901','offline')]),f.field,f.connections,null,f.now);
 assert.equal(after.counts.offline,before.counts.offline+1);assert.equal(after.counts.unverified,before.counts.unverified-1);assert.equal(after.counts.online,before.counts.online);
 assert.equal(after.units.find(u=>u.productId==='1005').status,'offline');assert.deepEqual(after.units.filter(u=>u.productId!=='1005'),before.units.filter(u=>u.productId!=='1005'));
 const live=cameraFieldProducts({...f.field,productConnections:f.connections},health([cam(51,'RANGER 901','offline')]),f.now,true);assert.deepEqual(live.counts,after.counts);
 assert.equal(census([cam(51,'RANGER 901','offline')]).board.counts.offline,after.counts.offline);
});
