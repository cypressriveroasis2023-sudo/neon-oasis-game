// The deployed cos-unit-camera-status bytes are the patched v16 bundle, not the
// source wrapper. These cases run that bundle's gate for Owner and IT.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {preparePayload} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const patch = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-unit-camera-status/camera-routes-only-v16.json'), 'utf8'));
const rollback = JSON.parse(readFileSync(join(root, '.github/function-patches/cos-unit-camera-status/rollback-to-v16-entry.json'), 'utf8'));
const read = name => readFileSync(join(root, patch.sourceDir, name));
const prepared = preparePayload(patch, read);
const entry = prepared.find(file => file.recordName === 'index.ts').content.toString('utf8');
const marker = '// tech-checks/supabase/functions/cos-unit-camera-status/servedPath.ts';
const sentinel = 'blocked-address-field';

function boot() {
  const calls = [];
  const tail = entry.slice(entry.indexOf(marker));
  const source = `
function createOperationsHandler(){
  return async request => {
    calls.push({url: request.url, method: request.method, role: request.headers.get('x-test-role') || ''});
    let path = new URL(request.url).pathname.replace(/^.*\\/cos-(?:operations-(?:pages|bridge)|fleet-board-producer)(?=\\/|$)/,'').replace(/\\/$/,'');
    if (!path && request.method === 'POST') {
      const text = await request.text();
      try {
        const envelope = JSON.parse(text);
        if (envelope && typeof envelope.path === 'string') path = envelope.path.replace(/\\/$/,'');
      } catch {}
    }
    if (path === '/api/routers') return new Response(JSON.stringify({items:[{publicIp:'${sentinel}',unitIp:'${sentinel}'}]}), {status:200, headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify({reached:true, path}), {status:200, headers:{'Content-Type':'application/json'}});
  };
}
${tail}`;
  const seen = [];
  vm.runInNewContext(source, {
    calls, Deno:{env:{get:()=>undefined}, serve(handler){seen.push(handler);}},
    URL, Request, Response, JSON, TextDecoder, Uint8Array,
  }, {filename:'cos-unit-camera-status/patched-dist.js'});
  assert.equal(seen.length, 1);
  return {gate: seen[0], calls};
}

const origin = 'https://platform.example/functions/v1/cos-unit-camera-status';
const embeds = ['cos-operations-pages', 'cos-operations-bridge', 'cos-fleet-board-producer'];

function leakUrls() {
  const urls = [`${origin}/api/routers`, `${origin}/API/ROUTERS`];
  for (const embed of embeds) {
    for (const form of [embed, embed.toUpperCase(), embed.slice(0, 4) + embed.slice(4).toUpperCase()]) {
      urls.push(`${origin}/x/${form}/api/routers`);
      urls.push(`${origin.replace('cos-unit-camera-status', 'COS-UNIT-CAMERA-STATUS')}/x/${form}/api/routers`);
    }
  }
  return urls;
}

async function bodyOf(response) {
  return {status: response.status, text: await response.text()};
}

for (const role of ['owner', 'it']) {
  test(role + ' session cannot reach router addresses through the patched dist', async () => {
    const {gate, calls} = boot();
    const headers = {Authorization: 'Bearer synthetic-session', 'x-test-role': role, 'Content-Type': 'application/json'};
    const requests = leakUrls().flatMap(url => [
      new Request(url, {method: 'GET', headers}),
      new Request(url, {method: 'POST', headers, body: '{}'}),
    ]);
    requests.push(new Request(origin, {method: 'POST', headers, body: JSON.stringify({path: '/api/routers', method: 'GET', body: null})}));
    requests.push(new Request(origin, {method: 'POST', headers, body: JSON.stringify({path: '/API/ROUTERS', method: 'GET', body: null})}));
    for (const request of requests) {
      const before = calls.length;
      const result = await bodyOf(await gate(request));
      assert.equal(result.status, 404);
      assert.equal(result.text.includes('publicIp'), false);
      assert.equal(result.text.includes('unitIp'), false);
      assert.equal(result.text.includes(sentinel), false);
      assert.equal(calls.length, before);
    }
  });

  test(role + ' session still reaches both camera routes on the patched dist', async () => {
    const {gate, calls} = boot();
    const headers = {Authorization: 'Bearer synthetic-session', 'x-test-role': role, 'Content-Type': 'application/json'};
    const listed = await bodyOf(await gate(new Request(origin, {method: 'POST', headers, body: JSON.stringify({path: '/api/unit-camera-status', method: 'GET', body: null})})));
    assert.equal(listed.status, 200);
    assert.equal(JSON.parse(listed.text).path, '/api/unit-camera-status');
    assert.equal(listed.text.includes(sentinel), false);
    const byUrl = await bodyOf(await gate(new Request(`${origin}/api/unit-camera-status`, {method: 'GET', headers})));
    assert.equal(byUrl.status, 200);
    assert.equal(calls.at(-1).url.includes('/api/unit-camera-status'), true);
    const edit = await bodyOf(await gate(new Request(origin, {method: 'POST', headers, body: JSON.stringify({path: '/api/unit-camera-status/edit', method: 'POST', body: {}})})));
    assert.equal(edit.status, 200);
    assert.equal(JSON.parse(edit.text).path, '/api/unit-camera-status/edit');
    assert.equal(calls.at(-1).role, role);
  });
}

test('rollback restores the unpatched v16 bundle hash', () => {
  const restored = preparePayload(rollback, read);
  assert.equal(restored.find(file => file.recordName === 'index.ts').sha256, 'f8de9ac5df1955803d6f37d5fbccfbdf3bce5e68079670f48418c414978830c9');
  assert.equal(prepared.find(file => file.recordName === 'index.ts').sha256, 'a9c7c08bb6fbb22e80c51792d28a8c0ea22fbf84cd84bf0128671ed890140b1f');
});
