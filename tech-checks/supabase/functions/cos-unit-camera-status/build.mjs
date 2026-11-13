// Build the deployable bundle for cos-unit-camera-status.
//
// The two functions already in production each import one bundled file pinned to
// a commit. This builds the same shape for this function: a single ES module
// with no remote and no npm imports, so a cold start fetches nothing. The header
// records the commit it was built from, so the deployed bytes can be rebuilt and
// compared.
//
//   node tech-checks/supabase/functions/cos-unit-camera-status/build.mjs
//
// Writes dist/index.ts next to this file and prints its sha256.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const out = join(here, 'dist');
const entry = join(here, 'serve.ts');

const git = (...args) => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'tech-checks/supabase/functions', 'tech-checks/operations/shared');

mkdirSync(out, {recursive: true});
execFileSync('npx', ['--yes', 'esbuild', entry, '--bundle', '--format=esm', '--target=es2022',
  '--platform=neutral', '--external:npm:*', '--external:jsr:*', '--external:https://*',
  '--outfile=' + join(out, 'index.ts')], {cwd: repo, stdio: 'pipe'});

const body = readFileSync(join(out, 'index.ts'), 'utf8');
for (const [label, pattern] of [['a remote import', /from\s*"https:/], ['an npm import', /from\s*"npm:/], ['a jsr import', /from\s*"jsr:/]]) {
  if (pattern.test(body)) throw new Error('The bundle still carries ' + label + '; a cold start must fetch nothing.');
}
if (!body.includes('Deno.serve')) throw new Error('The bundle does not serve.');

const header = `// cos-unit-camera-status - built bundle, do not edit.
// Source: tech-checks/supabase/functions/cos-unit-camera-status/serve.ts
// Commit: ${commit}${dirty ? ' (WORKING TREE NOT CLEAN - do not deploy this)' : ''}
// Built with: esbuild --bundle --format=esm --target=es2022 --platform=neutral
// Serves only /api/unit-camera-status and /api/unit-camera-status/edit. Every
// other path is handed to the shared handler as one it does not serve.
`;
const content = header + body;
writeFileSync(join(out, 'index.ts'), content);
writeFileSync(join(out, 'deno.json'), '{"nodeModulesDir":"auto","imports":{"jose":"npm:jose@6.2.12"}}\n');
console.log(JSON.stringify({
  commit, clean: !dirty, bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
}, null, 1));
