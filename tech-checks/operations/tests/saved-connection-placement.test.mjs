import test from 'node:test';import assert from 'node:assert/strict';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';
import {cameraOverview} from '../src/cameraHealthCounts.ts';
import {savedConnectionObservation} from '../src/savedConnectionObservation.ts';
import {CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';
import {resource,port,snapshot,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const field={id:'synthetic-sniper-901',unitNumber:'Sniper 901',modelName:'SNIPERS',address:'123 Synthetic St'};
const row={...resource(9901,'SNIPER 901',{type:'Sniper'}),scope:'inactive',activationState:'deactivated',organization:'root',evidence:undefined,serviceEvidence:{...port(),active:false,observedAt:fresh,status:'online',reachable:true}};
const project=(record=row,time=now)=>fieldCameraHealth(field,[field],snapshot([record]),time);
test('901-style placement conflict preserves a fresh saved connection without changing inventory or totals',()=>{
 const result=project();assert.equal(result.state,'online');assert.equal(result.basis,'connection');assert.equal(result.classification.scope,'inactive');assert.match(result.reason,/PLACEMENT CONFLICT/);assert.match(result.reason,/does not move the unit/);
 assert.equal(result.rows[0].activationState,'deactivated');assert.equal(result.rows[0].organization,'root');assert.equal(cameraOverview(snapshot([row]),now).summary.monitored,0);
});
test('stale or invalid service observation stays unknown and keeps its original timestamp',()=>{
 const result=project(row,Date.parse(fresh)+CAMERA_FRESH_MS+1);assert.equal(result.state,'unknown');assert.equal(result.checkedAt,new Date(fresh).toISOString());
 for(const observedAt of [null,'invalid','2027-01-01T00:00:00Z'])assert.equal(project({...row,serviceEvidence:{...row.serviceEvidence,observedAt}}).state,'unknown');
});
test('a failed single check or conflicting response is not a confirmed offline connection',()=>{
 for(const patch of [{status:'offline',reachable:false,consecutiveFailures:1,confirmedOutage:false},{status:'offline',reachable:true,consecutiveFailures:3,confirmedOutage:true}])assert.equal(savedConnectionObservation({...row,serviceEvidence:{...row.serviceEvidence,...patch}},now),'verifying');
 assert.equal(project({...row,serviceEvidence:{...row.serviceEvidence,status:'offline',reachable:false,consecutiveFailures:3,confirmedOutage:true}}).state,'offline');
});
test('shop placement and a reachable service do not turn provider cameras or counts online',()=>{
 const shop={...row,scope:'shop',activationState:'active'};assert.equal(project(shop).state,'online');assert.equal(cameraOverview(snapshot([shop]),now).summary.monitored,0);
 const other={...field,unitNumber:'Solar Spotter 901',modelName:'Solar Spotter'};assert.equal(fieldCameraHealth(other,[other],snapshot([{...row,unit:'SOLAR SPOTTER 901'}]),now).state,'unknown');
});
