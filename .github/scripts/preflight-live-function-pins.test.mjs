import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LIVE_FUNCTION_PINS, livePinsMatch} from './preflight-live-function-pins.mjs';

const source = readFileSync(new URL('./preflight-live-function-pins.mjs', import.meta.url));

test('the live archive pins record camera v18 and operations-pages v170 and the file writes nothing', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), 'f44d557feaeaf12347b7f2752086eae02f9cf2c9a9befd70446edaed06446526');
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].version, 18);
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].ezbr_sha256, '3c521a58ea0bdac730e0753eb6b8d295305dc63aac723e6a4c2909a1626362b5');
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
