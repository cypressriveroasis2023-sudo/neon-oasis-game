import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {unitDiagnosticReport,unitDiagnosticFilename,unitDiagnosticDraft,diagnosticLabel} from '../src/unitDiagnosticReport.ts';
import UnitDiagnosticReport from '../src/UnitDiagnosticReport.tsx';
import {healthWithFieldInventory,cameraOverview} from '../src/cameraHealthCounts.ts';
import {fieldCameraHealth,validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {loadTicketUnitContext,ticketContextInstructions} from '../src/ticketContext.ts';
import {resource,port,snapshot,withStatus,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const unit={id:'11111111-1111-4111-8111-111111111111',unitNumber:'Ranger 1',modelName:'Ranger'};
const report=(rows,options={})=>unitDiagnosticReport({unit,rows,trusted:true,now,refreshedAt:fresh,identity:'matched',...options});

test('released v2 report separates failed provider, responding service, attempts and historical success',()=>{
 const row=withStatus(resource(1,'Ranger 1',{name:'Front camera',serviceEvidence:port({lastOnlineAt:'2026-10-05T12:00:00Z'}),connection:{publicIp:'203.0.113.20',ports:[80,443,554]}}),'offline');
 row.evidence.lastOnlineAt='2026-10-04T12:00:00Z';assert.equal(validateCameraHealth(snapshot([row])).evidenceVersion,2);
 const text=report([row]);
 for(const part of ['Resource: Front camera | 1 | cameras','Provider source: Star4Live','Current trusted provider result: OFFLINE','Current saved service result: Service endpoint reachable','Last provider observation: '+fresh.replace('Z','.000Z'),'Last service check attempted: '+fresh.replace('Z','.000Z'),'2026-10-04T12:00:00.000Z (historical only)','2026-10-05T12:00:00.000Z (historical only)','Observed per-port results: Unavailable','Service connectivity never proves camera video or recording'])assert.ok(text.includes(part),part);
 assert.doesNotMatch(text,/203\.0\.113|554|443|"connection"/);
});
test('unknown, stale, invalid, future and missing provider evidence cannot assert a current outage',()=>{
 for(const observedAt of ['2026-10-05T12:00:00Z',null,'bad','2026-10-07T12:00:00Z']){
  const text=report([withStatus(resource(1,'Ranger 1'),'offline',observedAt)]);
  assert.match(text,/Current trusted provider result: UNKNOWN \/ NOT VERIFIED/);
  assert.match(text,/Last reported result: OFFLINE \(older, missing or invalid observation; current status unverified\)/);
  assert.doesNotMatch(text,/Current trusted provider result: OFFLINE/);
 }
 const unknown=report([withStatus(resource(1,'Ranger 1'),'unknown')]);assert.match(unknown,/authentication-limited evidence does not establish an outage/);
 const old=report([resource(1,'Ranger 1')],{trusted:false});assert.match(old,/Unavailable \/ unverified response/);assert.doesNotMatch(old,/Current trusted provider result: ONLINE/);
});
test('inventory-only and ambiguous resources explain mapping instead of inventing camera tests',()=>{
 const row=resource('field:'+unit.id,'Ranger 1',{trackerOnly:true,type:'tracker_unit',evidence:undefined,scope:'unknown'});
 assert.match(report([row]),/Inventory-only resource: no camera observation is established/);
 assert.match(report([row]),/unit-to-resource mapping/);
 assert.match(report([],{identity:'ambiguous'}),/Resolve the conflicting unit identity/);
 assert.match(report([],{identity:'missing'}),/No exact current resource match/);
});
test('service failures stay service-only and recorder observations never prove channels',()=>{
 const direct=resource(2,'Sniper 2',{type:'Sniper',evidence:undefined,serviceEvidence:port({status:'offline',reachable:false,confirmedOutage:true})});
 const text=report([direct]);assert.match(text,/Current saved service result: Service check failed/);assert.match(text,/Current trusted provider result: UNKNOWN/);assert.match(text,/observed service-port results/);
 assert.match(report([resource(3,'Ranger 1',{type:'NVR'})]),/Recorder state does not establish camera channel status/);
});
test('exports select allowed fields and redact hostile labels, URLs, credentials and contacts',()=>{
 const row=resource(1,'Ranger 1',{name:'Front <img src=x onerror="window.reportXss=true"> token=secret-name user@example.com +1 555-222-3333 https://u:p@example.test/?secret=hidden',organization:'Contact person 555-555-5555',connection:{publicIp:'203.0.113.25',ports:[80]},metadata:{password:'metadata-password'},rawError:'Authorization: Bearer raw-token'});
 row.serviceEvidence=port({source:'Direct check https://example.test/private?token=private-key password=source-password'});
 const text=report([row]);
 for(const value of ['<img','reportXss','secret-name','user@example.com','555-222-3333','https://','source-password','203.0.113.25','metadata-password','raw-token','Contact person'])assert.ok(!text.includes(value),value);
 assert.match(text,/\[credential omitted\]/);assert.match(text,/\[link omitted\]/);
 assert.equal(diagnosticLabel('Front\n\u202eCamera'),'Front Camera');
 for(const value of ['{\"password\":\"hunter2\"}','Call (555)123-4567','Call 15551234567','user=admin&pass=hunter2','//private.example/path?key=hunter2'])assert.doesNotMatch(diagnosticLabel(value),/hunter2|555|1555|admin|private\.example/);
 const html=renderToStaticMarkup(React.createElement(UnitDiagnosticReport,{unit,rows:[row],trusted:true,now}));assert.doesNotMatch(html,/<img|onerror=/);assert.match(html,/textarea/);
 assert.equal(unitDiagnosticFilename({unitNumber:'../../Ranger / 1?secret=x'}),'cos-ranger-1-credential-omitted-diagnostic.txt');
});
test('solar stands, solar poles and skids remain zero-camera support equipment in reports and counts',()=>{
 for(const [unitNumber,modelName] of [['Solar Stand 72 044','SOLAR STANDS 72'],['Solar Pole 044','SOLAR POLE'],['Skid 44','SKID'],['Ranger 1','SOLAR POLES & SKIDS']]){
  const support={...unit,unitNumber,modelName},health=snapshot([]),merged=healthWithFieldInventory(health,[support]);
  assert.equal(merged.rows.length,0);assert.equal(cameraOverview(merged,now).summary.monitored,0);
  assert.equal(fieldCameraHealth(support,[support],health,now).state,'support');
  const text=report([resource(1)],{unit:support});assert.match(text,/SUPPORT EQUIPMENT · 0 CAMERAS/);assert.doesNotMatch(text,/Current trusted provider result: ONLINE|Observed per-port results/);
 }
});
const contextClient=(options={})=>({requests:[],async get(path){this.requests.push(path);const field={status:'installed',...(options.field||unit)};const data=path==='/api/equipment'?{items:[{...unit,...options.equipment,status:'installed',currentLocationType:'shop'}]}:path==='/api/field-map'?{items:[field],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:fresh}:['/api/customers','/api/sites'].includes(path)?{items:[]}:options.fail?(()=>{throw new Error('Authentication denied secret=private');})():snapshot([resource(1,'Ranger 1')]);return {data};}});
test('current unit context appends a read-only report; optional read failure remains unverified',async()=>{
 for(const fail of [false,true]){const client=contextClient({fail}),context=await loadTicketUnitContext(client,unit.id),text=ticketContextInstructions(context);assert.equal(client.requests.filter(path=>path==='/api/camera-health/summary-v3').length,1);assert.match(text,/COS UNIT DIAGNOSTIC REPORT/);assert.equal(context.unitId,unit.id);assert.doesNotMatch(text,/secret=private/);if(fail)assert.match(text,/Unavailable \/ unverified response/);}
});
test('different current field identity cannot attach another unit’s observations to a draft',async()=>{
 const context=await loadTicketUnitContext(contextClient({field:{...unit,unitNumber:'Ranger 2'}}),unit.id);assert.match(context.diagnosticReport,/Conflicting unit identity/);assert.doesNotMatch(context.diagnosticReport,/Resource: Synthetic resource 1/);
});

test('draft excerpt stays below ticket limits and explicitly points to the complete report',()=>{
 const full=report(Array.from({length:40},(_,i)=>resource(i+1,'Ranger 1',{serviceEvidence:port()})));
 assert.ok(full.length>12000);const draft=unitDiagnosticDraft(full);assert.ok(draft.length<=6000);assert.match(draft,/Report shortened for the ticket draft/);assert.ok(full.includes('Synthetic resource 40'));
});
test('conflicting current field capability prevents attaching camera observations to support equipment',async()=>{
 const context=await loadTicketUnitContext(contextClient({field:{...unit,modelName:'SOLAR POLES & SKIDS'}}),unit.id);assert.match(context.diagnosticReport,/Conflicting unit identity/);assert.doesNotMatch(context.diagnosticReport,/Resource: Synthetic resource 1/);
});

test('capability conflicts in either direction stay unknown even without a health response',async()=>{
 for(const fail of [false,true])for(const options of [{equipment:{modelName:'SOLAR POLES & SKIDS'}},{field:{...unit,modelName:'SOLAR POLES & SKIDS'}}]){
  const context=await loadTicketUnitContext(contextClient({...options,fail}),unit.id);assert.match(context.diagnosticReport,/Conflicting unit identity/);assert.doesNotMatch(context.diagnosticReport,/SUPPORT EQUIPMENT · 0 CAMERAS|camera testing does not apply|Current trusted provider result: ONLINE/);
 }
});
