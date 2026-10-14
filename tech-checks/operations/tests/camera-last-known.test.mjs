import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {rememberCameraHistory,lastKnownCamera} from '../src/cameraLastKnown.ts';
import LastKnownCameraStatus from '../src/LastKnownCameraStatus.tsx';
import FleetUnitHealth from '../src/FleetUnitHealth.tsx';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';
import {fleetDashboardRows,fleetDashboardSummary} from '../src/fleetDashboardModel.ts';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {resource,snapshot,port,withStatus,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';

const unit={id:'11111111-1111-4111-8111-111111111111',unitNumber:'Helios 1',modelName:'Helios',status:'field',currentLocationType:'field',placement:'FIELD'};
const identity={unitId:unit.id,unitNumber:unit.unitNumber,kind:'native_provider',deviceIds:['1'],unitKeys:['Helios 1'],proof:'a'.repeat(64)};
const raw=(rows=[resource(1)])=>({...snapshot(rows),identityVersion:1,unitIdentities:[identity],identityWarnings:[]});
const map=(units=[unit])=>({items:units,inventoryItems:units,summary:{fieldUnits:units.length,mappedUnits:0,unitGps:0,missingGps:units.length},generatedAt:fresh});
const pair=(health=raw(),units=[unit])=>reconcileFleetSnapshot(health,map(units),now);
const current=(fleet,time=now)=>fieldCameraHealth(fleet.fieldMap.items[0],fleet.fieldMap.items,fleet.health,time);
const last=(history,fleet,time=now)=>lastKnownCamera(history,fleet.fieldMap.items[0],fleet.fieldMap.items,current(fleet,time));
const expired=now+16*60000;

for(const state of ['online','offline'])test('accepted '+state+' survives aging with original source time and unchanged current totals',()=>{
 const fleet=pair(raw([withStatus(resource(1),state)])),history=rememberCameraHistory(new Map(),fleet,now);
 assert.equal(history.size,1);assert.equal(last(history,fleet),null,'current definitive state needs no historical fallback');
 const historical=last(history,fleet,expired);assert.equal(historical.state,state);assert.equal(historical.label,'CAMERA RECORDS '+state.toUpperCase());assert.equal(historical.observedAt,new Date(fresh).toISOString());assert.notEqual(historical.observedAt,fleet.readAt);
 const rows=fleetDashboardRows(fleet.fieldMap.items,fleet.health,null,null,expired);assert.equal(rows[0].cameraState,'unknown');assert.deepEqual(fleetDashboardSummary(rows),{field:1,online:0,offline:0,unknown:1,verify:1});
 const reread={...fleet,readAt:new Date(expired).toISOString(),health:{...fleet.health,refreshedAt:new Date(expired).toISOString(),rows:fleet.health.rows.map(row=>({...row,status:'review',checkedAt:new Date(expired).toISOString()}))}};
 assert.deepEqual(last(rememberCameraHistory(history,reread,expired),reread,expired),historical,'rereading unchanged aged evidence never renews its time');
});

test('failed saved-data reads expose history only alongside an unknown current state',()=>{
 const fleet=pair(),history=rememberCameraHistory(new Map(),fleet,now),unknown=fieldCameraHealth(unit,[unit],null,now+60000);
 const historical=lastKnownCamera(history,unit,[unit],unknown);assert.equal(historical.state,'online');assert.equal(unknown.state,'unknown');assert.equal(fleetDashboardSummary(fleetDashboardRows([unit],null,null,null,now+60000)).online,0);
 assert.equal(lastKnownCamera(history,{...unit,placementAuditId:'new-audit'},[{...unit,placementAuditId:'new-audit'}],unknown),null);
});

test('cold stale data, historical successes and future timestamps cannot invent prior classifications',()=>{
 const fleet=pair();assert.equal(rememberCameraHistory(new Map(),fleet,expired).size,0);
 for(const change of [row=>({...row,evidence:{...row.evidence,status:'unknown'}}),row=>({...row,evidence:{...row.evidence,observedAt:null}}),row=>withStatus(row,'online',new Date(now+1).toISOString())])assert.equal(rememberCameraHistory(new Map(),pair(raw([change(resource(1))])),now).size,0);
});

test('newer unknown, mixed, disabled and changed source evidence discard the previous definitive result',()=>{
 const fleet=pair(),history=rememberCameraHistory(new Map(),fleet,now);
 for(const change of [
  row=>({...row,evidence:{...row.evidence,status:'unknown',observedAt:new Date(now).toISOString()}}),
  row=>({...row,evidence:{...row.evidence,status:'degraded',observedAt:new Date(now).toISOString()}}),
  row=>({...row,activationState:'inactive',evidence:{...row.evidence,active:false}}),
  row=>({...row,evidence:{...row.evidence,source:'unverified provider'}}),
  row=>withStatus(row,'online',new Date(now+1).toISOString()),
 ])assert.equal(rememberCameraHistory(history,pair(raw([change(resource(1))])),now).size,0);
});

test('changed membership, identity proof, placement and authorization guards cannot inherit old status',()=>{
 const fleet=pair(),history=rememberCameraHistory(new Map(),fleet,now);
 const variants=[
  {...fleet,health:{...fleet.health,rows:[]}},
  {...fleet,health:{...fleet.health,rows:[...fleet.health.rows,resource(2)]}},
  {...fleet,health:{...fleet.health,unitIdentities:[]}},
  {...fleet,health:{...fleet.health,identityWarnings:[{unitId:unit.id,reason:'Source identity changed'}]}},
  {...fleet,health:{...fleet.health,unitIdentities:[{...identity,proof:'b'.repeat(64)}]}},
  {...fleet,health:{...fleet.health,fieldRecorderObservationVersion:1,fieldRecorderObservationGuards:[]}},
  {...fleet,fieldMap:map([{...unit,placement:'SHOP'}])},
  {...fleet,fieldMap:map([{...unit,placementAuditId:'99'}])},
  {...fleet,fieldMap:map([{...unit,unitNumber:'Helios 2'}])},
  {...fleet,fieldMap:map([])},
 ];
 for(const changed of variants)assert.equal(rememberCameraHistory(history,changed,expired).size,0);
});

test('new canonical alias membership or duplicate unit blocks legacy-name historical fallback',()=>{
 const fleet=pair(snapshot([resource(1)])),history=rememberCameraHistory(new Map(),fleet,now);
 const alias={...fleet,health:snapshot([resource(1),resource(2,'HELIOS 001')])};assert.equal(current(alias,expired).state,'unknown');assert.equal(rememberCameraHistory(history,alias,expired).size,0);
 const duplicate={...fleet,fieldMap:map([unit,{...unit,id:'duplicate'}])};assert.equal(rememberCameraHistory(history,duplicate,expired).size,0);
});

test('recorder, detector and saved service-port history retain their actual basis',()=>{
 const cases=[
  [pair(raw([resource(1,'Helios 1',{type:'NVR'})])),'recorder','RECORDER ONLINE'],
  [pair(snapshot([resource(1,'Helios 1',{type:'detector'})])),'camera','DETECTOR RECORDS ONLINE'],
  [pair(snapshot([resource(1,'Sniper 1',{type:'Sniper',serviceEvidence:port()})]),[{...unit,unitNumber:'Sniper 1',modelName:'Snipers'}]),'connection','IP / PORT ONLINE'],
 ];
 for(const [fleet,basis,label] of cases){const history=rememberCameraHistory(new Map(),fleet,now),result=last(history,fleet,expired);assert.equal(result.basis,basis);assert.equal(result.label,label);}
});

test('camera history cannot borrow a newer recorder, port or opposite-state observation time',()=>{
 const newer=new Date(now-60000).toISOString();
 const fleet=pair(snapshot([resource(1),resource(2,'Helios 1',{type:'NVR',evidence:{...resource(2,'Helios 1',{type:'NVR'}).evidence,observedAt:newer},serviceEvidence:port({observedAt:newer})})]));
 const history=rememberCameraHistory(new Map(),fleet,now),historical=last(history,fleet,expired);assert.equal(historical.basis,'camera');assert.equal(historical.observedAt,new Date(fresh).toISOString());assert.equal(historical.oldestObservedAt,historical.observedAt);
 const outage=pair(snapshot([withStatus(resource(1),'offline'),withStatus(resource(2),'online',newer)])),negative=last(rememberCameraHistory(new Map(),outage,now),outage,expired);assert.equal(negative.state,'offline');assert.equal(negative.observedAt,new Date(fresh).toISOString());
 const direct=pair(snapshot([resource(1,'Sniper 1',{type:'Sniper',evidence:{...resource(1).evidence,observedAt:newer},serviceEvidence:port()})]),[{...unit,unitNumber:'Sniper 1',modelName:'Snipers'}]);
 const service=last(rememberCameraHistory(new Map(),direct,now),direct,expired);assert.equal(service.basis,'connection');assert.equal(service.observedAt,new Date(fresh).toISOString());
 const detector=pair(snapshot([withStatus(resource(1,'Helios 1',{type:'detector'}),'offline'),withStatus(resource(2,'Helios 1',{type:'NVR'}),'online',newer)]));
 const detected=last(rememberCameraHistory(new Map(),detector,now),detector,expired);assert.equal(detected.label,'DETECTOR RECORDS OFFLINE');assert.equal(detected.observedAt,new Date(fresh).toISOString());
});

test('historical presentation is neutral, clearly stale, and preserves the observation range',()=>{
 const fleet=pair(),historical=last(rememberCameraHistory(new Map(),fleet,now),fleet,expired);
 const html=renderToStaticMarkup(React.createElement(LastKnownCameraStatus,{observation:historical,now:expired}));
 assert.match(html,/Last known CAMERA RECORDS ONLINE/);assert.match(html,/Stale saved evidence; current status unverified/);assert.doesNotMatch(html,/camera-status-online|cos-signal-online|style=/);
 const freshFailure=renderToStaticMarkup(React.createElement(LastKnownCameraStatus,{observation:historical,now}));assert.match(freshFailure,/Saved historical evidence; current status unverified/);
 assert.equal(renderToStaticMarkup(React.createElement(LastKnownCameraStatus,{observation:null,now})), '');
 const range={...historical,oldestObservedAt:new Date(now-10*60000).toISOString()};assert.match(renderToStaticMarkup(React.createElement(LastKnownCameraStatus,{observation:range,now:expired})),/Source observations: .* to /);
});

test('the selected unit card retains its unknown current badge beside historical online text',()=>{
 const fleet=pair(),historical=last(rememberCameraHistory(new Map(),fleet,now),fleet,expired),row=fleetDashboardRows([unit],fleet.health,null,null,expired)[0];
 const html=renderToStaticMarkup(React.createElement(FleetUnitHealth,{row,now:expired,lastKnown:historical}));
 assert.match(html,/camera-status-unknown/);assert.match(html,/Last known CAMERA RECORDS ONLINE/);assert.match(html,/current status unverified/);assert.doesNotMatch(html,/camera-status-online|cos-signal-online/);
});
