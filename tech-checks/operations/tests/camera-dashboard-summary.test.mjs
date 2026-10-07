import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {cameraDashboardSummary} from '../src/cameraDashboardSummary.ts';
import {cameraOverview} from '../src/cameraHealthCounts.ts';
import {resource,port,snapshot,withStatus,now} from './fixtures/camera-evidence-fixtures.mjs';
const dataset=()=>snapshot([resource(1,'Helios 1',{type:'NVR'}),withStatus(resource(2,'Helios 2'),'offline'),resource(3,'Helios 3'),withStatus(resource(4,'Helios 3'),'offline'),resource(5,'Helios 4',{type:'Sniper',serviceEvidence:port(),scope:'unknown'}),resource(6,'RII-001',{type:'detector',scope:'unknown'}),resource(7,'Helios 7',{scope:'shop'}),resource(8,'Helios 8',{scope:'inactive',activationState:'deactivated'})]);
test('both dashboards derive provider-system, camera and placement counts from native v2 coverage',()=>{
 const health=dataset(),dashboard=cameraDashboardSummary(health,now),native=cameraOverview(health,now);assert.equal(dashboard.available,true);assert.deepEqual(dashboard.coverage,native.coverage);assert.deepEqual(dashboard.scopes,native.scopes);assert.equal(dashboard.headline,'3 provider systems need review');
 assert.equal(dashboard.systems,'5 active / unresolved units · Provider systems: 2 online · 1 offline · 2 review');assert.equal(dashboard.cameraCoverage,'Camera/detector evidence by unit: 1 online · 1 offline · 1 mixed/unverified · 2 channel status unavailable');assert.equal(dashboard.serviceCoverage,'1 service-reachable only · 1 mixed provider systems');assert.equal(dashboard.placement,'3 confirmed-field units · 2 location review · 1 shop/root · 1 inactive');
 for(const name of ['CompanyOverview.tsx','VisionAreas.tsx']){const code=readFileSync(new URL('../src/'+name,import.meta.url),'utf8');assert.match(code,/cameraDashboardSummary\(/);assert.doesNotMatch(code,/camera\.fieldDevices|camera\.online|data\.online|data\.offline|data\.review/);}
});
test('legacy counts cannot turn into healthy fleet totals, regardless of declared online aggregates',()=>{
 for(const evidenceVersion of [undefined,1]){const data={...dataset(),evidenceVersion,rows:dataset().rows.filter(row=>row.scope==='field')};const value=cameraDashboardSummary(data,now);assert.equal(value.available,false);assert.equal(value.headline,'Health unavailable');assert.equal(value.coverage,null);assert.equal(value.attention,null);assert.doesNotMatch(value.systems,/\d+ online/);}
 const malformed=dataset();malformed.inventory.activeFieldRecords++;assert.equal(cameraDashboardSummary(malformed,now).available,false);assert.equal(cameraDashboardSummary(null,now).available,false);
});
test('dashboard observations age by presentation time without new reads or inferred outages',()=>{
 const data=snapshot([resource(1,'Helios 1',{type:'NVR'}),resource(2,'Helios 2',{type:'Sniper',serviceEvidence:port()})]);let value=cameraDashboardSummary(data,now);assert.equal(value.coverage.online,1);assert.equal(value.coverage.serviceReachable,1);
 value=cameraDashboardSummary(data,now+16*60000);assert.equal(value.coverage.online,0);assert.equal(value.coverage.offline,0);assert.equal(value.coverage.review,2);assert.equal(value.coverage.serviceReachable,0);assert.match(value.note,/silence is not an outage/);
});
test('confirmed empty v2 inventory is distinct from unavailable and never claims all cameras healthy',()=>{
 const value=cameraDashboardSummary(snapshot([]),now);assert.equal(value.available,true);assert.equal(value.coverage.total,0);assert.equal(value.headline,'No active / unresolved units recorded');assert.match(value.note,/not full camera coverage/);
});


test('all new consumers use the versioned route and never fall back to old aggregate semantics',()=>{
 for(const file of ['useCameraHealth.ts','todayDashboardData.ts','VisionAreas.tsx']){const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');assert.match(source,/\/api\/camera-health\/summary-v2/);assert.doesNotMatch(source,/['"]\/api\/camera-health\/summary['"]/);}
});
