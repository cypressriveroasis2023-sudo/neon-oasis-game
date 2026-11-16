import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraReadingCoverage,cameraUpEvidence,priorCameraReading} from '../src/cameraReadingCoverage.ts';
const row=(source,observedAt,placement='FIELD',state='GREEN')=>({unit:'test',source,observedAt,placement,state});
test('source coverage keeps sources separate and excludes Shop',()=>{
 const data=[row(undefined,'2026-11-15T12:00:00Z'),row('ip_check','2026-11-15T13:00:00Z'),row('reconeyez',null),row('ip_check','2026-11-15T14:00:00Z','SHOP')];
 const copy=JSON.stringify(data),out=cameraReadingCoverage(data);
 assert.deepEqual(out.map(x=>x.field),[1,1,1]);assert.equal(out[0].newest,'2026-11-15T12:00:00.000Z');
 assert.equal(out[1].newest,'2026-11-15T13:00:00.000Z');assert.equal(out[2].newest,null);assert.equal(JSON.stringify(data),copy);
});
test('oldest and newest are observations, not request or feed times',()=>{
 const out=cameraReadingCoverage([row('ip_check','2026-11-15T13:00:00-06:00'),row('ip_check','2026-11-15T17:00:00Z')])[1];
 assert.equal(out.oldest,'2026-11-15T17:00:00.000Z');assert.equal(out.newest,'2026-11-15T19:00:00.000Z');
});
test('missing and invalid times remain unknown, not offline',()=>{
 const out=cameraReadingCoverage([row('reconeyez',null,'FIELD','UNKNOWN'),row('reconeyez','invalid')])[2];
 assert.equal(out.missingTime,2);assert.equal(out.oldest,null);assert.equal(out.unknown,1);
});
test('empty sources are explicitly represented without fabricated timestamps',()=>{
 assert.equal(cameraReadingCoverage([]).length,3);
 for(const row of cameraReadingCoverage([])){assert.equal(row.field,0);assert.equal(row.newest,null);}
});

test('up evidence separates reachability from provider groups without reclassifying or counting Shop',()=>{
 const rows=[row('ip_check',null),row('star4live',null),row('reconeyez',null),row('ip_check',null,'SHOP'),row('star4live',null,'FIELD','YELLOW'),row('ip_check',null,'FIELD','UNKNOWN'),row('reconeyez',null,'FIELD','RED')];
 const original=JSON.stringify(rows);
 assert.deepEqual(cameraUpEvidence(rows),{connections:1,cameraGroups:1,detectorGroups:1});
 assert.equal(JSON.stringify(rows),original);
 assert.deepEqual(cameraUpEvidence([]),{connections:0,cameraGroups:0,detectorGroups:0});
});

test('historical camera reading requires explicit past state and valid dated evidence',()=>{
 const camera={status:'unknown',lastReportedStatus:'offline',lastReportedAt:'2026-11-14T12:00:00Z'};
 assert.deepEqual(priorCameraReading(camera),{status:'offline',at:camera.lastReportedAt});
 assert.equal(priorCameraReading({...camera,status:'online'}),null);
 assert.equal(priorCameraReading({...camera,lastReportedAt:'invalid'}),null);
 assert.equal(priorCameraReading({...camera,lastReportedStatus:'unknown'}),null);
 assert.equal(priorCameraReading({status:'unknown'}),null);
});
