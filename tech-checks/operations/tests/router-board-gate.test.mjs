// The router patch sits on the #425 gate. This boots only the gate, not the bundled handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {preparePayload} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const patch = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-unit-camera-status/router-board-on-gate-v17.json'), 'utf8'));
const pages = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-operations-pages/router-board-status-v169.json'), 'utf8'));
const liveRollback = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-unit-camera-status/rollback-router-board-to-live-v16.json'), 'utf8'));
const gateRollback = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-unit-camera-status/rollback-router-board-to-gate.json'), 'utf8'));
const read = (recipe, name) => readFileSync(join(root, recipe.sourceDir, name));
const prepared = preparePayload(patch, (name) => read(patch, name));
const entry = prepared.find((file) => file.recordName === 'index.ts').content.toString('utf8');

test('the router patch starts from the gated entry and keeps the two-route gate', () => {
  assert.equal(patch.expectedBefore['index.ts'], '64cb04d8b07e6c205ee9b51e9ba596a579f03968808d045b0c2feb6dffa1a98c');
  assert.equal(patch.requireLiveBeforeDeploy.version, 17);
  assert.equal(entry.includes('CAMERA_STATUS_ROUTES=["/api/unit-camera-status","/api/unit-camera-status/edit"]'), true);
  assert.equal(entry.includes('CAMERA_BODY_LIMIT=65536'), true);
  assert.equal(entry.includes('projectBoard(project,'), true);
  assert.equal(entry.includes('attachCameraUnits('), true);
  assert.equal(entry.includes('prior_inhand_serial'), false);
  const auth = entry.indexOf('Sign in to Tech Check to continue.');
  const owner = entry.indexOf('An active COS Owner account is required.');
  assert.ok(auth > 0 && owner > auth);
  const live = preparePayload(liveRollback, (name) => read(liveRollback, name));
  assert.equal(live.find((file) => file.recordName === 'index.ts').content.toString('utf8').includes('CAMERA_STATUS_ROUTES'), false);
  assert.equal(sha(live.find((file) => file.recordName === 'index.ts').content), 'f8de9ac5df1955803d6f37d5fbccfbdf3bce5e68079670f48418c414978830c9');
  const gate = preparePayload(gateRollback, (name) => read(gateRollback, name));
  assert.equal(sha(gate.find((file) => file.recordName === 'index.ts').content), '64cb04d8b07e6c205ee9b51e9ba596a579f03968808d045b0c2feb6dffa1a98c');
});

import {createHash} from 'node:crypto';
function sha(buf){return createHash('sha256').update(buf).digest('hex');}

function boot() {
  const marker = '// tech-checks/supabase/functions/cos-unit-camera-status/servedPath.ts';
  const tail = entry.slice(entry.indexOf(marker));
  const source = [
    'function createOperationsHandler(){return async request=>{const body=request.body?await request.text():"";calls.push({url:request.url,method:request.method,body});return new Response(JSON.stringify({reached:true}),{status:200,headers:{"Content-Type":"application/json"}});};}',
    tail,
  ].join('\n');
  const calls = [];
  const seen = [];
  vm.runInNewContext(source, {
    calls,
    Deno: { env: { get: () => undefined }, serve(handler) { seen.push(handler); return handler; } },
    URL, Request, Response, JSON, TextDecoder, Uint8Array,
  }, { filename: 'cos-unit-camera-status/index.ts' });
  assert.equal(seen.length, 1);
  return { restricted: seen[0], calls };
}

async function call(restricted, { httpMethod = 'POST', urlPath = '', envelope = null, raw = null } = {}) {
  const url = 'https://platform.example/functions/v1/cos-unit-camera-status' + (urlPath || '');
  const body = raw ?? (envelope === null ? undefined : JSON.stringify(envelope));
  const response = await restricted(new Request(url, { method: httpMethod, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body }));
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

test('the pages patch keeps the 410 and the sign-in gate in front of router addresses', () => {
  const preparedPages = preparePayload(pages, (name) => read(pages, name));
  const serve = preparedPages.find((file) => file.recordName === 'serve.ts').content.toString('utf8');
  const auth = serve.indexOf('Sign in to Tech Check to continue.');
  const owner = serve.indexOf('An active COS Owner account is required.');
  const routers = serve.indexOf('presentRouterPage(');
  assert.ok(auth > 0 && owner > auth && routers > owner);
  assert.equal(serve.includes('function cosBusinessGone'), true);
  assert.equal(serve.includes('prior_inhand_serial'), false);
  assert.equal(pages.requireLiveBeforeDeploy.version, 169);
});

test('camera routes still reach the handler and every other route, including routers, is 404', async () => {
  const { restricted, calls } = boot();
  assert.equal((await call(restricted, { httpMethod: 'GET', urlPath: '/api/unit-camera-status' })).status, 200);
  assert.equal((await call(restricted, { envelope: { path: '/api/unit-camera-status/edit', method: 'POST', body: { unitKey: 'Helios 1' } } })).status, 200);
  for (const path of ['/api/routers', '/api/fleet-saved-board/produce', '/api/jobs', '/api/owner/jobs/manual']) {
    const envelope = await call(restricted, { envelope: { path, method: 'GET', body: null } });
    const direct = await call(restricted, { httpMethod: 'GET', urlPath: path });
    assert.equal(envelope.status, 404, path);
    assert.equal(direct.status, 404, path);
    assert.equal(JSON.stringify(envelope.body).includes('203.0.113'), false);
  }
  assert.equal(calls.length, 2);
  const bulky = await call(restricted, { raw: JSON.stringify({ path: '/api/unit-camera-status', method: 'GET', pad: 'x'.repeat(70000) }) });
  assert.equal(bulky.status, 413);
  assert.equal(calls.length, 2);
});
