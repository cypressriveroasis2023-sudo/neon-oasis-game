import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LIVE_FUNCTION_PINS, livePinsMatch} from './preflight-live-function-pins.mjs';

const source = readFileSync(new URL('./preflight-live-function-pins.mjs', import.meta.url));

test('the live archive pins record camera v19 and operations-pages v170 and the file writes nothing', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), 'f388429d2adce11232f7e4e820cc7ee3531ddbf994665bf9aa86293e9d37fd88');
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].version, 19);
  assert.equal(LIVE_FUNCTION_PINS['cos-unit-camera-status'].ezbr_sha256, 'c434eaf6f135cff295ec0f97cfbf46c669801af5f2d6c14a7ed49a3c7d226a68');
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
