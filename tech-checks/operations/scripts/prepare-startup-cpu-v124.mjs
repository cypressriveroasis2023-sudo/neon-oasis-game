// Offline only: surgical v124 edits, never rebundle or deploy.
import ts from 'typescript';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
function prepareOwnerMemo(v) {
    if (!v || v.name !== 'cos-operations-pages' || v.version !== 124 || v.ezbr_sha256 !== '8bd2c2388da8b14ffaf3132098238f953cc8e4e918822c647f11cb479130d6c8' || v.verify_jwt !== false || v.import_map !== true)
        throw Error('Unexpected base deployment');
    if (!Array.isArray(v.files) || v.files.length !== 2)
        throw Error('Unexpected file count');
    const source = v.files.find(f => f.name === 'cos-operations-pages/serve.ts'), config = v.files.find(f => f.name === 'cos-operations-pages/deno.json');
    if (!source || !config || sha(source.content) !== '44ad296ecedc6b1247e9d720ed58a4281af982fbe2e671855c2aca78abc1b09b' || sha(config.content) !== 'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be')
        throw Error('Base source/config drift');
    if (v.files.filter(f => f.name === source.name).length !== 1 || v.files.filter(f => f.name === config.name).length !== 1 || !v.entrypoint_path?.endsWith('/source/' + source.name) || v.import_map_path !== v.entrypoint_path.slice(0, -source.name.length) + config.name)
        throw Error('Entrypoint or closure drift');
    const code = source.content, tree = ts.createSourceFile('serve.ts', code, ts.ScriptTarget.Latest, true), found = [];
    function walk(n) { if (ts.isFunctionDeclaration(n) && ['currentOwnerIdentityEvidence', 'projectOwnerConfirmedIdentities'].includes(n.name?.text))
        found.push(n); ts.forEachChild(n, walk); }
    walk(tree);
    if (found.length !== 2)
        throw Error('Unexpected declarations');
    const evidence = found.find(n => n.name.text === 'currentOwnerIdentityEvidence'), project = found.find(n => n.name.text === 'projectOwnerConfirmedIdentities');
    if (evidence.parameters.map(p => p.getText(tree)).join(',') !== 's,unitId,unitKey' || project.parameters.map(p => p.getText(tree)).join(',') !== 's')
        throw Error('Unexpected signatures');
    const edits = [], add = (start, end, text) => edits.push({ start, end, text, before: code.slice(start, end) });
    add(evidence.parameters.end, evidence.parameters.end, ',matchKey=placementMatchKey');
    let matchCalls = 0, evidenceCalls = 0;
    function body(n, which) {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
            if (which === 'evidence' && n.expression.text === 'placementMatchKey') {
                matchCalls++;
                add(n.expression.getStart(tree), n.expression.end, 'matchKey');
            }
            if (which === 'project' && n.expression.text === 'currentOwnerIdentityEvidence') {
                evidenceCalls++;
                add(n.arguments.end, n.arguments.end, ',matchKey');
            }
        }
        ts.forEachChild(n, c => body(c, which));
    }
    body(evidence.body, 'evidence');
    body(project.body, 'project');
    if (matchCalls !== 4 || evidenceCalls !== 1)
        throw Error('Unexpected call structure');
    const cache = 'const labelKeys=new Map();const matchKey=value=>{if(typeof value!=="string")return placementMatchKey(value);if(!labelKeys.has(value))labelKeys.set(value,placementMatchKey(value));return labelKeys.get(value);};';
    const loop = project.body.statements.find(ts.isForOfStatement);
    if (!loop)
        throw Error('Missing claim loop');
    add(loop.getStart(tree), loop.getStart(tree), cache);
    let result = code;
    for (const e of [...edits].sort((a, b) => b.start - a.start))
        result = result.slice(0, e.start) + e.text + result.slice(e.end);
    let reversed = result;
    const ordered = [...edits].sort((a, b) => a.start - b.start);
    let offset = 0;
    const reverse = ordered.map(e => { const x = { ...e, newStart: e.start + offset }; offset += e.text.length - (e.end - e.start); return x; });
    for (const e of reverse.reverse())
        reversed = reversed.slice(0, e.newStart) + e.before + reversed.slice(e.newStart + e.text.length);
    if (reversed !== code)
        throw Error('Closure reversal failed');
    return { edits, sourceSha256: sha(result), payload: { name: v.name, verify_jwt: v.verify_jwt, entrypoint_path: source.name, import_map_path: config.name, files: v.files.map(f => f === source ? { ...f, content: result } : f) } };
}
function prepareImportedMemo(v) { prepareOwnerMemo(v); const source = v.files.find(f => f.name.endsWith('/serve.ts')), code = source.content, tree = ts.createSourceFile('serve.ts', code, ts.ScriptTarget.Latest, true), found = []; function walk(n) { if (ts.isFunctionDeclaration(n) && ['checkedImportedBinding2', 'projectImportedGeocodes'].includes(n.name?.text))
    found.push(n); ts.forEachChild(n, walk); } walk(tree); if (found.length !== 2)
    throw Error('Unexpected functions'); const binding = found.find(n => n.name.text === 'checkedImportedBinding2'), project = found.find(n => n.name.text === 'projectImportedGeocodes'); const edits = [], add = (start, end, text) => edits.push({ start, end, text, before: code.slice(start, end) }); add(binding.parameters.end, binding.parameters.end, ',cosImportedDigest=addressDigest');
    add(binding.body.getStart(tree) + 1, binding.body.getStart(tree) + 1, 'if(typeof cosImportedDigest!=="function")cosImportedDigest=addressDigest;'); let digestCalls = 0, bindingCalls = 0; function inner(n, kind) { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
    if (n.expression.text === 'addressDigest') {
        add(n.expression.getStart(tree), n.expression.end, 'cosImportedDigest');
        digestCalls++;
    }
    if (kind === 'project' && n.expression.text === 'checkedImportedBinding2') {
        add(n.arguments.end, n.arguments.end, ',cosImportedDigest');
        bindingCalls++;
    }
} ts.forEachChild(n, c => inner(c, kind)); } inner(binding.body, 'binding'); inner(project.body, 'project'); if (digestCalls !== 2 || bindingCalls !== 3)
    throw Error('Unexpected call counts ' + digestCalls + '/' + bindingCalls); const memo = 'const cosImportedDigests=new Map();const cosImportedDigest=value=>{if(typeof value!=="string")return addressDigest(value);if(!cosImportedDigests.has(value))cosImportedDigests.set(value,addressDigest(value));return cosImportedDigests.get(value);};'; add(project.body.getStart(tree) + 1, project.body.getStart(tree) + 1, memo); let content = code; for (const e of edits.sort((a, b) => b.start - a.start))
    content = content.slice(0, e.start) + e.text + content.slice(e.end); return { sourceSha256: sha(content), edits, payload: { ...v, files: v.files.map(f => f === source ? { ...f, content } : f) } }; }
export function prepare(v) { const owner = prepareOwnerMemo(v), source = v.files.find(f => f.name.endsWith('/serve.ts')), code = source.content, tree = ts.createSourceFile('serve.ts', code, ts.ScriptTarget.Latest, true); const targets = []; function walk(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'currentOwnerIdentityEvidence') {
    function inner(x) { if (ts.isCallExpression(x) && x.expression.getText(tree) === 's.matches.some' && x.getText(tree).includes('p.id===m.vigilant_device_id&&group.some'))
        targets.push(x); ts.forEachChild(x, inner); }
    inner(n.body);
} ts.forEachChild(n, walk); } walk(tree); if (targets.length !== 1)
    throw Error('Unexpected provider predicate'); const n = targets[0], before = n.getText(tree); const text = '(()=>{const matchedProviderIds=s.matches.every(m=>typeof m.vigilant_device_id==="string")&&s.providers.every(p=>typeof p.id==="string")?new Set(s.matches.map(m=>m.vigilant_device_id)):null;return matchedProviderIds?s.providers.some(p=>matchedProviderIds.has(p.id)&&group.some(d=>p.external_device_id===d.external_device_id&&p.source===d.source)):' + before + ';})()'; const edits = [...owner.edits, ...prepareImportedMemo(v).edits, { start: n.getStart(tree), end: n.end, before, text }]; let content = code; for (const e of [...edits].sort((a, b) => b.start - a.start))
    content = content.slice(0, e.start) + e.text + content.slice(e.end); let offset = 0; const reversal = [...edits].sort((a, b) => a.start - b.start).map(e => { const r = { ...e, newStart: e.start + offset }; offset += e.text.length - (e.end - e.start); return r; }); let reversed = content; for (const e of reversal.reverse())
    reversed = reversed.slice(0, e.newStart) + e.before + reversed.slice(e.newStart + e.text.length); if (reversed !== code)
    throw Error('Unrelated bytes changed'); return { base: { version: 124, archiveSha256: v.ezbr_sha256, sourceSha256: sha(code) }, edits, sourceSha256: sha(content), manifest: v.files.map(f => ({ name: f.name, sha256: sha(f === source ? content : f.content) })), payload: { ...owner.payload, files: v.files.map(f => f === source ? { ...f, content } : f) } }; }
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output)
        throw Error('Usage: node scripts/prepare-startup-cpu-v124.mjs captured-v124.json output.json');
    const packet = prepare(JSON.parse(fs.readFileSync(input, 'utf8')));
    fs.writeFileSync(output, JSON.stringify(packet));
    console.log(JSON.stringify({ ...packet, payload: undefined, edits: packet.edits.map(({ before, text, ...e }) => ({ ...e, beforeSha256: sha(before), afterSha256: sha(text) })) }, null, 2));
}
