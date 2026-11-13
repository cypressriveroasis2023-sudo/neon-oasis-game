import {test} from 'node:test';
import assert from 'node:assert/strict';
import {servedEnvelopeBody, NOT_SERVED_HERE, UNIT_CAMERA_STATUS_PATHS} from '../../supabase/functions/cos-unit-camera-status/servedPath.ts';

const envelope = (over = {}) => JSON.stringify({path: '/api/unit-camera-status', method: 'GET', body: {}, ...over});
const served = (text) => JSON.parse(servedEnvelopeBody(text));

test('the two unit camera status paths are served', () => {
  assert.deepEqual(UNIT_CAMERA_STATUS_PATHS, ['/api/unit-camera-status', '/api/unit-camera-status/edit']);
  for (const path of UNIT_CAMERA_STATUS_PATHS) {
    assert.equal(served(envelope({path})).path, path);
    assert.equal(served(envelope({path: path + '/'})).path, path, 'a trailing slash is the same path');
  }
});

test('an envelope is passed on unchanged apart from its path', () => {
  const result = served(envelope({method: 'POST', body: {unitKey: 'SPOTTER 306', field: 'site', value: 'A Site'}}));
  assert.equal(result.method, 'POST');
  assert.deepEqual(result.body, {unitKey: 'SPOTTER 306', field: 'site', value: 'A Site'});
});

test('every other path is handed to the shared handler as one it does not serve', () => {
  for (const path of ['/api/field-map', '/api/session', '/api/jobs', '/api/product-connections',
    '/api/fleet-saved-board/refresh', '/api/camera-health/summary-v3', '/api/tech/my-day',
    '/api/unit-camera-status-other', '/api/unit-camera-statusx', '/api/unit-camera-status/edit/more']) {
    assert.equal(served(envelope({path})).path, NOT_SERVED_HERE, path);
  }
});

test('a body that is not a transport envelope is passed through untouched', () => {
  for (const text of ['not json', '', '[]', 'null', '42', '"text"', '{"method":"GET"}', '{"path":42}']) {
    assert.equal(servedEnvelopeBody(text), text);
  }
});

test('the rewritten path is one the shared handler cannot match', () => {
  assert.ok(NOT_SERVED_HERE.startsWith('/api/'), 'it must still look like an API path so the handler answers 404, not 400');
  assert.equal(UNIT_CAMERA_STATUS_PATHS.includes(NOT_SERVED_HERE), false);
});

test('the paths inlined in api.ts stay in step with the function’s own list', async () => {
  // api.ts is compiled in several harnesses with an explicit module list, so it
  // keeps its own copy of these two paths rather than importing them. This is
  // the test that keeps the two copies honest.
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
  const declared = /const unitCameraStatusPaths = (\[[^\]]*\]);/.exec(source);
  assert.ok(declared, 'api.ts no longer declares unitCameraStatusPaths');
  assert.deepEqual(JSON.parse(declared[1].replace(/'/g, '"')), UNIT_CAMERA_STATUS_PATHS);
  assert.match(source, /fetch\(endpointFor\(path\)/, 'api.ts must choose its endpoint per path');
  assert.ok(source.includes('functions/v1/cos-unit-camera-status'), 'api.ts must know the new function');
});
