import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsPlatformEntry} from '../src/operationsPlatformEntry.ts';

test('packaged Operations returns to its own platform without changing origin',()=>{
  assert.equal(operationsPlatformEntry('/operations/dist/index.html'),'/index.html');
  assert.equal(operationsPlatformEntry('/operations/dist/'),'/index.html');
  assert.equal(operationsPlatformEntry('/neon-oasis-game/tech-checks/operations/dist/index.html'),'/neon-oasis-game/tech-checks/index.html');
});
test('unrecognized paths cannot manufacture external or query-bearing entry links',()=>{
  for(const path of ['/','/index.html','//evil.example/operations/dist/index.html','https://evil.example/operations/dist/index.html','/bad\\host/operations/dist/index.html','/bad?token=secret/operations/dist/index.html','/bad#hash/operations/dist/index.html'])assert.equal(operationsPlatformEntry(path),null,path);
});
