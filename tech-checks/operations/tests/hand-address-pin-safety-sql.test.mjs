import {test, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const ORG = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const OTHER_ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const IT = 'd0757b64-9623-4adc-afff-21cc7853e88a';
const DENIED = '11111111-2222-3333-4444-555555555555';
let db, request = 0;
const nextRequest = () => '0d3a6038-1f3e-4a2e-9d7a-' + String(++request).padStart(12, '0');

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema app_private;`);
  // Stand in for the platform's own identity guard: the Owner and verified IT pass, nobody else does.
  await db.exec(`create function app_private.cos_owner_identity_assert_actor(p_actor uuid,p_org uuid,p_write boolean) returns void
   language plpgsql as $$begin
    if p_actor not in ('${OWNER}','${IT}') or p_org<>'${ORG}' then raise exception 'An active COS Owner or verified IT account is required' using errcode='PT403'; end if;
    if p_write and p_actor<>'${OWNER}' then raise exception 'An active COS Owner account is required' using errcode='PT403'; end if;
   end;$$;`);
  const baseline=(await readFile(new URL('../db/20261112_fleet_unit_status_hand_edits.sql', import.meta.url), 'utf8')).replaceAll("'camera','name'","'camera'");
  // Run once against main and once against the two exact allowlist additions in #396.
  await db.exec(process.env.COS_TEST_MAIN_HAND_WRITER==='1'?baseline:baseline.replaceAll("'public_ip','camera'","'public_ip','camera','name'"));
  await db.exec(await readFile(new URL('../db/20261114175728_hand_address_pin_safety.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));

const payload = (over = {}) => ({unitKey: 'SOLARSPOTTER 029', field: 'site', action: 'set',
  value: 'ERock - Hyperion', providerValue: 'root', actorName: 'James Martin', actorRole: 'owner', reason: 'Moved by hand', ...over});
const as = async (role, text, args = []) => {
  await db.exec('reset role'); await db.exec('set role ' + role);
  try { return (await db.query(text, args)).rows; }
  // A refused statement aborts the transaction, so resetting the role may fail
  // too. The refusal itself is what the test is reading.
  finally { try { await db.exec('reset role'); } catch { /* the caller's savepoint restores it */ } }
};
const edit = async (over = {}, actor = OWNER, id = nextRequest(), org = ORG) =>
  (await as('service_role', 'select public.cos_camera_unit_hand_edit_v1($1,$2,$3,$4) value', [actor, org, id, JSON.stringify(payload(over))]))[0].value;
const state = async (actor = OWNER, org = ORG) =>
  (await as('service_role', 'select public.cos_camera_unit_hand_edit_state_v1($1,$2) value', [actor, org]))[0].value;
// A refusal aborts the surrounding transaction, so each expected failure runs
// inside its own savepoint and the test can carry on afterwards.
let mark = 0;
const refuses = async (run, pattern) => {
  const point = 'expected_refusal_' + (++mark);
  await db.exec('savepoint ' + point);
  try { await run(); } catch (error) {
    await db.exec('rollback to savepoint ' + point);
    assert.match(String(error.message || error), pattern);
    return;
  }
  await db.exec('release savepoint ' + point);
  throw new Error('Expected a refusal matching ' + pattern);
};
const log = async (text = 'select * from cos_fleet_hand_edit_private.unit_status_edit_log') => (await db.query(text)).rows;


const address='22725 Ashley Pines Dr, Spring, TX 77373-3257';
const first=()=>edit({field:'address',value:address,latitude:30.1,longitude:-95.4,matchedAddress:'22726 ASHLEY PINES DR, SPRING, TX',expectedAddressRevision:null});
const pinClear=revision=>({field:'address',action:'clear_pin',value:null,expectedAddressRevision:revision});
test('pin-only clear keeps exact address, original point, history and other fields',async()=>{
 await edit({field:'placement',value:'FIELD'});await edit({field:'site',value:'Original site'});await edit({field:'public_ip',value:'8.8.8.8'});
 const before=await log(),old=await first(),id=nextRequest();
 const done=await edit(pinClear(old.id),IT,id);
 assert.equal(done.value,address);assert.equal(done.latitude,null);assert.equal(done.longitude,null);
 const rows=await log();assert.deepEqual(rows.slice(0,3),before);assert.equal(rows.length,5);
 assert.equal(rows[3].matched_address,'22726 ASHLEY PINES DR, SPRING, TX');
 assert.equal(rows[4].value,address);assert.equal(rows[4].matched_address,null);assert.equal(rows[4].address_request.action,'clear_pin');
 assert.equal(rows[4].actor,IT);assert.equal(rows[4].reason,'Moved by hand');
 assert.equal((await state()).edits.find(r=>r.field==='address').revision,id);
 await refuses(()=>db.exec('delete from cos_fleet_hand_edit_private.unit_status_edit_log'),/append-only/);
});
test('exact stored whitespace survives pin-only clear',async()=>{
 const value=' 22725 Ashley  Pines Dr, Spring, TX 77373-3257 ';
 const old=await edit({field:'address',value,expectedAddressRevision:null});assert.equal((await edit(pinClear(old.id))).value,value);
});
test('stale clear and lookup cannot overwrite a newer address',async()=>{
 const old=await first(),newer=await edit({field:'address',value:'9500 Katy Fwy, Houston, TX 77024',expectedAddressRevision:old.id});
 await refuses(()=>edit(pinClear(old.id)),/saved address changed/);
 await refuses(()=>edit({field:'address',value:address,latitude:30.1,longitude:-95.4,expectedAddressRevision:old.id}),/saved address changed/);
 assert.equal((await state()).edits.find(r=>r.field==='address').revision,newer.id);assert.equal((await log()).length,2);
});
test('duplicate clear is no-op even after newer address; altered requests and actors refused',async()=>{
 const old=await first(),id=nextRequest(),request=pinClear(old.id);await edit(request,OWNER,id);
 await edit({field:'address',value:'9500 Katy Fwy, Houston, TX 77024',expectedAddressRevision:id});
 assert.equal((await edit(request,OWNER,id)).repeat,true);assert.equal((await log()).length,3);
 await refuses(()=>edit({...request,reason:'different'},OWNER,id),/already used/);
 await refuses(()=>edit(request,IT,id),/already used/);await refuses(()=>edit(request,DENIED,id),/Owner or verified IT/);
});
test('duplicate lookup retains first result even if provider later returns a point',async()=>{
 const id=nextRequest(),request={field:'address',value:address,expectedAddressRevision:null};await edit(request,OWNER,id);
 const again=await edit({...request,latitude:30.1,longitude:-95.4,matchedAddress:address},OWNER,id);
 assert.equal(again.repeat,true);assert.equal(again.latitude,null);assert.equal((await log()).length,1);
});
test('address removal is distinct and its revision still prevents stale writes',async()=>{
 const old=await first(),cleared=await edit({field:'address',action:'clear',value:null,expectedAddressRevision:old.id});
 assert.equal((await state()).edits.find(r=>r.field==='address').action,'clear');
 await refuses(()=>edit(pinClear(cleared.id)),/no saved address/);
 await refuses(()=>edit({field:'address',value:address,expectedAddressRevision:null}),/saved address changed/);
 assert.equal((await edit({field:'address',value:address,expectedAddressRevision:cleared.id})).applied,true);
});
test('missing revision, coordinates on clear, unauthorized and anonymous callers fail closed',async()=>{
 const old=await first();await refuses(()=>edit({field:'address',value:address}),/Refresh/);
 await refuses(()=>edit({...pinClear(old.id),latitude:30.1,longitude:-95.4}),/does not take/);
 await refuses(()=>edit(pinClear(old.id),DENIED),/Owner or verified IT/);
 for(const role of ['anon','authenticated'])await refuses(()=>as(role,`select public.cos_camera_unit_hand_edit_v1('${OWNER}','${ORG}','${nextRequest()}','{}'::jsonb)`),/permission denied/);
 assert.equal((await log()).length,1);
});

test('installed non-address behavior survives without adding name support on main',async()=>{
 if(process.env.COS_TEST_MAIN_HAND_WRITER==='1'){await refuses(()=>edit({field:'name',value:'Not enabled'}),/Hand edit is incomplete/);return;}
 assert.equal((await edit({field:'name',value:'Renamed by installed writer'})).applied,true);
 assert.equal((await state()).edits.find(r=>r.field==='name').value,'Renamed by installed writer');
 await refuses(()=>as('service_role',`select cos_fleet_hand_edit_private.unit_status_edit_nonaddress_v1('${OWNER}','${ORG}','${nextRequest()}','{}'::jsonb)`),/permission denied/);
});
