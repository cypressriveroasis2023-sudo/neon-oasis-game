import {readFileSync} from 'node:fs';import vm from 'node:vm';
import test from 'node:test';import assert from 'node:assert/strict';
import {fieldCameraHealth,unitHealthLabel,unitDiagnosticsPath,validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {healthWithFieldInventory,cameraOverview} from '../src/cameraHealthCounts.ts';
import {resource,port,snapshot,now} from './fixtures/camera-evidence-fixtures.mjs';
test('imported SNIPERS and CAM V & RSU families retain exact identity and direct connection status without coordinates',()=>{
 for(const [unitNumber,modelName] of [['Sniper 334','SNIPERS'],['Sniper 2 344','SNIPERS'],['Sniper 4 100','SNIPERS'],['CAMV 010','CAM V & RSU']])for(const status of ['online','offline'])for(const scope of ['field','unknown','shop']){
  const unit={id:'fixture-unit',unitNumber,modelName,readOnly:true,address:'100 Synthetic Road'};
  const row=resource(1,unitNumber,{type:'tracker_unit',scope,evidence:undefined,serviceEvidence:port({status,reachable:status==='online',confirmedOutage:status==='offline'})});
  const result=fieldCameraHealth(unit,[unit],snapshot([row]),now);assert.equal(result.identity,'matched');assert.equal(result.state,status);assert.equal(unitHealthLabel(result),'IP / PORT '+status.toUpperCase());assert.match(result.reason,/video is not verified/);assert.equal(unit.latitude,undefined);
 }
});
test('missing stale inactive or ambiguous evidence never creates a green or red connection result',()=>{
 const unit={id:'fixture',unitNumber:'Sniper 2 344',modelName:'SNIPERS'};
 for(const evidence of [undefined,port({observedAt:'2020-01-01T00:00:00Z'}),port({status:'unknown',reachable:null}),port({observedAt:'2030-01-01T00:00:00Z'})]){
  const row=resource(1,unit.unitNumber,{type:'Sniper 2',evidence:undefined,serviceEvidence:evidence});assert.equal(fieldCameraHealth(unit,[unit],snapshot([row]),now).state,'unknown');
 }
 const row=resource(1,unit.unitNumber,{type:'Sniper 2',scope:'inactive',activationState:'deactivated',evidence:undefined,serviceEvidence:port()});assert.equal(fieldCameraHealth(unit,[unit],snapshot([row]),now).state,'unknown');
 assert.equal(fieldCameraHealth(unit,[unit,{...unit,id:'duplicate'}],snapshot([]),now).identity,'ambiguous');
});
test('36 existing field identities remain visible in overview without importing or fabricating health',()=>{
 const units=Array.from({length:36},(_,i)=>({id:'fixture-'+i,unitNumber:i<34?'Sniper '+(1000+i):'CAMV '+(1000+i),modelName:i<34?'SNIPERS':'CAM V & RSU',address:'Synthetic installed address '+i,readOnly:true}));
 const empty=snapshot([]),augmented=healthWithFieldInventory(empty,units);assert.equal(augmented.rows.length,36);validateCameraHealth(augmented);
 const overview=cameraOverview(augmented,now);assert.equal(overview.groups.length,36);assert.equal(overview.summary.online,0);assert.equal(overview.summary.offline,0);assert.equal(empty.rows.length,0);
 for(const row of augmented.rows){assert.equal(row.trackerOnly,true);assert.equal(row.serviceEvidence,undefined);assert.match(row.organization,/Synthetic installed address/);assert.ok(unitDiagnosticsPath({id:row.id,unitNumber:row.unit}));}
 const existing=resource(1,units[0].unitNumber,{type:'Sniper',serviceEvidence:port()});const kept=healthWithFieldInventory(snapshot([existing]),units);assert.equal(kept.rows.length,36);assert.equal(kept.rows[0],existing);
 assert.equal(healthWithFieldInventory(empty,[units[0],{...units[0],id:'conflict'}]).rows.length,0);
 assert.equal(unitDiagnosticsPath({id:'bad',unitNumber:'../fake'}),null);
});

test('all-unit totals never let a reachable service override provider outage or mixed evidence',()=>{
 const source=readFileSync(new URL('../../camera-health.html',import.meta.url),'utf8');const start=source.indexOf('function fleetConnectionState(');const context=vm.createContext({cameraGroup:d=>d.family});vm.runInContext(source.slice(start,source.indexOf('\n',start)),context);
 for(const providerState of ['online','offline','degraded'])assert.equal(context.fleetConnectionState({ds:[{family:'Sniper'}],providerState,serviceState:'online'}),providerState);
 assert.equal(context.fleetConnectionState({ds:[{family:'CAM V'}],providerState:'verifying',serviceState:'online'}),'online');
 assert.equal(context.fleetConnectionState({ds:[{family:'Vigilant'}],providerState:'verifying',serviceState:'online'}),'verifying');
});
