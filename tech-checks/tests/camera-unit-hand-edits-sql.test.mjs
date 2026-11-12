import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const DB = 'cos_he_test';
const sql = (text, db = DB) => execFileSync('su', ['postgres', '-c', `psql -X -q -At -v ON_ERROR_STOP=1 -d ${db} -c ${JSON.stringify(text)}`], {encoding: 'utf8'}).trim();
const fails = (text) => {
  try { sql(text); } catch (error) { return String(error.stderr || error.stdout || error.message); }
  throw new Error('Expected a refusal: ' + text);
};
const edit = (over = {}) => {
  const row = {unit_key: 'SOLARSPOTTER 006', field: 'site', action: 'set', value: 'ERock - Hyperion', provider_value: 'root',
    actor_user_id: '3f073784-96e7-43d8-b9e0-33ab31c3c8b1', actor_name: 'James Martin', actor_role: 'owner', reason: 'Moved to site',
    request_id: 'req-' + Math.random().toString(36).slice(2), ...over};
  const columns = Object.keys(row), values = columns.map(key => row[key] === null ? 'null' : `'${String(row[key]).replace(/'/g, "''")}'`);
  return sql(`insert into public.camera_unit_hand_edits(${columns.join(',')}) values (${values.join(',')}) returning id`);
};

before(() => {
  execFileSync('su', ['postgres', '-c', `psql -X -q -c 'drop database if exists ${DB}' -c 'create database ${DB}'`], {stdio: 'pipe'});
  try { sql('create role service_role; create role anon; create role authenticated;'); } catch { /* roles may already exist */ }
  execFileSync('su', ['postgres', '-c', `psql -X -q -v ON_ERROR_STOP=1 -d ${DB} -f /home/claude/neon-oasis-game/tech-checks/operations/db/20261112_camera_unit_hand_edits.sql`], {stdio: 'pipe'});
});

test('installing twice changes nothing', () => {
  execFileSync('su', ['postgres', '-c', `psql -X -q -v ON_ERROR_STOP=1 -d ${DB} -f /home/claude/neon-oasis-game/tech-checks/operations/db/20261112_camera_unit_hand_edits.sql`], {stdio: 'pipe'});
  assert.equal(sql("select count(*) from information_schema.tables where table_name='camera_unit_hand_edits'"), '1');
});

test('an edit records who made it, against which provider value', () => {
  edit();
  const row = sql("select unit_key||'|'||field||'|'||value||'|'||provider_value||'|'||actor_name||'|'||actor_role from public.camera_unit_hand_edit_current where unit_key='SOLARSPOTTER 006' and field='site'");
  assert.equal(row, 'SOLARSPOTTER 006|site|ERock - Hyperion|root|James Martin|owner');
});

test('the latest edit wins and the earlier one stays on the record', () => {
  edit({value: 'ERock - Hyperion'});
  edit({value: 'Preload Garland', reason: 'Corrected'});
  assert.equal(sql("select value from public.camera_unit_hand_edit_current where unit_key='SOLARSPOTTER 006' and field='site'"), 'Preload Garland');
  assert.ok(Number(sql("select count(*) from public.camera_unit_hand_edits where unit_key='SOLARSPOTTER 006' and field='site'")) >= 2);
});

test('clearing an edit is itself an edit, never a delete', () => {
  edit({unit_key: 'SPOTTER 400', action: 'clear', value: null});
  const row = sql("select action||'|'||coalesce(value,'(none)') from public.camera_unit_hand_edit_current where unit_key='SPOTTER 400' and field='site'");
  assert.equal(row, 'clear|(none)');
});

test('nothing can be updated or deleted, including by the table owner', () => {
  const id = edit({unit_key: 'SPOTTER 401'});
  assert.match(fails(`update public.camera_unit_hand_edits set value='x' where id=${id}`), /append-only/);
  assert.match(fails(`delete from public.camera_unit_hand_edits where id=${id}`), /append-only/);
  assert.equal(sql(`select value from public.camera_unit_hand_edits where id=${id}`), 'ERock - Hyperion');
});

test('a repeated request id cannot record the same edit twice', () => {
  const request = 'req-fixed-0001';
  edit({unit_key: 'SPOTTER 402', request_id: request});
  assert.match(fails(`insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 402','site','set','Another','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','James Martin','owner','${request}')`), /camera_unit_hand_edits_request_unique|duplicate key/);
});

test('only the three editable fields and the two placements are accepted', () => {
  for (const field of ['vigilant_status', 'unit_key', 'organization', '']) {
    assert.match(fails(`insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 403','${field}','set','x','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','J','owner','r-${field || 'blank'}')`), /camera_unit_hand_edits_field_check|violates check/);
  }
  assert.match(fails(`insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 404','placement','set','ROOT','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','J','owner','r-root')`), /placement_value|violates check/);
  edit({unit_key: 'SPOTTER 405', field: 'placement', value: 'SHOP'});
  edit({unit_key: 'SPOTTER 406', field: 'placement', value: 'FIELD'});
});

test('a set needs a value and a clear must not carry one', () => {
  assert.match(fails("insert into public.camera_unit_hand_edits(unit_key,field,action,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 407','site','set','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','J','owner','r-noval')"), /value_present|violates check/);
  assert.match(fails("insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 408','site','clear','x','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','J','owner','r-clearval')"), /value_present|violates check/);
});

test('an empty unit name, an empty actor name and an unknown role are refused', () => {
  assert.match(fails("insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('   ','site','set','x','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','J','owner','r-blankunit')"), /unit_key_check|violates check/);
  assert.match(fails("insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 409','site','set','x','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','  ','owner','r-blankactor')"), /actor_name_check|violates check/);
  assert.match(fails("insert into public.camera_unit_hand_edits(unit_key,field,action,value,actor_user_id,actor_name,actor_role,request_id) values ('SPOTTER 410','site','set','x','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','J','technician','r-badrole')"), /actor_role_check|violates check/);
});

test('the API roles cannot read or write the table; service_role may read and insert', () => {
  for (const role of ['anon', 'authenticated']) {
    for (const statement of ['select 1 from public.camera_unit_hand_edits', 'select 1 from public.camera_unit_hand_edit_current']) {
      assert.match(fails(`set local role ${role}; ${statement}`), /permission denied/);
    }
  }
  assert.equal(sql("set local role service_role; select count(*) >= 1 from public.camera_unit_hand_edit_current"), 't');
  assert.match(fails("set local role service_role; delete from public.camera_unit_hand_edits where true"), /permission denied|append-only/);
});

test('the unit name is matched without case or spacing getting in the way', () => {
  edit({unit_key: '  solarspotter 500 ', value: 'Site Five'});
  assert.equal(sql("select value from public.camera_unit_hand_edit_current where unit_key='SOLARSPOTTER 500' and field='site'"), 'Site Five');
});
