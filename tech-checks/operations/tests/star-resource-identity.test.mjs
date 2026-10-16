import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {resolveStarResources,starResourceStatus} from '../../supabase/functions/camera-provider-reconcile/star-resource-identity.js';
import {unmappedResourceDiagnostics} from '../../supabase/functions/camera-provider-reconcile/unmapped-resource-diagnostics.js';
import * as inventoryPresentationRules from '../../supabase/functions/cos-operations-pages/inventoryPresentationRules.ts';

const historical='2026-10-10T12:00:00.000Z';
const local=(patch={})=>({id:901,device_serial:'synthetic-physical-alpha',external_device_id:'synthetic-external-beta',device_name:'Helios901 synthetic camera 3+4',device_type:'IPC',monitoring_profile:'helios',unit_key:'Helios901',activation_state:'active',organization:'Synthetic site',source:'vigilant_control_center',source_status:'online',source_last_seen_at:historical,last_online_at:historical,public_ip:'192.0.2.55',connection_revision:7,...patch});
const resource=(serial,status,patch={})=>({deviceSerial:serial,deviceName:'Helios901 synthetic camera 3+4',status,publicIp:'192.0.2.77',...patch});
const tracker={canonical_family:'Helios',unit_tag:'901',source_label:'Helios901',tracker_state:'field_or_unknown'};
const alpha=status=>resource('synthetic-physical-alpha',status);
const beta=status=>resource('synthetic-external-beta',status);
function compile(source,context){const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(js,context);return context;}
async function producer(resources,locals=[local()],options={}){
 const full=readFileSync(new URL('../../supabase/functions/camera-provider-reconcile/index.ts',import.meta.url),'utf8');
 const source=full.slice(full.indexOf('async function mapLimit'),full.indexOf('async function reconInventory'));
 const rows=structuredClone(locals),writes=[],integration=[],selections=[];
 const db={from(table){return {
  select(columns){selections.push({table,columns});return this},eq(){return this},in(){return this},
  maybeSingle(){return {data:{metadata:{existing:'preserved'}}}},
  then(resolve){resolve({data:table==='camera_devices'?rows:(options.trackers||[])})},
  update(patch){return {eq:async(column,id)=>{const clean=JSON.parse(JSON.stringify(patch));writes.push({table,id,patch:clean});Object.assign(rows.find(row=>row.id===id),clean);return {error:null}}}},
  upsert:async(patch)=>{integration.push(patch);return {error:null}}
 }}};
 const context=compile(source,{
  Deno:{env:{get:()=> 'synthetic-only'}},md5:async()=> 'synthetic-only',loginPassword:async()=> 'synthetic-only',navigator:{userAgent:'synthetic-test',platform:'synthetic-test'},
  post:async(url,body)=>{
   if(options.failAuth)throw new Error('Synthetic authentication rejected');
   if(url.endsWith('getbyloginname'))return {data:{serverHost:'example.invalid'}};
   if(url.endsWith('/get'))return {data:{token:'synthetic-only'}};
   if(options.failInventory)throw new Error('Synthetic inventory unavailable');
   const list=options.inventory?options.inventory(body):resources;
   return {data:{resourceList:list,total:list.length}};
  },unmappedResourceDiagnostics,resolveStarResources,starResourceStatus
 });
 try{return {rows,writes,integration,selections,result:await context.starInventory(db)}}catch(error){return {rows,writes,integration,selections,error}};
}

test('distinct provider aliases quarantine exactly once in either order without advancing success or changing identity/IP',async()=>{
 const snapshots=[];
 for(const list of [[alpha(1),beta(0)],[beta(0),alpha(1)]]){
  const r=await producer(list);assert.ifError(r.error);assert.equal(r.writes.length,1);assert.equal(r.rows[0].source_status,'unknown');assert.equal(r.rows[0].vigilant_status,'Unknown');assert.equal(r.rows[0].last_online_at,historical);
  for(const key of ['device_serial','external_device_id','device_name','public_ip','connection_revision'])assert.equal(r.rows[0][key],local()[key]);
  assert.equal(r.result.identity_conflicts.length,1);assert.equal(r.result.matched,1);assert.equal(r.result.unknown,1);assert.equal(r.result.by_profile.helios.unknown,1);assert.equal(r.result.by_profile.helios.identity_conflicts,1);assert.equal(r.integration[0].last_sync_status,'ok');
  assert.ok(r.writes.every(row=>row.table==='camera_devices'));snapshots.push(r.rows[0].source_metadata.conflictingResources);
 }
 assert.deepEqual(snapshots[0],snapshots[1]);
});
test('a legitimate distinct external identifier remains a supported single durable match',async()=>{
 const r=await producer([beta(1)]);assert.ifError(r.error);assert.equal(r.rows[0].source_status,'online');assert.equal(r.rows[0].device_serial,local().device_serial);assert.equal(r.rows[0].external_device_id,local().external_device_id);assert.equal(r.rows[0].source_metadata.matchedBy,'external_device_id');
});
test('prior durable collision survives partial single-alias responses and preserves missing candidate diagnostics',async()=>{
 const first=await producer([alpha(1),beta(0)]);assert.ifError(first.error);
 for(const list of [[alpha(1)],[beta(1)]]){
  const second=await producer(list,first.rows);assert.ifError(second.error);assert.equal(second.rows[0].source_status,'unknown');assert.equal(second.rows[0].last_online_at,historical);assert.equal(second.result.identity_conflicts.length,1);
  const serials=new Set(second.rows[0].source_metadata.conflictingResources.map(row=>row.serial));assert.ok(serials.has(local().device_serial));assert.ok(serials.has(local().external_device_id));
  const third=await producer(list,second.rows);assert.ifError(third.error);assert.equal(third.rows[0].source_status,'unknown');
 }
 const corrected={...first.rows[0],external_device_id:local().device_serial};
 const released=await producer([alpha(1)],[corrected]);assert.ifError(released.error);assert.equal(released.rows[0].source_status,'online');assert.equal(released.result.identity_conflicts.length,0);
});
test('same-resource status disagreement is recoverable without changing durable identity',async()=>{
 const first=await producer([],undefined,{trackers:[tracker],inventory:body=>[alpha(body.deviceName?1:0)]});assert.ifError(first.error);assert.equal(first.rows[0].source_status,'unknown');
 const second=await producer([alpha(1)],first.rows);assert.ifError(second.error);assert.equal(second.rows[0].source_status,'online');assert.equal(second.result.identity_conflicts.length,0);
});
test('physical serial ownership wins over unrelated duplicate display names',async()=>{
 const r=await producer([alpha(1)],[local(),local({id:902,device_serial:'synthetic-physical-other',external_device_id:'synthetic-external-other'})]);
 assert.ifError(r.error);assert.equal(r.writes.length,1);assert.equal(r.writes[0].id,901);assert.equal(r.rows[1].source_last_seen_at,historical);assert.equal(r.rows[0].source_metadata.matchedBy,'device_serial');
});
test('name-only resource never overwrites durable identities, even when the local name is duplicated',async()=>{
 const r=await producer([resource('synthetic-unrelated',0)],[local(),local({id:902,device_serial:'synthetic-physical-other',external_device_id:'synthetic-external-other'})]);
 assert.ifError(r.error);assert.equal(r.writes.length,0);assert.equal(r.result.unmatched,1);assert.ok(r.rows.every(row=>row.source_last_seen_at===historical));
});
for(const [name,other,observed] of [
 ['physical serial',local({id:902,external_device_id:'synthetic-other'}),alpha(1)],
 ['external ID',local({id:902,device_serial:'synthetic-other'}),beta(1)],
 ['database ID',local({device_serial:'synthetic-other',external_device_id:'synthetic-other'}),alpha(1)],
 ['cross-namespace owner',local({id:902,device_serial:'synthetic-other',external_device_id:local().device_serial}),alpha(1)]
])test('duplicate '+name+' ownership cannot become a last-row-wins observation',async()=>{
 const r=await producer([observed],[local(),other]);assert.ifError(r.error);assert.ok(r.writes.length);assert.ok(r.writes.every(row=>row.patch.source_status==='unknown'));assert.equal(r.result.matched,r.writes.length);assert.equal(r.result.unknown,r.writes.length);
});
test('missing/null/boolean/unrecognized provider statuses never become offline or advance success history',async()=>{
 for(const status of [undefined,null,'',false,true,NaN,2,'2','offline',{},[]]){
  const r=await producer([alpha(status)]);assert.ifError(r.error);assert.equal(r.rows[0].source_status,'unknown');assert.equal(r.rows[0].last_online_at,historical);assert.equal(r.result.offline,0);assert.equal(r.result.unknown,1);
 }
});
test('only explicit numeric/string zero and one retain definitive provider status',async()=>{
 for(const status of [0,'0',1,'1']){const r=await producer([alpha(status)]);assert.ifError(r.error);assert.equal(r.rows[0].source_status,Number(status)?'online':'offline');if(!Number(status))assert.equal(r.rows[0].last_online_at,historical);}
});
test('consistent duplicate tracker/account observations produce one local write',async()=>{
 const r=await producer([alpha(1)],undefined,{trackers:[tracker]});assert.ifError(r.error);assert.equal(r.writes.length,1);assert.equal(r.result.matched,1);
});
test('contradictory tracker/account observations for one owned serial remain unknown',async()=>{
 const r=await producer([],undefined,{trackers:[tracker],inventory:body=>[alpha(body.deviceName?1:0)]});assert.ifError(r.error);assert.equal(r.writes.length,1);assert.equal(r.rows[0].source_status,'unknown');assert.equal(r.rows[0].last_online_at,historical);
});
test('tracker summaries include unknown/conflicting components instead of certifying a whole unit online or offline',async()=>{
 for(const status of [0,1]){
  const second=local({id:902,device_serial:'synthetic-physical-other',external_device_id:'synthetic-physical-other'});
  const r=await producer([alpha(1),beta(0),resource(second.device_serial,status)],[local(),second],{trackers:[tracker]});assert.ifError(r.error);
  const coverage=r.result.tracker_live_coverage.Helios;assert.equal(coverage.field_online_units,0);assert.equal(coverage.field_offline_units,0);assert.equal(coverage.field_degraded_units,1);assert.equal(r.result.by_profile.helios.matched,2);assert.equal(r.result.by_profile.helios.unknown,1);
 }
 for(const list of [[alpha(1),beta(0)],[alpha(null)]]){
  const r=await producer(list,undefined,{trackers:[tracker]});assert.ifError(r.error);const coverage=r.result.tracker_live_coverage.Helios;
  assert.equal(coverage.field_online_units,0);assert.equal(coverage.field_offline_units,0);assert.equal(coverage.field_unverified_units,1);assert.equal(coverage.unverified_field_units[0],'Helios901');
 }
});
test('conflict diagnostics preserve bounded allowlisted identity context without arbitrary fields',async()=>{
 const r=await producer([resource(local().device_serial,1,{publicIp:'192.0.2.55',deviceModel:'Synthetic model',organizationId:'synthetic-organization',latestOnline:123,token:'never-copy',password:'never-copy'}),resource(local().external_device_id,0,{publicIp:'192.0.2.77',deviceModel:'x'.repeat(300)})]);assert.ifError(r.error);
 const candidates=r.rows[0].source_metadata.conflictingResources;assert.deepEqual(new Set(candidates.map(row=>row.publicIp)),new Set(['192.0.2.55','192.0.2.77']));assert.ok(candidates.every(row=>!row.model||row.model.length<=120));assert.doesNotMatch(JSON.stringify(candidates),/never-copy|password|token/);assert.equal(candidates.find(row=>row.serial===local().device_serial).latestOnline,'123');
});
test('authentication and inventory failures preserve the last valid observations',async()=>{
 for(const key of ['failAuth','failInventory']){const r=await producer([],undefined,{[key]:true,trackers:[tracker]});assert.ok(r.error);assert.equal(r.writes.length,0);assert.deepEqual(r.rows,[local()]);}
});
test('quarantine stays unverified in detail, board, native frontend and backend despite old online health',()=>{
 const read=path=>readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
 const device=local({source_status:'unknown',vigilant_status:'Unknown',source_last_seen_at:new Date().toISOString(),source_metadata:{identityStatus:'conflict'}}),health={overall_status:'online',ip_reachable:true,checked_at:new Date().toISOString()};
 const context=vm.createContext({Intl,device,cameraGroup:()=> 'Vigilant'});vm.runInContext(read('tech-checks/camera-health-history.js'),context);vm.runInContext(read('tech-checks/camera-health-overview.js'),context);
 assert.equal(context.CameraHealthOverview.cameraState(device),'verifying');assert.equal(context.CameraHealthOverview.providerState(device),'verifying');
 const detail=read('tech-checks/camera-detail.html');vm.runInContext(detail.match(/^function sourceFresh\(.*$/m)[0]+'\n'+detail.match(/^function effectiveHealth\(.*$/m)[0],context);assert.equal(context.effectiveHealth(device,health),'verifying');
 for(const path of ['tech-checks/operations/src/cameraEvidence.ts','tech-checks/supabase/functions/cos-operations-pages/cameraEvidence.ts']){
  const api=compile(read(path),{exports:{},require:name=>{assert.equal(name,'./inventoryPresentationRules.ts');return inventoryPresentationRules;}}).exports;const row={id:device.id,activationState:'active',type:'IPC',evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:device.source_status,observedAt:device.source_last_seen_at}};
  assert.equal(api.cameraState(row),'verifying');assert.equal(api.providerState(row),'verifying');
 }
});
test('both producers load identical resolver bytes, retain prior-conflict metadata reads and have CI path coverage',()=>{
 const names=['camera-provider-reconcile','vigilant-sync'];const helpers=names.map(name=>readFileSync(new URL('../../supabase/functions/'+name+'/star-resource-identity.js',import.meta.url),'utf8'));assert.equal(helpers[0],helpers[1]);
 for(const name of names){const source=readFileSync(new URL('../../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8');assert.match(source,/import \{[^}]*resolveStarResources[^}]*\} from "\.\/star-resource-identity\.js"/);assert.match(source,/\.select\("id,device_name,device_serial,external_device_id,[^"]*source_metadata"\)/);}
 const ci=readFileSync(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');for(const name of names)assert.equal(ci.split("'tech-checks/supabase/functions/"+name+"/**'").length-1,2);
});
export {producer,resource,local};

test('contradictory unmapped serials remain unverified regardless of account/tracker response order',async()=>{
 const trackers=[{canonical_family:'Helios',unit_tag:'901',source_label:'Synthetic Helios901',tracker_state:'field_or_unknown'}];
 for(const firstStatus of [0,1]){
  const r=await producer([],[],{trackers,inventory:body=>[resource('synthetic-unmapped',body.deviceName?firstStatus:1-firstStatus)]});
  assert.ifError(r.error);assert.equal(r.writes.length,0);assert.equal(r.result.unmatched,1);
  assert.equal(r.result.unmatched_resources[0].status,'unknown');
  // Diagnostic source values are verbatim, not rewritten to fabricate provider uncertainty.
  assert.equal(r.result.unmatched_resources[0].provider_resource.status,firstStatus);
  assert.equal(r.result.tracker_live_coverage.Helios.field_online_units,0);
  assert.equal(r.result.tracker_live_coverage.Helios.field_offline_units,0);
  assert.equal(r.result.tracker_live_coverage.Helios.field_unverified_units,1);
  for(const result of [r.result,r.integration[0].metadata]){
   assert.equal(result.account_online,0);assert.equal(result.account_offline,0);assert.equal(result.account_unknown,1);
  }
 }
});
test('account totals resolve contradictory matched observations without conflating distinct alias resources',async()=>{
 const trackers=[{canonical_family:'Helios',unit_tag:'901',source_label:'Synthetic Helios901',tracker_state:'field_or_unknown'}];
 for(const firstStatus of [0,1]){
  const r=await producer([],undefined,{trackers,inventory:body=>[resource('synthetic-physical-alpha',body.deviceName?firstStatus:1-firstStatus)]});
  assert.ifError(r.error);assert.equal(r.rows[0].source_status,'unknown');
  for(const result of [r.result,r.integration[0].metadata]){
   assert.equal(result.account_online,0);assert.equal(result.account_offline,0);assert.equal(result.account_unknown,1);
  }
 }
 const aliases=await producer([resource('synthetic-physical-alpha',1),resource('synthetic-external-beta',0)]);
 assert.ifError(aliases.error);assert.equal(aliases.rows[0].source_status,'unknown');
 assert.equal(aliases.result.account_online,1);assert.equal(aliases.result.account_offline,1);assert.equal(aliases.result.account_unknown,0);
});
test('resolved status metadata preserves raw resources and repeated consistent or unknown observations',()=>{
 for(const [values,expected] of [[[1,1],'online'],[[0,'0'],'offline'],[[null,null],'unknown'],[[1,null],'unknown'],[[1,0],'unknown']]){
  const records=values.map(status=>resource('  SYNTHETIC-UNMAPPED  ',status));
  const before=structuredClone(records),result=resolveStarResources(records,[]);
  assert.deepEqual(result.resourceStatuses,[{serial:'synthetic-unmapped',status:expected}]);
  assert.equal(result.unmatched[0],records[0]);assert.deepEqual(records,before);
 }
});
