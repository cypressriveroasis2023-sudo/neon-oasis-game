import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalCameraUnit,fieldCameraHealth,validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {cameraTimestamp,currentCameraStatus,CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';
import {cameraOverview} from '../src/cameraHealthCounts.ts';
import {resource,port,snapshot,withStatus,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const unit={id:'synthetic-field-one',unitNumber:'Solar Spotter 51',modelName:'Solar Spotter',status:'installed'};
const row=resource(1,'SOLARSPOTTER 051');
const project=(rows=[row],units=[unit],value=unit)=>fieldCameraHealth(value,units,snapshot(rows),now);
test('anchored family identifiers normalize padding without fuzzy matching',()=>{
 for(const label of ['SOLARSPOTTER 051','Solar Spotter51'])assert.equal(canonicalCameraUnit(label),'SOLARSPOTTER|51');
 assert.equal(canonicalCameraUnit('Spotter 051'),'SPOTTER|51');assert.equal(canonicalCameraUnit('Recon II 051'),'RECON2|51');assert.equal(canonicalCameraUnit('RII-051'),'RECON2|51');assert.equal(canonicalCameraUnit('RI051'),'RECON|51');assert.notEqual(canonicalCameraUnit('SNIPER 2 005'),canonicalCameraUnit('SNIPER 005'));
 for(const label of ['RII051 - Job Name','Spotter 051HD','051','Camera for Solar Spotter 051','Solar Spotter 000','Spotter 51 / 52'])assert.equal(canonicalCameraUnit(label),null);assert.equal(project().state,'online');
});
test('duplicate fields, resource IDs, conflicting models and unit aliases fail closed',()=>{
 for(const units of [[unit,{...unit,id:'different'}],[unit,{...unit,unitNumber:'Ranger 52'}]])assert.equal(project([row],units).state,'unknown');
 assert.equal(project([row],[{...unit,modelName:'Spotter'}],{...unit,modelName:'Spotter'}).identity,'missing');assert.equal(project([row,row]).identity,'ambiguous');assert.equal(project([row,{...row,id:2,unit:'Solar Spotter 051'}]).identity,'ambiguous');assert.equal(project([{...row,unit:'SPOTTER 051'}]).identity,'missing');
});
test('map camera-only red for any recent camera outage, while mixed provider groups remain review',()=>{
 const second=withStatus({...row,id:2},'offline'),result=project([row,second]);assert.equal(result.state,'offline');assert.equal(result.classification.cameraState,'degraded');assert.equal(cameraOverview(snapshot([row,second]),now).summary.offline,0);assert.equal(cameraOverview(snapshot([row,second]),now).coverage.degraded,1);
 assert.equal(project([row,withStatus(second,'offline','2026-10-06T16:00:00Z')]).state,'unknown');assert.equal(project([row,{...row,id:2}]).state,'online');
});
test('NVR and port-only health stay gray on camera pins and useful in unit details',()=>{
 for(const type of ['NVR','Sniper']){const record=resource(1,row.unit,{type,serviceEvidence:port()}),result=project([record]);assert.equal(result.state,'unknown');assert.equal(result.identity,'matched');assert.equal(result.unitKey,row.unit);assert.equal(result.classification.serviceState,'online');assert.match(result.reason,/Camera channel status unavailable/);if(type==='NVR')assert.equal(result.classification.providerState,'online');}
 const nvr=withStatus(resource(2,row.unit,{type:'NVR'}),'offline'),result=project([row,nvr]);assert.equal(result.state,'online');assert.equal(result.classification.providerState,'degraded');assert.equal(result.classification.recorderOffline,true);
});
test('detector-only state drives camera/detector pins without being counted as IPC',()=>{
 const record=withStatus(resource(1,'RII-051',{type:'detector'}),'offline'),field={...unit,unitNumber:'RII-051',modelName:'Recon 2'};assert.equal(project([record],[field],field).state,'offline');assert.equal(cameraOverview(snapshot([record]),now).cameras.total,0);
});
test('stale, future, invalid and absent times never color current pins',()=>{
 for(const observedAt of [null,undefined,'','invalid','2027-01-01T00:00:00Z','2026-02-30T10:00:00Z','2026-10-06T17:55:00','2026-10-06T16:00:00Z'])assert.equal(project([{...row,evidence:{...row.evidence,observedAt}}]).state,'unknown');
 assert.equal(cameraTimestamp('2026-10-06 17:55:00.123456+00',now).fresh,true);assert.equal(currentCameraStatus(row.evidence,Date.parse(fresh)+CAMERA_FRESH_MS),'online');assert.equal(currentCameraStatus(row.evidence,Date.parse(fresh)+CAMERA_FRESH_MS+1),'review');
});
test('placement confidence is independent, shop and inactive are excluded, and unresolved retains review',()=>{
 assert.equal(project([{...row,scope:'unknown'}]).state,'online');assert.match(project([{...row,scope:'unknown'}]).reason,/LOCATION REVIEW/);
 for(const scope of ['shop','inactive']){const result=project([{...row,scope}]);assert.equal(result.state,'unknown');assert.equal(result.classification.scope,scope);}
 assert.equal(project([row],[{...unit,status:'returning'}],{...unit,status:'returning'}).state,'online');
});
test('legacy summary or direct port evidence cannot supply current camera state',()=>{
 for(const evidenceVersion of [undefined,1])assert.equal(fieldCameraHealth(unit,[unit],{...snapshot([row]),evidenceVersion},now).state,'unknown');
 for(const status of ['online','offline'])assert.equal(project([{...row,status,evidence:undefined}]).state,'unknown');assert.equal(project([{...row,evidence:port()}]).state,'unknown');
});
test('one known online row explicitly limits coverage rather than claiming all cameras healthy',()=>{
 const result=project();assert.equal(result.state,'online');assert.match(result.reason,/Expected channel coverage is unknown/);assert.match(result.reason,/does not verify every camera/);assert.equal(result.rows.length,1);assert.equal(result.unitKey,row.unit);
});
test('cross-surface selected identity, source timestamps and service/provider dimensions are preserved',()=>{
 const rows=[row,withStatus(resource(2,row.unit,{type:'NVR'}),'offline')],health=snapshot(rows);assert.equal(validateCameraHealth(health),health);
 const map=fieldCameraHealth(unit,[unit],health,now),overview=cameraOverview(health,now).groups[0];assert.deepEqual(map.rows,overview.rows);assert.equal(map.checkedAt,overview.lastObservedAt);for(const key of ['scope','providerState','cameraState','serviceState','recorderOffline'])assert.equal(map.classification[key],overview[key]);assert.equal(map.identity,'matched');assert.equal(map.unitKey,overview.name);
});
