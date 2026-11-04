import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const source='tech-checks/docs/deployed-cos-operations-pages-v153/source';
const destination='tech-checks/docs/fleet-provenance-repair-20261104/source';
const before=fs.readFileSync(path.join(source,'productTcpRuntime.ts'),'utf8');
const expectedBefore='e63eee978e8b3cc7e74f07cc56b79c0819771c7a58de47f3a699da1498e839de';
if(sha(before)!==expectedBefore)throw Error('Recorded v153 runtime changed');
let text=before;
const edits=[];
function replace(needle,replacement,count=1){
 const found=text.split(needle).length-1;
 if(found!==count)throw Error('Patch occurrence mismatch: '+needle.slice(0,100));
 text=text.split(needle).join(replacement);edits.push({needle,replacement,count});
}
const helper=fs.readFileSync('tech-checks/operations/src/trackerSourceLabel.ts','utf8').replace('export function isTrackerSourceLabel(value:unknown):value is string','function isTrackerSourceLabel(value)');
if(!helper.includes('function isTrackerSourceLabel(value)'))throw Error('Unexpected source-label helper');
replace('!/^ServiceItem_List_[0-9]{14}\\.csv$/.test(tracker.sourceExport)','!isTrackerSourceLabel(tracker.sourceExport)',2);
replace('!/^ServiceItem_List_[0-9]{14}\\.csv$/.test(e[0])','!isTrackerSourceLabel(e[0])',2);
// Preserve the deployed WALL-E archive reader and IP reservations. Extra
// historical index rows are accepted only when the same protected mHelp
// receipt explicitly records that Product ID as absent from its current set.
replace('verifiedAt, archive) {','verifiedAt, archive, absentProductIds = []) {');
replace('    const indexed = /* @__PURE__ */ new Map();',`    if (!Array.isArray(absentProductIds) || absentProductIds.length > 10000 || new Set(absentProductIds).size !== absentProductIds.length || absentProductIds.some(id => typeof id !== "string" || !ID.test(id) || expected.has(id))) return fail2();
    const absent = new Set(absentProductIds);
    const indexed = /* @__PURE__ */ new Map();`);
replace('if ([...extraIds].some((id) => !archived.some((r) => r.productId === id))) return fail2();','if ([...extraIds].some((id) => !absent.has(id) && !archived.some((r) => r.productId === id))) return fail2();');
replace('JSON.stringify({ rangeNames, sourceExport, records, ...archived.length ? { archiveRangeNames: archive.rangeNames, archived } : {} })','JSON.stringify({ rangeNames, sourceExport, records, indexHistory: [...indexed.entries()], absentProductIds: [...absent].sort(), ...archived.length ? { archiveRangeNames: archive.rangeNames, archived } : {} })');
replace('new Date(at()).toISOString(), archive);','new Date(at()).toISOString(), archive, options.absentProductIds);');
replace('tracker: async (candidate, sourceSha256, signal) => {',`tracker: async (candidate, sourceSha256, signal, absentProductIds) => {
    if (signal.aborted) throw Error("Source cancelled");
    if (absentProductIds === undefined) {
      if (typeof options.source.platformRpc !== "function") throw Error("Complete absence evidence required");
      const current = await options.source.platformRpc("cos_mhelp_placement_snapshot", signal);
      const upload = current?.upload;
      if (signal.aborted || upload?.contract !== "COS_MHELP_API_V1" || upload.complete !== true || upload.sourceSha256 !== sourceSha256 || !Array.isArray(upload.apiMissingRecords)) throw Error("Complete current absence evidence required");
      absentProductIds = upload.apiMissingRecords.map(row => row.productId);
    }`);
replace('fetch: requestFetch, candidate, expectedMhelpSourceSha256: sourceSha256','fetch: requestFetch, candidate, absentProductIds, expectedMhelpSourceSha256: sourceSha256');
text=helper+'\n'+text;
fs.mkdirSync(destination,{recursive:true});
const files=[];
for(const name of fs.readdirSync(source)){
 const original=fs.readFileSync(path.join(source,name));
 const content=name==='productTcpRuntime.ts'?Buffer.from(text):original;
 fs.writeFileSync(path.join(destination,name),content);
 files.push({name,before:sha(original),after:sha(content),changed:name==='productTcpRuntime.ts'});
}
fs.writeFileSync('tech-checks/docs/fleet-provenance-repair-20261104/manifest.json',JSON.stringify({scope:'Candidate only. Not deployed by this script.',requiresLive:{project:'tughscoxralhofrckvxy',slug:'cos-operations-pages',version:153,archive:'4b3e304fd4b19aa801dd4ef68fbe7e18b6a96b6039b0cffbe1de03188eff4596'},files,edits},null,2)+'\n');
console.log('Prepared recorded v153 candidate; seven files unchanged, one runtime patched. No deployment performed.');
