// Newly authored synthetic regressions; not the missing c3517ee5 delivery.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {serviceState,classifyCameraUnit,evidenceCoverage} from '../src/cameraEvidence.ts';
import {savedConnectionObservation} from '../src/savedConnectionObservation.ts';
import {fleetDashboardRows,filterFleetDashboard,fleetDashboardSummary,initialFleetFilters} from '../src/fleetDashboardModel.ts';
import {resource,port,snapshot} from './fixtures/camera-evidence-fixtures.mjs';
const now=Date.parse('2026-10-15T12:00:00Z'),at='2026-10-15T11:55:00Z';
const file=name=>fs.readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const script=[...file('camera-detail.html').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function effectiveHealth('))[1];
const parsed=ts.createSourceFile('detail.js',script,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
const functions=new Map(parsed.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,n.getText(parsed)]));
function legacy(){
 const nodes=new Map();const ctx=vm.createContext({Intl,Date:class extends Date{static now(){return now;}},detailReadFailures:[],document:{hidden:false},$:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{add(){},remove(){}},value:'unsaved edit'});return nodes.get(id);}});
 for(const name of ['camera-status-contract.js','camera-health-history.js','camera-health-overview.js'])vm.runInContext(file(name),ctx);
 for(const name of ['cameraPlatform','cameraGroup','sourceFresh','checkFresh','effectiveHealth','detailObservation','sourceStatusText','sourceDetailText','issueReason','renderStatusEvidence','coreHeliosInterfacesOnline'])vm.runInContext(functions.get(name),ctx);
 return {ctx,nodes};
}
const families=[['Sniper 308','Sniper','2026_unit_tracker'],['Sniper 317','Sniper','2026_unit_tracker'],['CAM V 901','CAMV','2026_unit_tracker'],['Helios 901','NVR','vigilant_control_center'],['Ranger 901','IPC','vigilant_control_center'],['Recon II 901','detector','reconeyez']];
for(const [unit,type,source] of families)for(const activation of ['active','deactivated',''])for(const scope of ['field','shop'])test(`${unit}: service proof independent of ${activation||'missing activation'} / ${scope}`,()=>{
 const {ctx}=legacy(),d={id:1,unit_key:unit,device_type:type,source,organization:scope==='shop'?'ROOT':'Synthetic site',activation_state:activation};
 const h={checked_at:at,overall_status:'online',ip_reachable:true,port_status:{443:{online:true}}};
 const row=resource(1,unit,{type,scope,activationState:activation,serviceEvidence:port({active:activation==='active',observedAt:at})});
 ctx.device=d;ctx.current=h;
 assert.equal(ctx.CameraHealthOverview.serviceState(d,{1:h},now),'online');assert.equal(serviceState(row,now),'online');assert.equal(savedConnectionObservation(row,now),'online');
 assert.equal(classifyCameraUnit([row],now).serviceState,'online');assert.equal(ctx.effectiveHealth(d,h),'online');assert.match(ctx.sourceStatusText(),/^IP \/ PORT ONLINE/);assert.match(ctx.sourceDetailText(),/Video not verified/);
 if(scope==='shop'){assert.match(ctx.detailObservation().review,/SHOP \/ ROOT.*reachable/);assert.equal(evidenceCoverage([classifyCameraUnit([row],now)]).total,0);}
});
for(const patch of [{status:'offline',reachable:true,confirmedOutage:true},{status:'offline',reachable:false,consecutiveFailures:1},{status:'online',reachable:false}])test('contradictory/incomplete service proof '+JSON.stringify(patch),()=>{
 const {ctx}=legacy(),d={id:1,unit_key:'Sniper 308',device_type:'Sniper',activation_state:'active'};
 const row=resource(1,'Sniper 308',{serviceEvidence:port({...patch,observedAt:at})});
 const h={checked_at:at,overall_status:patch.status,ip_reachable:patch.reachable,confirmed_outage:patch.confirmedOutage,consecutive_failures:patch.consecutiveFailures};
 assert.equal(serviceState(row,now),'verifying');assert.equal(ctx.CameraHealthOverview.serviceState(d,{1:h},now),'verifying');
});
for(const observedAt of [null,'bad','2026-02-30T12:00:00Z','2026-10-15T12:01:00Z','2026-10-15T10:00:00Z'])test('source clock rejects '+observedAt,()=>{
 const {ctx}=legacy(),d={id:1,source:'reconeyez',device_type:'detector',activation_state:'active',source_status:'online',source_last_seen_at:observedAt};ctx.device=d;
 assert.equal(ctx.effectiveHealth(d,{}),'verifying');assert.equal(serviceState(resource(1,'Sniper 308',{serviceEvidence:port({observedAt})}),now),'verifying');
});
for(const [type,label] of [['IPC','CAMERA RECORD ONLINE'],['NVR','RECORDER ONLINE'],['detector','DETECTOR RECORD ONLINE'],['bridge','IP / PORT UNVERIFIED']])test('resource evidence labels '+type,()=>{
 const {ctx}=legacy(),d={id:1,source:type==='detector'||type==='bridge'?'reconeyez':'vigilant_control_center',device_type:type,activation_state:'active',source_status:'online',source_last_seen_at:at};ctx.device=d;ctx.current={};
 assert.equal(ctx.detailObservation().label,label);assert.match(ctx.sourceDetailText(),/Video not verified/);
});
test('stale connection revision and malformed metadata cannot retain a reachable label',()=>{
 const {ctx}=legacy(),d={id:1,unit_key:'Sniper 317',device_type:'Sniper',activation_state:'active',connection_revision:2,public_ip:'192.0.2.1'};
 for(const meta of [null,[],{revision:1,ip:d.public_ip,checkedAt:at,status:'online',reachable:true}])assert.equal(ctx.CameraHealthOverview.serviceState(d,{1:{checked_at:at,overall_status:'online',ip_reachable:true,port_status:{_connection:meta}}},now),'verifying');
});
for(const n of [308,317])test(`Sniper ${n}: Shop review survives green service and stays out of Field totals`,()=>{
 const unit={id:'synthetic-'+n,unitNumber:'Sniper '+n,modelName:'SNIPERS',placement:'SHOP',currentLocationType:'shop',status:'available'};
 const row=resource(n,unit.unitNumber,{type:'Sniper',scope:'shop',activationState:'deactivated',serviceEvidence:port({active:false,observedAt:at})});
 const rows=fleetDashboardRows([unit],snapshot([row]),[],null,now);assert.equal(rows[0].cameraState,'online');assert.match(rows[0].review.join(' '),/PLACEMENT REVIEW: SHOP \/ ROOT.*reachable/);assert.doesNotMatch(rows[0].camera.reason,/remains in the field/);assert.equal(fleetDashboardSummary(filterFleetDashboard(rows,initialFleetFilters)).offline,0);assert.equal(filterFleetDashboard(rows,{...initialFleetFilters,placement:'shop'}).length,1);
});
test('clock reevaluation preserves edit inputs and failed reads cannot leave current status online',()=>{
 const {ctx,nodes}=legacy();ctx.device={id:1,unit_key:'Sniper 308',device_type:'Sniper',activation_state:'active'};ctx.current={checked_at:at,overall_status:'online',ip_reachable:true};ctx.fmt=()=>'';
 ctx.renderStatusEvidence();assert.equal(nodes.get('statusPill').textContent,'IP / PORT ONLINE');const edit=ctx.$('ipSetupInput');edit.value='unsaved technician edit';
 ctx.Date.now=()=>now+21*60000;ctx.renderStatusEvidence();assert.equal(nodes.get('statusPill').textContent,'IP / PORT UNVERIFIED');assert.equal(edit.value,'unsaved technician edit');
 ctx.Date.now=()=>now;ctx.detailReadFailures=['service'];ctx.renderStatusEvidence();assert.equal(nodes.get('statusPill').textContent,'IP / PORT UNVERIFIED');assert.match(nodes.get('issueNotice').textContent,/Saved read unavailable: service/);
});
test('a failed service read preserves separately verified provider evidence',()=>{
 const {ctx}=legacy();ctx.device={id:1,device_type:'IPC',source:'vigilant_control_center',activation_state:'active',source_status:'online',source_last_seen_at:at};ctx.current={checked_at:at,overall_status:'online',ip_reachable:true};
 ctx.detailReadFailures=['service'];const observed=ctx.detailObservation();assert.equal(observed.providerState,'online');assert.equal(observed.serviceState,'verifying');assert.equal(observed.label,'CAMERA RECORD ONLINE');assert.match(observed.video,/not verified/);
 ctx.detailReadFailures=['inventory'];assert.equal(ctx.detailObservation().state,'verifying');
});
