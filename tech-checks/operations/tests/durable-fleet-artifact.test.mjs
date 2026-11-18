import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {completedBoard as sourceBoard} from '../durable-board/project.ts';
import {completedBoard as packagedBoard} from '../../supabase/functions/cos-operations-pages/savedFleetBoard.mjs';
import {completedBoard as previewBoard} from '../../docs/vision-native-preview-20261107/source/savedFleetBoard.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

test('packaged durable Fleet backend is rebuilt exactly from the reviewed source',()=>{
 const result=buildSync({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:['durable-board/index.ts'],bundle:true,platform:'neutral',format:'esm',resolveExtensions:['.ts','.mjs','.js','.tsx','.json'],write:false});
 const rebuilt=Buffer.from(result.outputFiles[0].contents);
 assert.deepEqual(readFileSync(new URL('../../supabase/functions/cos-operations-pages/savedFleetBoard.mjs',import.meta.url)),rebuilt);
 const preview=readFileSync(new URL('../../docs/vision-native-preview-20261107/source/savedFleetBoard.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(preview).digest('hex'),'963556e30c6f93e1f83b135de5e67932801517ba54e3c219d5523ad322ab5299');
});

test('durable projection source and both packaged artifacts return the same complete board',()=>{
 const f=fieldProductFixture();
 const project=fn=>fn(structuredClone(f.health),structuredClone(f.field),structuredClone(f.connections),null,f.now);
 const expected=project(sourceBoard);
 assert.equal(expected.contract,'COS_SAVED_FLEET_BOARD_V1');
 assert.deepEqual(project(packagedBoard),expected);
 assert.deepEqual(project(previewBoard),expected);
});

test('prepared preview manifest matches the packaged projection bytes',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../docs/vision-native-preview-20261107/manifest.json',import.meta.url),'utf8'));
 const bytes=readFileSync(new URL('../../docs/vision-native-preview-20261107/source/savedFleetBoard.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sourceHashes['savedFleetBoard.mjs']);
});
