import fs from 'node:fs';
import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const files=[
 {path:'tech-checks/supabase/functions/cos-operations-pages/mhelp2027ConnectionCensus.ts',beforeSha256:'7db279a2f91261c38df55dfdae86a021e5fa836486860823c05d1e9b2bab8594',afterSha256:'a3600681b6b585273c7a0ceda348c60fe082a01259d7da9aec1af1e827b735a5',prepend:"import {isTrackerSourceLabel} from '../../../operations/src/trackerSourceLabel.ts';\n",needle:'!/^ServiceItem_List_[0-9]{14}\\.csv$/.test(e[0])',replacement:'!isTrackerSourceLabel(e[0])'},
 {path:'tech-checks/operations/src/exactProductConnection.ts',beforeSha256:'fac046c2e3833bb1de9ffce201640ceec4e40421794dde84407a981e8b51f653',afterSha256:'6528b0aff6968265c9f165a2e1ff368541499c3d4c50f54d45380ad05397ab19',prepend:"import {isTrackerSourceLabel} from './trackerSourceLabel';\n",needle:'!/^ServiceItem_List_[0-9]{14}\\.csv$/.test(tracker.sourceExport)',replacement:'!isTrackerSourceLabel(tracker.sourceExport)'}
];
const prepared=files.map(f=>{
 const before=fs.readFileSync(f.path,'utf8');if(hash(before)===f.afterSha256)return {...f,content:before};
 if(hash(before)!==f.beforeSha256||before.split(f.needle).length!==2)throw Error('Source changed: '+f.path);
 const content=f.prepend+before.replace(f.needle,f.replacement);
 if(hash(content)!==f.afterSha256)throw Error('Unexpected patch output: '+f.path);
 return {...f,content};
});
const helper=String.raw`/** Descriptive provenance only. Product IDs, source hashes, freshness and
 * endpoint ownership are validated independently; a label never grants trust.
 * Retain actual API provenance rather than inventing a CSV filename. */
export function isTrackerSourceLabel(value:unknown):value is string {
 if(typeof value!=="string"||value!==value.trim())return false;
 if(/^ServiceItem_List_[0-9]{14}\.csv$/.test(value))return true;
 const m=/^MHelpDesk pull accepted (20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):([0-5][0-9]) CT$/.exec(value);
 if(!m)return false;
 const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
 return d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3]);
}
`;
const original=fs.readFileSync('tech-checks/operations/tests/mhelp-2027-connection-census.test.mjs','utf8');
const boundary=original.indexOf("test('complete exact-ID census");if(boundary<0)throw Error('Fixture changed');
const tests=original.slice(0,boundary)+String.raw`import {isTrackerSourceLabel} from '../src/trackerSourceLabel.ts';
const apiLabel='MHelpDesk pull accepted 2026-11-04 06:36 CT';
function apiFixture(){const f=fixture();for(const row of f.values[5].values.slice(1))row[0]=apiLabel;return f;}
test('actual API pull provenance is accepted without inventing a CSV filename',async()=>{
 const f=apiFixture(),proof=await verify(f);
 assert.equal(proof.sourceExport,apiLabel);assert.equal(proof.records.length,4);
 const result=buildExactProductConnections(f.accepted,proof,devices,now,new Map([['11',['101']],['13',['103']]]));
 assert.deepEqual(result.items.map(p=>[p.productId,p.status]),[['11','online'],['12','unknown'],['13','offline']]);
 assert.deepEqual(proof.records[1].reviewReasons,['placement_mismatch','customer_mismatch']);
});
test('legacy CSV labels continue to be accepted',async()=>{
 assert.equal(isTrackerSourceLabel(filename),true);assert.equal((await verify(fixture())).sourceExport,filename);
});
test('API labels require the exact format and a real calendar date',()=>{
 for(const value of [null,{},'',apiLabel+' ',apiLabel+'\n','MHelpDesk pull accepted 2026-02-30 06:36 CT','MHelpDesk pull accepted 2026-11-04 25:36 CT','MHelpDesk pull accepted 2026-11-04 06:60 CT','MHelpDesk pull accepted 2026-11-04 06:36 UTC','MHelpDesk pull accepted yesterday','<script>'])assert.equal(isTrackerSourceLabel(value),false,JSON.stringify(value));
 assert.equal(isTrackerSourceLabel('MHelpDesk pull accepted 2028-02-29 00:00 CT'),true);
});
test('mixed source labels cannot certify one census',async()=>{
 for(const label of [filename,'MHelpDesk pull accepted 2026-11-04 06:37 CT']){const f=apiFixture();f.values[5].values[2][0]=label;await assert.rejects(verify(f));}
});
test('API label does not weaken exact Product ID and row/column guards',async()=>{
 for(const mutate of [f=>f.values[1].values[2][0]='11',f=>f.values[3].values.pop(),f=>f.values[3].values[1][0]='RANGERS|Wrong 999',f=>f.values[6].range="'UNIT OVERVIEW'!I1:I1500",f=>f.current.push({...f.current[0]})]){const f=apiFixture();mutate(f);await assert.rejects(verify(f));}
});
test('shared-IP ownership remains held for API provenance',async()=>{
 const f=apiFixture();f.values[6].values[2]=['8.8.8.8'];
 const result=buildExactProductConnections(f.accepted,await verify(f),devices,now,new Map([['11',['101']],['13',['103']]]));
 assert.equal(result.items[0].status,'unknown');assert.equal(result.items[2].status,'offline');
});
test('API label never bypasses stale timestamps or source-hash mismatch',async()=>{
 const f=apiFixture(),proof=await verify(f),members=new Map([['11',['101']],['13',['103']]]);
 assert.equal(buildExactProductConnections(f.accepted,{...proof,expectedMhelpSourceSha256:'b'.repeat(64)},devices,now,members),null);
 assert.equal(buildExactProductConnections(f.accepted,{...proof,verifiedAt:new Date(now-31*60000).toISOString()},devices,now,members),null);
 assert.equal(buildExactProductConnections(f.accepted,{...proof,sourceExport:'unvalidated label'},devices,now,members),null);
});
`;
for(const f of prepared)fs.writeFileSync(f.path,f.content);
fs.writeFileSync('tech-checks/operations/src/trackerSourceLabel.ts',helper);
fs.writeFileSync('tech-checks/operations/tests/fleet-source-provenance.test.mjs',tests);
fs.mkdirSync('repair-evidence',{recursive:true});
fs.writeFileSync('repair-evidence/source-label-patch.json',JSON.stringify({scope:'Source-label compatibility only; no production deployment performed',files},null,2)+'\n');
console.log('Prepared exact source-label patch. Production artifacts and data remain unchanged.');
