import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Browser fixtures are not imported by node:test. Catch merge artifacts and
// duplicate imports before the slower database/build/browser stages begin.
test('every hosted browser spec has valid JavaScript before browser collection', () => {
  const directory=fileURLToPath(new URL('.',import.meta.url));
  const files=readdirSync(directory).filter(name=>name.endsWith('.browser.spec.mjs')).sort();
  assert.ok(files.length>0);
  for(const file of files) assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',file],{cwd:directory,stdio:'pipe'}),file);
});
