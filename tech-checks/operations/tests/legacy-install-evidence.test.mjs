import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {HELIOS_FIELD_CHECKS,projectLegacyInstallRecord,createLegacyInstallEvidenceReader,legacyEvidenceTransport} from '../../supabase/functions/cos-operations-pages/legacyInstallEvidence.ts';
import {checkedLegacyInstallEvidence} from '../src/legacyInstallEvidenceData.ts';
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now='2026-10-10T12:00:00.000Z', completed='2026-10-09T12:00:00.000Z';
function fixture(){return {
  prep:{id:uuid(1),ticket_no:'900101',site:'Synthetic Field Site',status:'released',created_at:'2026-10-08T12:00:00.000Z',released_at:'2026-10-08T16:00:00.000Z',closed_at:null,is_test:false,work_type:'delivery'},
  items:[{id:uuid(2),prep_ticket_id:uuid(1),equipment_type:'Helios',unit_tag:'HEL-001',purpose:'DELIVERY',verified_at:'2026-10-08T15:00:00.000Z',power_ok:true,functions_ok:true,safe_ok:true,service_unit_confirmed:true,service_verified_at:'2026-10-08T17:00:00.000Z',swap_outcome:null,spare_outcome:null}],
  solar:[{id:uuid(3),prep_ticket_id:uuid(1),handoff_accepted_at:'2026-10-08T17:00:00.000Z',helios_field_completed_at:completed,helios_owner_verified_at:null,...Object.fromEntries(HELIOS_FIELD_CHECKS.map(([key])=>[key,true]))}],
  handoff:[{id:uuid(4),prep_ticket_id:uuid(1),stage:'it',kind:'photo',created_at:'2026-10-08T15:00:00.000Z'},{id:uuid(5),prep_ticket_id:uuid(1),stage:'service',kind:'signature',created_at:'2026-10-08T17:00:00.000Z'}],
  field:[{id:uuid(6),prep_ticket_id:uuid(1),category:'helios_install',kind:'photo',created_at:'2026-10-09T11:00:00.000Z'},{id:uuid(7),prep_ticket_id:uuid(1),category:'helios_install',kind:'signature',created_at:'2026-10-09T11:30:00.000Z'}],
  summary:{found:true,ticket_no:'900101',ready_for_owner_review:false,review_status:'not_ready',counts:{active_assignments:1,open_returns:0,open_offline_unit_escalations:0,pending_swap_outcomes:0,missing_required_swap_returns:0,pending_swap_site_registrations:0}},newerPrep:false,
};}
const project=f=>projectLegacyInstallRecord(f,now);
const snapshot=row=>({contract:'cos.legacy-install-evidence.v1',readOnly:true,generatedAt:now,windowStart:'2026-09-10T12:00:00.000Z',limit:10,hasMore:false,items:[row]});
test('explicit Helios Service submission uses saved 13 checks, photos, signature and exact prepared identities',()=>{
  const result=project(fixture());assert.equal(result.fieldCompletedAt,completed);assert.equal(result.units[0].disposition,'installation_recorded');assert.equal(result.heliosChecks.length,13);assert.equal(result.fieldMapStatus,'pending_exact_link');assert.equal(result.readyForOwnerReview,false);checkedLegacyInstallEvidence(snapshot(result),Date.parse(now));
});
test('all legacy equipment families retain evidence but generic handoff cannot assert field installation',()=>{
  for(const family of ['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2','110V Stand','Solar Stand','Solar Pole','Pole']){
    const f=fixture();f.items[0].equipment_type=family;f.prep.status='closed';f.prep.closed_at=completed;f.solar=[];f.field=[];
    const result=project(f);assert.equal(result.units[0].family,family);assert.equal(result.units[0].disposition,'handoff_only');assert.equal(result.fieldCompletedAt,null);assert.equal(result.recordedAt,completed);
  }
});
for(const scenario of ['missing check','missing signature','missing photo','missing handoff','future completion','signature after completion','unresolved swap'])test('Helios fails closed for '+scenario,()=>{
  const f=fixture();
  if(scenario==='missing check')delete f.solar[0][HELIOS_FIELD_CHECKS[0][0]];
  if(scenario==='missing signature')f.field=f.field.filter(row=>row.kind!=='signature');
  if(scenario==='missing photo')f.field=f.field.filter(row=>row.kind!=='photo');
  if(scenario==='missing handoff')f.solar[0].handoff_accepted_at=null;
  if(scenario==='future completion')f.solar[0].helios_field_completed_at='2027-01-01T00:00:00Z';
  if(scenario==='signature after completion')f.field[1].created_at='2026-10-09T13:00:00Z';
  if(scenario==='unresolved swap')f.items.push({...f.items[0],id:uuid(8),unit_tag:'HEL-002',purpose:'SWAP'});
  const result=project(f);assert.equal(result.fieldCompletedAt,null);assert.notEqual(result.units[0].disposition,'installation_recorded');assert.match(result.blockers.join(' '),/incomplete or inconsistent/);
});
test('installed versus unused SWAP counts do not copy the outdated Owner verifier',()=>{
  const f=fixture();f.items[0].purpose='SWAP';f.items[0].swap_outcome='installed';f.items.push({...f.items[0],id:uuid(8),unit_tag:'HEL-002',swap_outcome:'returned_unused'});
  const result=project(f);assert.equal(result.fieldCompletedAt,completed);assert.equal(result.units[0].disposition,'installation_recorded');assert.equal(result.units[1].disposition,'unused_replacement');
});
test('truck spares including used spares never inherit prep-level Helios installation proof',()=>{
  const f=fixture();for(const [index,outcome] of [null,'used','returned_unused'].entries())f.items.push({...f.items[0],id:uuid(10+index),unit_tag:'HEL-00'+(index+2),purpose:'BACKUP',spare_outcome:outcome});
  const result=project(f);assert.ok(result.units.slice(1).every(row=>row.disposition==='truck_spare'));
});
test('explicit non-Helios installed swap is shown separately from full field submission',()=>{
  const f=fixture();f.items[0].equipment_type='Sniper';f.items[0].purpose='SWAP';f.items[0].swap_outcome='installed';f.solar=[];f.field=[];
  const result=project(f);assert.equal(result.units[0].disposition,'swap_installation_recorded');assert.equal(result.fieldCompletedAt,null);
});
test('Ranger Victron step alone is not install completion',()=>{
  const f=fixture();Object.assign(f.items[0],{equipment_type:'Ranger',ranger_field_victron_updated_ok:true,ranger_field_victron_updated_at:completed});f.solar=[];
  const result=project(f);assert.equal(result.units[0].rangerFieldUpdateAt,completed);assert.equal(result.units[0].disposition,'handoff_only');
});
test('duplicate same-family identities are flagged; equal numbers in distinct families never match',()=>{
  const f=fixture();f.items.push({...f.items[0],id:uuid(8)});let result=project(f);assert.ok(result.units.every(row=>row.disposition==='review_needed'));assert.match(result.blockers.join(' '),/Duplicate/);
  f.items[1].equipment_type='Sniper';result=project(f);assert.equal(result.units[0].disposition,'installation_recorded');assert.equal(result.units[1].disposition,'handoff_only');assert.ok(result.units.every(row=>!('nativeUnitId' in row)));
});
test('newer prep, correction, open return and escalation stay visible as blocking current work',()=>{
  const f=fixture();f.newerPrep=true;Object.assign(f.summary,{review_status:'correction_requested',ready_for_owner_review:true});Object.assign(f.summary.counts,{open_returns:1,open_offline_unit_escalations:1,pending_swap_site_registrations:1});
  const result=project(f);assert.equal(result.historical,true);assert.equal(result.readyForOwnerReview,false);assert.match(result.blockers.join(' '),/newer preparation.*corrections.*returns.*escalations.*site registration/);
});
test('minimum DTO drops names, contact notes, raw payloads, storage paths and hostile labels',()=>{
  const f=fixture();f.prep.site='https://evil.example/?token=secret';Object.assign(f.items[0],{notes:'private@example.test',storage_path:'private/path',url:'data:image/png;base64,secret',unit_tag:'Bearer secret'});f.summary.correction_reason='Sensitive contact instructions';f.field[0].url='javascript:alert(1)';
  const result=project(f),json=JSON.stringify(result);assert.equal(result.siteLabel,'Site needs review');assert.equal(result.units[0].disposition,'review_needed');for(const secret of ['private@','storage_path','data:image','Sensitive contact','javascript:','Bearer'])assert.ok(!json.includes(secret));
});
test('missing site stays pending and no map geometry/native identities or operational actions are fabricated',()=>{
  const f=fixture();f.prep.site=null;const result=project(f);assert.equal(result.siteLabel,'Site needs review');assert.equal(result.fieldMapStatus,'pending_exact_link');for(const key of ['latitude','longitude','equipmentUnitId','nativeSiteId','billingReady'])assert.ok(!(key in result));
  const source=readFileSync(new URL('../../supabase/functions/cos-operations-pages/legacyInstallEvidence.ts',import.meta.url),'utf8');assert.ok(!source.includes("method:'PATCH'"));assert.ok(!source.includes('platformHeaders'));assert.ok(!source.includes('save_my_'));assert.ok(!source.includes('owner_verify_'));
});
test('cross-prep, sparse and duplicate source rows fail closed',()=>{
  for(const mutate of [f=>f.items[0].prep_ticket_id=uuid(99),f=>f.items=new Array(2),f=>f.items.push({...f.items[0]}),f=>f.summary.counts.open_returns=-1]){const f=fixture();mutate(f);assert.throws(()=>project(f));}
});
test('future photos, handoff, Owner verification and Ranger markers cannot prove installation',()=>{
  for(const mutate of [f=>f.solar[0].handoff_accepted_at='2099-01-01T00:00:00Z',f=>f.field[0].created_at='2099-01-01T00:00:00Z']){const f=fixture();mutate(f);assert.equal(project(f).fieldCompletedAt,null);}
  const f=fixture();f.solar[0].helios_owner_verified_at='2099-01-01T00:00:00Z';let result=project(f);assert.equal(result.ownerVerifiedAt,null);assert.match(result.blockers.join(' '),/timestamp needs review/);
  f.solar[0].helios_owner_verified_at='2026-10-08T00:00:00Z';assert.equal(project(f).ownerVerifiedAt,null);
  Object.assign(f.items[0],{equipment_type:'Ranger',ranger_field_victron_updated_ok:true,ranger_field_victron_updated_at:'2099-01-01T00:00:00Z'});assert.equal(project(f).units[0].rangerFieldUpdateAt,null);
});
test('contradictory readiness and completion DTOs are rejected',()=>{
  const f=fixture();f.summary.ready_for_owner_review=true;assert.equal(project(f).readyForOwnerReview,false);
  for(const mutate of [s=>s.items[0].fieldCompletedAt=null,s=>s.items[0].heliosChecks=[],s=>s.items[0].evidence[2].photos=0,s=>s.items[0].readyForOwnerReview=true,s=>s.items[0].units[0].unitTag='',s=>{s.generatedAt='2099-10-10T12:00:00Z';s.windowStart='2099-09-10T12:00:00Z';}]){const s=snapshot(project(fixture()));mutate(s);assert.throws(()=>checkedLegacyInstallEvidence(s,Date.parse(now)));}
});
test('browser DTO rejects sparse collections, unapproved keys, writes and identity drift',()=>{
  for(const mutate of [s=>s.items=new Array(1),s=>s.readOnly=false,s=>s.items[0].url='https://evil.example',s=>s.items[0].units=new Array(1),s=>s.items[0].fieldMapStatus='installed',s=>s.items[0].evidence.push(s.items[0].evidence[0]),s=>s.items.push(s.items[0])]){const s=snapshot(project(fixture()));mutate(s);assert.throws(()=>checkedLegacyInstallEvidence(s,Date.parse(now)));}
});
function readerFixture(f=fixture()){
  const calls=[];
  const read=async(path,body)=>{
    calls.push({path,body});
    if(path.startsWith('prep_tickets?')&&path.includes('closed_at=gte'))return f.prep.status==='closed'?[f.prep]:[];
    if(path.startsWith('service_solar_checks?')&&path.includes('helios_field_completed_at=gte'))return f.solar.map(row=>({prep_ticket_id:row.prep_ticket_id,helios_field_completed_at:row.helios_field_completed_at}));
    if(path.startsWith('prep_tickets?')&&path.includes('&id=in.'))return [f.prep];
    if(path.startsWith('prep_tickets?'))return [{id:f.prep.id,ticket_no:f.prep.ticket_no,created_at:f.prep.created_at}];
    if(path.startsWith('prep_items?'))return f.items;
    if(path.startsWith('service_solar_checks?'))return f.solar;
    if(path.startsWith('handoff_evidence?'))return f.handoff;
    if(path.startsWith('service_solar_evidence?'))return f.field;
    if(path==='rpc/owner_job_closeout_summary_v1')return f.summary;
    throw Error('Unexpected fixture route '+path);
  };return {read,calls};
}
test('reader has an explicit 30-day/10-record limit, narrow field selections, and only stable read RPC',async()=>{
  const {read,calls}=readerFixture();const result=await createLegacyInstallEvidenceReader(read,()=>new Date(now))();checkedLegacyInstallEvidence(result,Date.parse(now));assert.equal(result.items.length,1);assert.equal(result.limit,10);assert.equal(result.hasMore,false);assert.match(calls[0].path,/closed_at=gte.2026-09-10/);
  for(const call of calls){if(call.body)assert.equal(call.path,'rpc/owner_job_closeout_summary_v1');else assert.match(call.path,/limit=\d+/);assert.ok(!call.path.includes('select=*'));assert.ok(!/storage_path|original_name|notes|by_name/.test(call.path));}
});
test('empty, truncated, reopened and oversized sources are distinct',async()=>{
  const empty=await createLegacyInstallEvidenceReader(async()=>[],()=>new Date(now))();assert.deepEqual(empty.items,[]);assert.equal(empty.hasMore,false);
  const f=fixture();f.prep.status='draft';const {read}=readerFixture(f);const reopened=await createLegacyInstallEvidenceReader(read,()=>new Date(now))();assert.deepEqual(reopened.items,[]);
  await assert.rejects(()=>createLegacyInstallEvidenceReader(async()=>new Array(12).fill({}),()=>new Date(now))());
  const base=readerFixture();const many=await createLegacyInstallEvidenceReader(async(path,body)=>path.startsWith('service_solar_checks?')&&path.includes('helios_field_completed_at=gte')?Array.from({length:11},(_,i)=>({prep_ticket_id:uuid(i+1),helios_field_completed_at:completed})):path.startsWith('prep_tickets?')&&path.includes('&id=in.')?Array.from({length:11},(_,i)=>({...fixture().prep,id:uuid(i+1),is_test:i!==0})):base.read(path,body),()=>new Date(now))();assert.equal(many.hasMore,true);
});
test('trimmed ticket aliases detect newer preparation; missing candidate/latest status fails closed',async()=>{
  const base=readerFixture();const read=(later)=>async(path,body)=>path.includes('ticket_no=like.')?later:base.read(path,body);
  const current={id:uuid(1),ticket_no:'900101',created_at:'2026-10-08T12:00:00.000Z'};
  const result=await createLegacyInstallEvidenceReader(read([current,{id:uuid(99),ticket_no:' 900101 ',created_at:completed}]),()=>new Date(now))();assert.equal(result.items[0].historical,true);assert.equal(result.items[0].readyForOwnerReview,false);
  await assert.rejects(()=>createLegacyInstallEvidenceReader(read([]),()=>new Date(now))());
  const unrelated=await createLegacyInstallEvidenceReader(read([current,{id:uuid(99),ticket_no:'19001010',created_at:completed}]),()=>new Date(now))();assert.equal(unrelated.items[0].historical,false);
});
test('transport forwards only caller token and bounds bytes, redirects, aborts and error disclosure',async()=>{
  let observed;
  const read=legacyEvidenceTransport(async(url,init)=>{observed={url,init};return new Response('[]');},'https://legacy.example',{Authorization:'Bearer caller',apikey:'public'});
  assert.deepEqual(await read('prep_tickets?select=id&limit=1'),[]);assert.equal(observed.init.headers.Authorization,'Bearer caller');assert.equal(observed.init.cache,'no-store');assert.equal(observed.init.redirect,'error');assert.equal(observed.init.method,'GET');
  for(const response of [new Response('private server payload',{status:403}),new Response(' '.repeat(262145)),new Response('{"secret":"raw"}',{status:500})]){const r=legacyEvidenceTransport(async()=>response,'https://legacy.example',{});await assert.rejects(r('prep_tickets?select=id&limit=1'),error=>!error.message.includes('private')&&!error.message.includes('raw'));}
  const abort=new AbortController();const hanging=legacyEvidenceTransport(()=>new Promise(()=>{}),'https://legacy.example',{},abort.signal);const pending=hanging('prep_tickets?select=id&limit=1');abort.abort();await assert.rejects(pending);
});
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
function request(path='/api/owner-review/legacy-evidence',method='GET',body={}){return new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json'},body:JSON.stringify({path,method,body})});}
function transport(scenario={}){const calls=[];return {calls,fetch:async(url,init={})=>{
  calls.push({url,init});const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(url.includes('/auth/v1/user'))return json({id:scenario.unmapped?uuid(99):owner});
  if(url.includes('/profiles?'))return json([{user_id:scenario.unmapped?uuid(99):owner,role:scenario.role||'owner',full_name:'Owner',active:!scenario.inactive,archived_at:null}]);
  if(url.includes('/user_profiles?'))return json([{user_id:actor,active:true,department:'owner'}]);
  if(url.includes('/user_roles?'))return json(scenario.revoked?[]:[{role_id:uuid(88),roles:{code:'owner',organization_id:org}}]);
  if(url.includes('/role_permissions?'))return scenario.permissionDenied?json([]):json([{role_id:uuid(88),permission_code:'job.view_all'}]);
  if(url.includes('/rest/v1/prep_tickets?')||url.includes('/rest/v1/service_solar_checks?'))return json([]);
  throw Error('Unexpected request');
}};}
test('endpoint uses existing linked Owner and review permission before any caller-scoped legacy evidence read',async()=>{
  const mock=transport();const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-service-key',fetch:mock.fetch});const response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).readOnly,true);
  const proof=mock.calls.filter(call=>/rest\/v1\/(prep_tickets|service_solar_checks)/.test(call.url));assert.equal(proof.length,2);assert.ok(proof.every(call=>call.init.headers.Authorization==='Bearer synthetic-owner'&&call.init.method==='GET'));assert.ok(mock.calls.findIndex(call=>call.url.includes('/role_permissions?'))<mock.calls.indexOf(proof[0]));
});
for(const scenario of [{role:'it'},{role:'service'},{inactive:true},{unmapped:true},{revoked:true},{permissionDenied:true}])test('endpoint denies unauthorized evidence '+JSON.stringify(scenario),async()=>{
  const mock=transport(scenario);const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-service-key',fetch:mock.fetch});assert.equal((await handler(request())).status,403);assert.ok(!mock.calls.some(call=>/rest\/v1\/(prep_tickets|service_solar_checks)/.test(call.url)));
});
test('endpoint rejects writes, caller overrides and arbitrary filter paths',async()=>{
  for(const [path,method,body,status] of [['/api/owner-review/legacy-evidence','POST',{},405],['/api/owner-review/legacy-evidence','GET',{actorId:uuid(88)},400],['/api/owner-review/legacy-evidence?ticket=900101','GET',{},404]]){const mock=transport();const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-service-key',fetch:mock.fetch});assert.equal((await handler(request(path,method,body))).status,status);assert.ok(!mock.calls.some(call=>/rest\/v1\/(prep_tickets|service_solar_checks)/.test(call.url)));}
});
