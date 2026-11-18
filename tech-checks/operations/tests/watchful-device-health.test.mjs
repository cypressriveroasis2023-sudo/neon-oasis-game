import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {parseWatchfulCsv, presentWatchfulDevices, watchfulSourceSha256, IN_SHOP_COLOR, WatchfulCsvError} from '../../supabase/functions/cos-watchful-device-health/model.ts';
import {createWatchfulDeviceHealthHandler} from '../../supabase/functions/cos-watchful-device-health/serve.ts';
import {watchfulActor} from '../../supabase/functions/cos-watchful-device-health/access.ts';
import {readLatestWatchfulRun, watchfulRunFromRead, WATCHFUL_READ_TIMEOUT_MS} from '../src/watchfulDeviceHealthRead.ts';

const fixture = readFileSync(new URL('./fixtures/watchful-device-health.csv', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-17T22:30:00.000Z');
const units = [
  {unit: 'NVR Fixture Alpha', placement: 'FIELD', site: 'Fixture Yard North'},
  {unit: 'Camera Fixture Beta', placement: 'FIELD', site: 'fixture yard north'},
  {unit: 'Camera Fixture Epsilon', placement: 'FIELD', site: 'Fixture Yard North'},
  {unit: 'Bridge Fixture Gamma', placement: 'SHOP', site: 'Fixture Shop'},
  {unit: 'SNIPER 099', placement: 'FIELD', site: 'Fixture Yard North'},
];

test('the sample fixture matches only certain units and never calls a shop unit an outage', () => {
  const rows = parseWatchfulCsv(fixture);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.deviceType), ['nvr', 'camera', 'bridge', 'vms', 'camera']);
  const view = presentWatchfulDevices(rows, units, NOW);
  const byName = Object.fromEntries(view.devices.map(device => [device.deviceName, device]));
  assert.equal(byName['NVR Fixture Alpha'].match, 'exact');
  assert.equal(byName['NVR Fixture Alpha'].unit, 'NVR Fixture Alpha');
  assert.equal(byName['NVR Fixture Alpha'].label, 'Red');
  assert.equal(byName['Camera Fixture Beta'].label, 'Red');
  assert.equal(byName['Bridge Fixture Gamma'].label, 'In Shop');
  assert.equal(byName['Bridge Fixture Gamma'].color, IN_SHOP_COLOR);
  assert.equal(byName['Bridge Fixture Gamma'].counted, 0);
  assert.equal(byName['VMS Fixture Delta'].match, 'unmatched');
  assert.equal(byName['VMS Fixture Delta'].label, 'Unknown');
  assert.equal(byName['VMS Fixture Delta'].unit, null);
  assert.equal(byName['Camera Fixture Epsilon'].label, 'Unknown');
  assert.equal(view.counts.offline, 0);
  assert.equal(view.counts.inShop, 0);
  assert.equal(view.counts.red, 2);
  assert.equal(view.counts.unknown, 1);
  const withoutShop = presentWatchfulDevices(rows.filter(row => row.deviceName !== 'Bridge Fixture Gamma'), units, NOW);
  assert.deepEqual(withoutShop.counts, view.counts);
  assert.equal(view.devices.some(device => device.label === 'Offline'), false);
});

test('a repeated name or a disagreeing site stays unmatched', () => {
  const rows = parseWatchfulCsv('Device Name,Site,Type,Status,Last Seen\nNVR Fixture Alpha,Other Yard,nvr,offline,2026-11-17T22:00:00.000Z\nShared Name,Fixture Yard North,camera,down,2026-11-17T22:00:00.000Z\n');
  const twins = [
    {unit: 'Shared Name', placement: 'FIELD', site: 'Fixture Yard North'},
    {unit: 'Shared Name', placement: 'FIELD', site: 'Fixture Yard North'},
  ];
  const view = presentWatchfulDevices(rows, [...units, ...twins], NOW);
  assert.deepEqual(view.devices.map(device => device.match), ['unmatched', 'unmatched']);
  assert.equal(view.counts.red, 0);
  assert.equal(view.counts.offline, 0);
});

test('columns are inferred from the header and unknown or missing columns are refused', () => {
  const reversed = parseWatchfulCsv('last_seen,STATE,Device Type, location ,name\n2026-11-17T22:00:00.000Z,offline,Bridge,Fixture Shop,Bridge Fixture Gamma\n');
  assert.equal(reversed[0].deviceType, 'bridge');
  assert.throws(() => parseWatchfulCsv('Device Name,Site,Type,Status,Last Seen,Notes\nA,B,camera,offline,2026-11-17T22:00:00.000Z,hello\n'), error => error instanceof WatchfulCsvError && error.message === 'Unknown column: notes.');
  assert.throws(() => parseWatchfulCsv('Device Name,Site,Type,Status\nA,B,camera,offline\n'), error => error instanceof WatchfulCsvError && error.message === 'Missing required column: last seen.');
  const secret = '89014103211118510720';
  assert.throws(() => parseWatchfulCsv('Device Name,Site,Type,Status,Last Seen,ICCID\nA,B,camera,offline,2026-11-17T22:00:00.000Z,' + secret + '\n'), error => {
    assert.equal(error.message, 'SIM identifiers are not accepted.');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('a stale failing row is Unknown and a missing reading is Unknown', () => {
  const rows = parseWatchfulCsv('name,site,type,status,last seen\nNVR Fixture Alpha,Fixture Yard North,nvr,offline,\n');
  const view = presentWatchfulDevices(rows, units, NOW);
  assert.equal(view.devices[0].label, 'Unknown');
  assert.equal(view.counts.offline, 0);
  assert.equal(view.counts.red, 0);
});

test('only Owner and verified IT are accepted, and a loader that is off makes no request', async () => {
  assert.deepEqual(watchfulActor({id: 'e4abc521-1ef3-45a6-9829-b87faff78210', role: 'owner', active: true}), {actorId: '3f073784-96e7-43d8-b9e0-33ab31c3c8b1'});
  assert.equal(watchfulActor({id: '78e54fbd-c2db-4d18-8e3d-a9740adcf285', role: 'service', active: true}), null);
  assert.equal(watchfulActor({id: 'e4abc521-1ef3-45a6-9829-b87faff78210', role: 'it', active: true}), null);
  const calls = [];
  const handler = createWatchfulDeviceHealthHandler({
    enabled: () => false,
    platformUrl: () => 'https://platform.test',
    serviceKey: () => 'synthetic-service-key',
    identify: async () => ({id: 'e4abc521-1ef3-45a6-9829-b87faff78210', role: 'owner', active: true}),
    fetch: async (url, init) => { calls.push({url, init}); return new Response('{}', {status: 200}); },
  });
  const refused = await handler(new Request('https://app.test/watchful', {method: 'POST', headers: {Authorization: 'Bearer synthetic-user'}, body: JSON.stringify({action: 'load', runId: '11111111-1111-4111-8111-111111111111', csv: fixture})}));
  assert.equal(refused.status, 503);
  assert.deepEqual(await refused.json(), {error: 'The Watchful device health loader is off.'});
  assert.equal(calls.length, 0);
});

test('an accepted load sends the parsed rows once and a replay keeps the same checksum', async () => {
  const calls = [];
  const handler = createWatchfulDeviceHealthHandler({
    enabled: () => true,
    platformUrl: () => 'https://platform.test',
    serviceKey: () => 'synthetic-service-key',
    identify: async () => ({id: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', role: 'it', active: true}),
    fetch: async (url, init) => { calls.push({url, body: JSON.parse(init.body)}); return new Response(JSON.stringify({inserted: 5, updated: 0, unchanged: 0, deleted: 0}), {status: 200}); },
  });
  const runId = '22222222-2222-4222-8222-222222222222';
  const response = await handler(new Request('https://app.test/watchful', {method: 'POST', headers: {Authorization: 'Bearer synthetic-user'}, body: JSON.stringify({action: 'load', runId, csv: fixture})}));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://platform.test/rest/v1/rpc/cos_watchful_device_health_load');
  assert.equal(calls[0].body.p_actor, 'd0757b64-9623-4adc-afff-21cc7853e88a');
  assert.equal(calls[0].body.p_rows.length, 5);
  assert.equal(calls[0].body.p_rows.some(row => 'imsi' in row || 'iccid' in row || 'imei' in row), false);
  assert.equal(calls[0].body.p_source_sha256, await watchfulSourceSha256(fixture));
  const again = createWatchfulDeviceHealthHandler({
    enabled: () => true,
    platformUrl: () => 'https://platform.test',
    serviceKey: () => 'synthetic-service-key',
    identify: async () => ({id: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', role: 'it', active: true}),
    fetch: async () => new Response(JSON.stringify({inserted: 0, updated: 0, unchanged: 5, deleted: 0}), {status: 200}),
  });
  const replay = await again(new Request('https://app.test/watchful', {method: 'POST', headers: {Authorization: 'Bearer synthetic-user'}, body: JSON.stringify({action: 'load', runId, csv: fixture})}));
  const replayed = await replay.json();
  assert.equal(replayed.deleted, 0);
  assert.equal(replayed.unchanged, 5);
});

function watchfulPanel() {
  const require = createRequire(import.meta.url);
  const source = readFileSync(new URL('../src/WatchfulDeviceHealthPanel.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const exported = {};
  vm.runInNewContext(compiled, {exports: exported, require: name => {
    if (name.endsWith('.css')) return {};
    if (name === './watchfulDeviceHealthRead') return {readLatestWatchfulRun, watchfulRunFromRead};
    return require(name);
  }}, {filename: 'WatchfulDeviceHealthPanel.tsx'});
  return exported;
}

test('an empty Watchful read shows Unknown and does not render empty counts', () => {
  const Panel = watchfulPanel().default;
  const empty = renderToStaticMarkup(React.createElement(Panel, {units, run: null}));
  assert.match(empty, /Unknown\. Watchful is unavailable\./);
  assert.doesNotMatch(empty, /Red 0|Offline|Reading|spinner/);
  const screen = readFileSync(new URL('../src/FleetCameraStatus.tsx', import.meta.url), 'utf8');
  assert.equal(screen.split('<WatchfulDeviceHealthPanel units={units}/>').length - 1, 1);
  assert.doesNotMatch(screen, /WatchfulDeviceHealthPanel units=\{units\} now=/);
  const source = readFileSync(new URL('../src/WatchfulDeviceHealthPanel.tsx', import.meta.url), 'utf8');
  assert.equal(source.split('readLatestWatchfulRun()').length - 1, 1);
  assert.doesNotMatch(source, /setInterval/);
});

test('a fixture run renders each matched unit’s red devices, with shop adding nothing', async () => {
  const rows = parseWatchfulCsv(fixture);
  const payload = {
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    runAt: '2026-11-17T22:30:00.000Z',
    rows: rows.map(row => ({rowKey: row.rowKey, deviceName: row.deviceName, site: row.site, deviceType: row.deviceType, reportedStatus: row.reportedStatus, lastSeenAt: row.lastSeenAt})),
  };
  let calls = 0;
  const run = await readLatestWatchfulRun({
    operator: {token: 'synthetic-owner', role: 'owner'},
    fetcher: async (url, init) => {
      calls += 1;
      assert.equal(url.endsWith('/cos-watchful-device-health'), true);
      assert.equal(JSON.parse(init.body).action, 'read');
      return new Response(JSON.stringify(payload), {status: 200});
    },
  });
  assert.equal(calls, 1);
  assert.equal(run.rows.length, 5);
  const skipped = await readLatestWatchfulRun({operator: {token: 'synthetic-service', role: 'service'}, fetcher: async () => { throw new Error('service must not read device health'); }});
  assert.equal(skipped, null);
  assert.equal(watchfulRunFromRead({runId: null, runAt: null, rows: []}), null);
  const Panel = watchfulPanel().default;
  const html = renderToStaticMarkup(React.createElement(Panel, {units, run, clock: () => NOW}));
  assert.match(html, /<strong>NVR Fixture Alpha<\/strong>/);
  assert.match(html, /Red · NVR Fixture Alpha/);
  assert.match(html, new RegExp('color:' + IN_SHOP_COLOR));
  assert.match(html, /In Shop · Bridge Fixture Gamma/);
  assert.match(html, /Unknown · Camera Fixture Epsilon/);
  assert.match(html, /Unmatched/);
  assert.match(html, /Unknown · VMS Fixture Delta/);
  assert.match(html, /Red 2 · Unknown 1 · Offline 0 · In Shop 0/);
  assert.match(html, /Run 2026-11-17T22:30:00.000Z/);
  const aged = renderToStaticMarkup(React.createElement(Panel, {units, run, clock: () => NOW + 2 * 60 * 60 * 1000}));
  assert.match(aged, /Unknown · NVR Fixture Alpha/);
  assert.doesNotMatch(aged, /Red · NVR Fixture Alpha|>Offline</);
});

test('an undeployed Watchful read fails once to Unknown and does not retry', async () => {
  let calls = 0;
  const missing = await readLatestWatchfulRun({
    operator: {token: 'synthetic-owner', role: 'owner'},
    fetcher: async () => { calls += 1; return new Response('missing', {status: 404}); },
  });
  assert.equal(missing, null);
  assert.equal(calls, 1);
  let throws = 0;
  const failed = await readLatestWatchfulRun({
    operator: {token: 'synthetic-it', role: 'it'},
    fetcher: async () => { throws += 1; throw new Error('function is not deployed'); },
  });
  assert.equal(failed, null);
  assert.equal(throws, 1);
  const html = renderToStaticMarkup(React.createElement(watchfulPanel().default, {units, run: failed}));
  assert.match(html, /Unknown\. Watchful is unavailable\./);
  assert.doesNotMatch(html, /Red 0|Offline|Reading|spinner/);
});

test('a Watchful read that does not answer within 8 seconds becomes Unknown once', async () => {
  assert.equal(WATCHFUL_READ_TIMEOUT_MS, 8000);
  let calls = 0;
  const started = Date.now();
  const result = await readLatestWatchfulRun({
    operator: {token: 'synthetic-owner', role: 'owner'},
    timeoutMs: 40,
    fetcher: () => new Promise(() => { calls += 1; }),
  });
  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 1000);
  const html = renderToStaticMarkup(React.createElement(watchfulPanel().default, {units, run: result}));
  assert.match(html, /Unknown\. Watchful is unavailable\./);
  assert.doesNotMatch(html, /Red 0|Offline|Reading|spinner/);
});

test('the recipe records the new function bytes and does not replace a pinned migration', () => {
  const recipe = JSON.parse(readFileSync(new URL('../../supabase/functions/cos-watchful-device-health/recipe.json', import.meta.url), 'utf8'));
  const file = name => readFileSync(new URL('../../supabase/functions/cos-watchful-device-health/' + name, import.meta.url));
  assert.equal(recipe.contract, 'COS_FUNCTION_EDIT_RECIPE_V1');
  assert.equal(recipe.baselineSha256, null);
  for (const item of recipe.files) assert.equal(createHash('sha256').update(file(item.name)).digest('hex'), item.sha256);
  const migrations = readFileSync(new URL('../../../.github/workflows/cos-operations.yml', import.meta.url), 'utf8');
  assert.match(migrations, /20261116_cos_power_alarm_settings\.sql/);
  assert.doesNotMatch(readFileSync(new URL('../db/20261118_cos_watchful_device_health.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''), /drop table/i);
});
