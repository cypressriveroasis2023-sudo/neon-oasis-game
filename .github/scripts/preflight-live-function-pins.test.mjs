import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LIVE_FUNCTION_PINS, livePinsMatch} from './preflight-live-function-pins.mjs';

const source = readFileSync(new URL('./preflight-live-function-pins.mjs', import.meta.url));

test('the live archive pins record camera v20 and operations-pages v170 and the file writes nothing', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), '3491d7f3fa7ea86910fe8378411461a95edc92d273dff52b7ef5251203ef156a');
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].version, 20);
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].ezbr_sha256, 'a9cc477fb694a0e4711f86dc79930cc2dd354277812ad1af6d41315da0760ba5');
  assert.equal(LIVE_FUNCTION_PINS['cos-operations-pages'].version, 170);
  assert.equal(LIVE_FUNCTION_PINS['cos-operations-pages'].ezbr_sha256, '69802c4effb4fcee77d2bfbe0e117356f3834e102ff98aa8e723e24f82b99c8e');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('writeFile'), false);
  assert.equal(source.includes('deploy'), false);
  assert.deepEqual(livePinsMatch({
    'cos-unit-camera-status': LIVE_FUNCTION_PINS['cos-unit-camera-status'],
    'cos-operations-pages': LIVE_FUNCTION_PINS['cos-operations-pages'],
  }), []);
  assert.equal(livePinsMatch({
    'cos-unit-camera-status': {version: 16, ezbr_sha256: '47f904b7621e97c336d76b0ee7beb1d696fecda6a2f42deed8500dab837d3883'},
    'cos-operations-pages': {version: 169, ezbr_sha256: '5a2b1c67'+'ab'.repeat(28)},
  }).length, 4);
});
