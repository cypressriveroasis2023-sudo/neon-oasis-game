// NEW adapter tests, not historical artifact reproduction evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {archiveInputs, BASELINE_SHA256, BUILDER_SHA256} from './archive-adapter.mjs';
import {createHash} from 'node:crypto';

const builder = 'tree/tech-checks/operations/scripts/prepare-attribution-v133.mjs';
const baseline = 'baseline-24e2dc78/tech-checks/operations/src/exactProductConnection.ts';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-archive-adapter-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of [builder, baseline]) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
    fs.copyFileSync(new URL(name, import.meta.url), path.join(dir, name));
  }
  return {dir, root: pathToFileURL(dir + path.sep)};
}
test('Git-free archive supplies exact baseline to the historical esbuild callback', t => {
  const {dir, root} = fixture(t);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
  const {source} = archiveInputs(root);
  assert.equal(source.includes("execFileSync('git'"), false);
  const start = source.indexOf('args=>({contents:');
  const end = source.indexOf("loader:'ts'}))", start);
  assert.ok(start > 0 && end > start);
  // Execute the actual adapted callback with no process, filesystem or Git APIs.
  const callback = vm.runInNewContext('(' + source.slice(start, end + "loader:'ts'})".length) + ')', Object.create(null));
  const result = callback({path: 'exactProductConnection.ts'});
  assert.equal(result.loader, 'ts');
  assert.equal(result.contents, fs.readFileSync(path.join(dir, baseline), 'utf8'));
  assert.equal(createHash('sha256').update(result.contents).digest('hex'), BASELINE_SHA256);
});
for (const [name, label] of [[baseline, 'Archived baseline'], [builder, 'Historical builder']]) {
  test(`${label} mismatch fails closed without rewriting bytes or expectations`, t => {
    const {dir, root} = fixture(t);
    fs.appendFileSync(path.join(dir, name), '\nchanged');
    const before = fs.readFileSync(path.join(dir, name));
    assert.throws(() => archiveInputs(root), new RegExp(label + ' SHA256 mismatch'));
    assert.deepEqual(fs.readFileSync(path.join(dir, name)), before);
    assert.equal(BASELINE_SHA256, '1e435cdfa5c01c09d4414b85102d34029e869a1c3bb40445cc876693a98126d0');
    assert.equal(BUILDER_SHA256, '0f78fd1dd085c9ea2821be2233a83681523b7df422c11763a2c5f67fe52e5fbc');
  });
}
test('missing archive fails instead of falling back to Git', t => {
  const {dir, root} = fixture(t);
  fs.unlinkSync(path.join(dir, baseline));
  assert.throws(() => archiveInputs(root), {code: 'ENOENT'});
});
