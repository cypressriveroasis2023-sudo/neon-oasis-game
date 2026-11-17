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
  assert.equal(patch.expectedBefore['index.ts'], '7ed24bbae2e2d4d62a49a2b647393126afe07290926261e79e24f71493b852fc');
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
  assert.equal(sha(gate.find((file) => file.recordName === 'index.ts').content), '7ed24bbae2e2d4d62a49a2b647393126afe07290926261e79e24f71493b852fc');
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
  const doubled = await call(restricted, { httpMethod: 'POST', urlPath: '/api/unit-tracker/cos-unit-camera-status/api/unit-camera-status/edit', raw: '{}' });
  const doubledPages = await call(restricted, { httpMethod: 'POST', urlPath: '/api/unit-tracker/cos-operations-pages/api/unit-camera-status/edit', raw: '{}' });
  assert.equal(doubled.status, 404);
  assert.equal(doubledPages.status, 404);
  assert.equal(calls.length, 2);
});

const producerPatch = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-fleet-board-producer/router-board-on-gate-v10.json'), 'utf8'));
const producerEntry = preparePayload(producerPatch, (name) => read(producerPatch, name)).find((file) => file.recordName === 'index.ts').content.toString('utf8');
const producerImport = 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/b5b188229346182d9a4e29da42415a1b9d3b9d53/tech-checks/docs/vision-native-preview-20261107/source/serve.ts';

function bootProducer() {
  const calls = { n: 0 };
  const source = producerEntry
    .replace('import { AsyncLocalStorage } from "node:async_hooks";\n', '')
    .replace('import { annotateSavedBoard, loadRouterBoardSources } from "./routerBoardJoin.mjs";\n', '')
    .replace('await import("' + producerImport + '");', 'Deno.serve(async()=>{calls.n+=1;return new Response(JSON.stringify({served:true}),{status:200,headers:{"Content-Type":"application/json"}});});');
  const seen = [];
  const sandbox = { URL, Request, Response, JSON, TextDecoder, Uint8Array, calls };
  sandbox.globalThis = sandbox;
  sandbox.fetch = async () => new Response('{}');
  sandbox.AsyncLocalStorage = class { run(_store, fn) { return fn(); } };
  sandbox.Deno = { serve(handler) { seen.push(handler); return handler; } };
  vm.runInNewContext(source, sandbox, { filename: 'cos-fleet-board-producer/index.ts' });
  assert.equal(seen.length, 1);
  return { restricted: seen[0], calls };
}

test('the producer overlay keeps the doubled-slug 404 and the direct 64 KiB cap', async () => {
  assert.equal(producerPatch.expectedBefore['index.ts'], 'e1cd7ae339bd4df4114d50fa427069f61dce8e39b813c73e839da64fafa3b200');
  assert.equal(producerEntry.includes('own>1||pages>1'), true);
  assert.equal(producerEntry.includes('PRODUCER_BODY_LIMIT=65536'), true);
  assert.equal(producerEntry.split('routerBoardAuth.run').length - 1, 2);
  const { restricted, calls } = bootProducer();
  const produce = await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer/api/fleet-saved-board/produce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: true }),
  }));
  assert.equal(produce.status, 200);
  const doubled = await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer/api/unit-tracker/cos-fleet-board-producer/api/fleet-saved-board/produce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }));
  assert.equal(doubled.status, 404);
  const before = calls.n;
  const bulky = await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer/api/fleet-saved-board/produce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: true, pad: 'x'.repeat(70000) }),
  }));
  assert.equal(bulky.status, 413);
  assert.equal(calls.n, before);
});
