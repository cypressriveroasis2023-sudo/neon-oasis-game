// NEW review-only adapter. Not part of the historical source or deployment.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const BASELINE_SHA256 = '1e435cdfa5c01c09d4414b85102d34029e869a1c3bb40445cc876693a98126d0';
export const BUILDER_SHA256 = '0f78fd1dd085c9ea2821be2233a83681523b7df422c11763a2c5f67fe52e5fbc';
const builderPath = 'tree/tech-checks/operations/scripts/prepare-attribution-v133.mjs';
const baselinePath = 'baseline-24e2dc78/tech-checks/operations/src/exactProductConnection.ts';
const lookup = "execFileSync('git',['show',baseline+':tech-checks/operations/src/exactProductConnection.ts'],{encoding:'utf8'})";
function checked(bytes, digest, label) {
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw Error(`${label} SHA256 mismatch`);
  return bytes.toString('utf8');
}
function once(text, needle, replacement) {
  if (text.split(needle).length !== 2) throw Error('Adapter substitution boundary mismatch');
  return text.replace(needle, () => replacement);
}
// Checks precede substitution and dependency loading. Expected digests are constants,
// never derived from the supplied files and never updated by this adapter.
export function archiveInputs(root = new URL('./', import.meta.url)) {
  const builderUrl = new URL(builderPath, root);
  const builder = checked(fs.readFileSync(builderUrl), BUILDER_SHA256, 'Historical builder');
  const baseline = checked(fs.readFileSync(new URL(baselinePath, root)), BASELINE_SHA256, 'Archived baseline');
  return {builderUrl, source: once(builder, lookup, JSON.stringify(baseline))};
}
export async function loadArchivedBuilder(root = new URL('./', import.meta.url)) {
  const {builderUrl, source} = archiveInputs(root);
  const require = createRequire(builderUrl);
  let adapted = source;
  for (const name of ['typescript', 'esbuild']) {
    adapted = once(adapted, `from '${name}'`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
  }
  adapted = once(adapted, "from './prepare-product-tcp-preview-v129.mjs'", `from ${JSON.stringify(new URL('./prepare-product-tcp-preview-v129.mjs', builderUrl).href)}`);
  // Preserve historical relative source resolution; this also prevents its CLI
  // branch running when loaded through the adapter.
  adapted = adapted.replaceAll('import.meta.url', JSON.stringify(builderUrl.href));
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}
export async function prepare(capture) {
  return (await loadArchivedBuilder()).prepare(capture);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node archive-adapter.mjs <reviewed-capture.json> <local-output.json>');
  const result = await prepare(JSON.parse(fs.readFileSync(input, 'utf8')));
  fs.writeFileSync(fileURLToPath(pathToFileURL(output)), JSON.stringify(result));
  console.log(JSON.stringify(result.manifest));
}
