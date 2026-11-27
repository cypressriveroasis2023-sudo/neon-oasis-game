import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LIVE_FUNCTION_PINS, livePinsMatch} from './preflight-live-function-pins.mjs';

const source = readFileSync(new URL('./preflight-live-function-pins.mjs', import.meta.url));

test('the live archive pins record camera v26 and operations-pages v170 and the file writes nothing', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), '0b50c71f9c4a9eaa3263dbc71315b0b992179240f5d2f4ae3d163af771e24c18');
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].version, 26);
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].ezbr_sha256, 'd113614175d7a4f6633f562650b12a8f16c22f14655c41b211597b18b88a784f');
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
