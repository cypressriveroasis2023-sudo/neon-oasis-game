import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseInhandRouterCsv, inhandStatusForRole, InhandCsvError} from '../../supabase/functions/cos-inhand-router-status/model.ts';
import {createInhandRouterStatusHandler} from '../../supabase/functions/cos-inhand-router-status/serve.ts';
import {inhandActor} from '../../supabase/functions/cos-inhand-router-status/access.ts';

const fixture = readFileSync(new URL('./fixtures/inhand-router-status.csv', import.meta.url), 'utf8');
const secret = '89014103211118510720';

test('the router CSV accepts the expected columns and refuses SIM identifiers', () => {
  const rows = parseInhandRouterCsv(fixture);
  assert.deepEqual(rows.map(row => row.serial), ['RF3152533024049', 'RF-NOT-IN-INVENTORY']);
  assert.equal(rows[0].status, 'online');
  assert.equal(rows[0].ip, '203.0.113.50');
  assert.equal(rows[0].deviceId, null);
  assert.equal(rows.some(row => 'imsi' in row || 'iccid' in row || 'imei' in row), false);
  const withDevice = parseInhandRouterCsv('name,serial,status,last seen,ip,device id\nFixture Router One,RF3152533024049,offline,2026-11-17T22:00:00.000Z,,dev-1\n');
  assert.equal(withDevice[0].deviceId, 'dev-1');
  assert.equal(withDevice[0].ip, null);
  assert.throws(() => parseInhandRouterCsv('name,serial,status,last seen\nA,RF1,online,2026-11-17T22:00:00.000Z\n'), error => error instanceof InhandCsvError && error.message === 'Missing required column: ip.');
  assert.throws(() => parseInhandRouterCsv('name,serial,status,last seen,ip,notes\nA,RF1,online,2026-11-17T22:00:00.000Z,203.0.113.50,x\n'), error => error instanceof InhandCsvError && /Unknown column: notes/.test(error.message));
  assert.throws(() => parseInhandRouterCsv('name,serial,status,last seen,ip,ICCID\nA,RF1,online,2026-11-17T22:00:00.000Z,203.0.113.50,' + secret + '\n'), error => {
    assert.equal(error.message, 'SIM identifiers are not accepted.');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.throws(() => parseInhandRouterCsv('name,serial,status,last seen,ip\nA,' + secret + ',offline,2026-11-17T22:00:00.000Z,203.0.113.50\n'), error => {
    assert.equal(error.message, 'A SIM identifier was refused.');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.throws(() => parseInhandRouterCsv('name,serial,status,last seen,ip\nA,RF1,down,2026-11-17T22:00:00.000Z,203.0.113.50\n'), /status must be online or offline/);
});

test('an IP is returned only for Owner and verified IT', () => {
  const row = {serial: 'RF3152533024049', status: 'online', ip: '203.0.113.50'};
  assert.equal(inhandStatusForRole(row, 'owner').ip, '203.0.113.50');
  assert.equal(inhandStatusForRole(row, 'it').ip, '203.0.113.50');
  assert.equal(inhandStatusForRole(row, 'service').ip, null);
  assert.equal(inhandStatusForRole(row, 'technician').ip, null);
  assert.equal('imsi' in inhandStatusForRole(row, 'owner'), false);
  assert.equal(inhandActor({id: '78e54fbd-c2db-4d18-8e3d-a9740adcf285', role: 'service', active: true}), null);
  assert.equal(inhandActor({id: 'e4abc521-1ef3-45a6-9829-b87faff78210', role: 'owner', active: true})?.role, 'owner');
});

test('a loader that is off makes no request, and upstream bodies are not copied', async () => {
  const calls = [];
  const off = createInhandRouterStatusHandler({
    enabled: () => false,
    platformUrl: () => 'https://platform.test',
    serviceKey: () => 'synthetic-service-key',
    identify: async () => ({id: 'e4abc521-1ef3-45a6-9829-b87faff78210', role: 'owner', active: true}),
    fetch: async (url, init) => { calls.push({url, init}); return new Response('{}'); },
  });
  const refused = await off(new Request('https://app.test/routers', {method: 'POST', headers: {Authorization: 'Bearer synthetic-user'}, body: JSON.stringify({action: 'load', csv: fixture})}));
  assert.equal(refused.status, 503);
  assert.equal(calls.length, 0);
  const leaked = secret + ' 203.0.113.77';
  const handler = createInhandRouterStatusHandler({
    enabled: () => true,
    platformUrl: () => 'https://platform.test',
    serviceKey: () => 'synthetic-service-key',
    identify: async () => ({id: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', role: 'it', active: true}),
    fetch: async () => new Response(JSON.stringify({message: leaked}), {status: 500}),
  });
  const hidden = await handler(new Request('https://app.test/routers', {method: 'POST', headers: {Authorization: 'Bearer synthetic-user'}, body: JSON.stringify({action: 'load', csv: fixture})}));
  const body = await hidden.text();
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes('203.0.113.77'), false);
  assert.match(body, /unavailable/);
});

test('the recipe records the new function bytes and the migration does not create or delete routers', () => {
  const recipe = JSON.parse(readFileSync(new URL('../../supabase/functions/cos-inhand-router-status/recipe.json', import.meta.url), 'utf8'));
  const file = name => readFileSync(new URL('../../supabase/functions/cos-inhand-router-status/' + name, import.meta.url));
  assert.equal(recipe.contract, 'COS_FUNCTION_EDIT_RECIPE_V1');
  assert.equal(recipe.baselineSha256, null);
  for (const item of recipe.files) assert.equal(createHash('sha256').update(file(item.name)).digest('hex'), item.sha256);
  const sql = readFileSync(new URL('../db/20261118_cos_inhand_router_status.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /insert into public\.camera_unit_routers/i);
  assert.doesNotMatch(sql, /delete from public\.camera_unit_routers/i);
  assert.match(sql, /inhand_serial/);
  assert.match(sql, /inhand_device_id/);
});
