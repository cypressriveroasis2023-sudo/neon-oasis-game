import test from 'node:test';import assert from 'node:assert/strict';
import {fieldCameraHealth,unitHealthLabel,unitDiagnosticsPath,validateCameraHealth,canonicalCameraUnit} from '../src/fieldCameraHealth.ts';
import {resolveVerifiedUnitIdentity,verifiedIdentityForRows,linkedUnitObservation} from '../src/verifiedUnitIdentity.ts';
import {cameraOverview,cameraUnitStatusLabel,cameraUnitDisplayState,healthWithFieldInventory} from '../src/cameraHealthCounts.ts';
import {resource,snapshot,withStatus,port,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const unit={id:'11111111-1111-4111-8111-111111111111',unitNumber:'Solar Spotter 051HDC4',modelName:'Solar Spotter',status:'field'};
const rows=[resource(1,'SOLARSPOTTER 051'),resource(2,'SOLARSPOTTER 051')];
const identity={unitId:unit.id,unitNumber:unit.unitNumber,kind:'native_provider',deviceIds:['1','2'],unitKeys:['SOLARSPOTTER 051'],proof:'a'.repeat(64)};
const health=(resources=rows,identities=[identity],extra={})=>({...snapshot(resources),identityVersion:1,unitIdentities:identities,...extra});
const project=(h=health(),u=unit,units=[u])=>fieldCameraHealth(u,units,h,now);
test('explicit resource proof links a suffix asset without introducing suffix aliases',()=>{
 const h=health(),result=project(h);assert.equal(canonicalCameraUnit(unit.unitNumber),null);assert.equal(validateCameraHealth(h),h);assert.equal(result.state,'online');assert.equal(result.association.unitId,unit.id);assert.equal(unitHealthLabel(result),'CAMERA RECORDS ONLINE');assert.deepEqual(result.rows,rows);
 assert.equal(unitDiagnosticsPath(unit,result.rows),'../../camera-health.html?q=SOLARSPOTTER%20051');
 const group=cameraOverview(h,now).groups[0];assert.equal(group.unitIdentity.unitId,unit.id);assert.equal(cameraUnitDisplayState(group),'online');assert.equal(cameraUnitStatusLabel(group),unitHealthLabel(result));
 assert.equal(cameraOverview(healthWithFieldInventory(h,[unit]),now).records,2);assert.equal(project({...h,unitIdentities:[]}).state,'unknown');
});
test('complete device membership is required, including extra resources and source aliases',()=>{
 for(const h of [health(rows.slice(0,1)),health([...rows,resource(3,'SOLARSPOTTER 051')]),health([rows[0],rows[0]]),health([rows[0],{...rows[1],unit:'Solar Spotter 051'}]),health(rows,[{...identity,deviceIds:['1','1']}]),health(rows,[{...identity,unitKeys:['SOLARSPOTTER 051','SOLARSPOTTER 051']}])]){
  const result=project(h);assert.equal(result.state,'unknown');assert.equal(result.identity,'ambiguous');assert.equal(result.rows.length,0);
 }
});
test('changed equipment/provider ownership, proof versions and warnings fail closed',()=>{
 for(const h of [health(rows,[identity,{...identity,unitId:'different'}]),health(rows,[identity,identity]),health(rows,[{...identity,unitNumber:'Solar Spotter 052HDC4'}]),health(rows,[identity],{identityWarnings:[{unitId:unit.id,reason:'Changed verified association'}]}),health(rows.map(row=>({...row,evidence:{...row.evidence,source:'Reconeyez'}}))),health(rows,[identity],{identityVersion:2})])assert.equal(project(h).state,'unknown');
 assert.equal(project(health(),unit,[unit,{...unit}]).state,'unknown');assert.throws(()=>validateCameraHealth(health(rows,[{...identity,proof:'unverified'}])));
});
test('Owner generic model uses only matching current placement audit and complete devices',()=>{
 const owner={id:'22222222-2222-4222-8222-222222222222',unitNumber:'SOLARSPOTTER 051',modelName:'Camera unit',placementAuditId:'46',placementUnitKey:'SOLARSPOTTER 051'};
 const proof={...identity,unitId:owner.id,unitNumber:owner.unitNumber,kind:'owner_placement',placementAuditId:'46'};
 const h=health(rows,[proof]);assert.equal(project(h,owner).state,'online');
 for(const u of [{...owner,placementAuditId:'47'},{...owner,placementUnitKey:'SOLARSPOTTER 052'},{...owner,placementAuditId:undefined}])assert.equal(project(h,u).state,'unknown');
 const unresolved={...unit};const pair=[unresolved,owner];assert.equal(project(h,owner,pair).state,'online');assert.equal(project(h,unresolved,pair).state,'unknown');assert.equal(cameraOverview(h,now).records,2);assert.equal(cameraOverview(h,now).groups.length,1);
});
test('NVR source status remains recorder evidence and placement warning stays separate',()=>{
 const records=rows.map(row=>resource(row.id,row.unit,{type:'NVR',scope:'shop'}));
 const result=project(health(records));assert.equal(result.state,'online');assert.equal(result.basis,'recorder');assert.equal(unitHealthLabel(result),'RECORDER ONLINE');assert.equal(result.observation.cameraState,'mapping');assert.match(result.reason,/Individual camera channels and video are not verified/);assert.match(result.reason,/PLACEMENT CONFLICT/);
 assert.equal(cameraUnitStatusLabel(cameraOverview(health(records),now).groups[0]),'RECORDER ONLINE');
 const offline=records.map(row=>withStatus(row,'offline'));assert.equal(project(health(offline)).state,'offline');
});
test('mixed, partial observation, stale and future evidence never become fully online',()=>{
 for(const records of [[rows[0],withStatus(rows[1],'offline')],[rows[0],withStatus(rows[1],'online','2026-10-06T16:00:00Z')],rows.map(row=>withStatus(row,'online','2026-10-06T18:01:00Z')),rows.map(row=>withStatus(row,'online','2026-10-06T17:39:59Z'))])assert.equal(project(health(records)).state,'unknown');
 const boundary=rows.map(row=>withStatus(row,'online','2026-10-06T17:40:00Z'));assert.equal(project(health(boundary)).state,'online');
 const online=project(health([rows[0],withStatus(rows[1],'offline')]));assert.equal(unitHealthLabel(online),'CAMERA RECORDS MIXED / PARTLY VERIFIED');
});
test('current saved service fallback stays explicitly IP/port, not recorder or video proof',()=>{
 const records=rows.map(row=>({...withStatus(resource(row.id,row.unit,{type:'NVR'}),'online','2026-10-06T16:00:00Z'),serviceEvidence:port()}));const result=project(health(records));assert.equal(result.state,'online');assert.equal(unitHealthLabel(result),'IP / PORT ONLINE');assert.equal(result.observation.cameraState,'mapping');assert.match(result.reason,/service reachability/);
 const failed=records.map(row=>({...row,serviceEvidence:port({status:'unknown',reachable:null,observedAt:null})}));assert.equal(project(health(failed)).state,'unknown');
});
test('support and failed summary stay neutral without inheriting another device identity',()=>{
 const support={id:'stand',unitNumber:'Solar Stand 72 044',modelName:'SOLAR STANDS 72'};assert.equal(fieldCameraHealth(support,[support],health(),now).state,'support');assert.equal(fieldCameraHealth(unit,[unit],null,now).state,'unknown');
 assert.equal(verifiedIdentityForRows([rows[0]],health()),null);assert.equal(resolveVerifiedUnitIdentity({...unit,id:'other'},health()).state,'unavailable');
});
test('legacy base-name fallback cannot double-claim an explicitly associated source resource set',()=>{
 const base={id:'unreviewed-base',unitNumber:'Solar Spotter 051',modelName:'Solar Spotter'};const h=health(),units=[unit,base];
 assert.equal(project(h,unit,units).state,'online');const other=project(h,base,units);assert.equal(other.state,'unknown');assert.equal(other.identity,'ambiguous');assert.match(other.reason,/another verified equipment identity/);assert.equal(other.rows.length,0);
});
test('partial and warned source groups do not become verified equipment cards or totals',()=>{
 for(const h of [health(rows.slice(0,1)),health([...rows,resource(3,'SOLARSPOTTER 051')]),health(rows,[],{identityWarnings:[{unitId:unit.id,reason:'Reviewed equipment association changed',deviceIds:['1','2'],unitKeys:['SOLARSPOTTER 051']}]})]){
  const result=cameraOverview(h,now),group=result.groups[0];assert.ok(group.identityConflict);assert.equal(group.linkedIdentity,false);assert.equal(cameraUnitDisplayState(group),'verifying');assert.equal(cameraUnitStatusLabel(group),'EQUIPMENT LINK UNVERIFIED');assert.equal(result.summary.monitored,0);assert.equal(result.summary.online,0);assert.equal(result.records,h.rows.length);assert.equal(group.rows[0].evidence.status,'online');
 }
});
test('warning source claims prevent alternate-name fallback without suppressing unrelated equipment',()=>{
 const base={id:'unreviewed-base',unitNumber:'Solar Spotter 051',modelName:'Solar Spotter'};const other={id:'other',unitNumber:'Helios 100',modelName:'HELIOS'};const h=health([...rows,resource(3,'HELIOS 100')],[],{identityWarnings:[{unitId:unit.id,reason:'Reviewed link changed',deviceIds:['1','2'],unitKeys:['SOLARSPOTTER 051']}]});
 assert.equal(project(h,base,[base,other]).state,'unknown');assert.equal(project(h,other,[base,other]).state,'online');const summary=cameraOverview(h,now);assert.equal(summary.summary.monitored,1);assert.equal(summary.summary.online,1);assert.equal(summary.records,3);
});
test('Owner partial provider observations cannot filter an unverified expected IPC out of rollup',()=>{
 const owner={id:'owner-partial',unitNumber:'SOLARSPOTTER 051',modelName:'Camera unit',placementAuditId:'46',placementUnitKey:'SOLARSPOTTER 051'};const proof={...identity,unitId:owner.id,unitNumber:owner.unitNumber,kind:'owner_placement',placementAuditId:'46'};
 for(const change of [row=>({...row,evidence:undefined}),row=>({...row,evidence:{...row.evidence,kind:'unknown'}}),row=>({...row,type:'unknown',evidence:undefined})]){
  const h=health([rows[0],change(rows[1])],[proof]);validateCameraHealth(h);const result=project(h,owner);assert.equal(result.state,'unknown');assert.equal(result.observation.state,'degraded');const overview=cameraOverview(h,now);assert.equal(cameraUnitDisplayState(overview.groups[0]),'degraded');assert.equal(overview.summary.online,0);assert.equal(overview.coverage.cameraOnline,0);assert.notEqual(result.classification.state,'online');assert.notEqual(overview.groups[0].state,'online');
 }
});
