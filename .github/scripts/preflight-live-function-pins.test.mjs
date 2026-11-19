import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LIVE_FUNCTION_PINS, livePinsMatch} from './preflight-live-function-pins.mjs';

const source = readFileSync(new URL('./preflight-live-function-pins.mjs', import.meta.url));

test('the live archive pins are the recorded v16 and operations values and the file writes nothing', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), '9125267e38bcd692631c206d907554c8080d4b074a2438e6c8cb844b4377deea');
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].version, 16);
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].ezbr_sha256.startsWith('47f904b7'), true);
  assert.equal(LIVE_FUNCTION_PINS['cos-operations-pages'].ezbr_sha256_prefix, '5a2b1c67');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('writeFile'), false);
  assert.equal(source.includes('deploy'), false);
  assert.deepEqual(livePinsMatch({
    'cos-unit-camera-status': {version: 16, ezbr_sha256: LIVE_FUNCTION_PINS['cos-unit-camera-status'].ezbr_sha256},
    'cos-operations-pages': {ezbr_sha256: '5a2b1c67' + 'ab'.repeat(28)},
  }), []);
  assert.equal(livePinsMatch({'cos-unit-camera-status': {version: 15, ezbr_sha256: '0'.repeat(64)}, 'cos-operations-pages': {ezbr_sha256: '0'.repeat(64)}}).length, 3);
});
