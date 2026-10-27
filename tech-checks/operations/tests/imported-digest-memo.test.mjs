import {importedDigestFixture as fixture} from './fixtures/imported-digest-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {projectImportedGeocodes,checkedImportedBinding} from '../../supabase/functions/cos-operations-pages/importedSourceProjectionV2.ts';
const sourceUrl=new URL('../../supabase/functions/cos-operations-pages/importedSourceProjectionV2.ts',import.meta.url);
const source=fs.readFileSync(sourceUrl,'utf8');
const start=source.indexOf(' // Reuse only pure hashing'),end=source.indexOf(" if(!Array.isArray(records))",start);
let uncached=source.slice(0,start)+source.slice(end);
uncached=uncached.replace(" // Array.map supplies its numeric index as argument two; retain unary-call semantics.\n if(typeof digest!=='function')digest=addressDigest;\n",'');
uncached=uncached.replace('v:unknown,digest:typeof addressDigest=addressDigest','v:unknown').replace('await digest(installationAddress(v.installation))','await addressDigest(installationAddress(v.installation))').replaceAll('checkedImportedBinding(row.importedInstallation,digest)','checkedImportedBinding(row.importedInstallation)').replaceAll('checkedImportedBinding(r.binding,digest)','checkedImportedBinding(r.binding)').replace('s.nativeUnitId===binding.nativeUnitId),digest)','s.nativeUnitId===binding.nativeUnitId))').replace('await digest(row.address)','await addressDigest(row.address)');
const hash=s=>createHash('sha256').update(s).digest('hex');
assert.equal(hash(uncached),'8c8575262b8aece3ae72caad6758058784deab6860c150be2713608a9dd0726e','Only the reviewed local digest changes may be reversed');
const compiled=ts.transpileModule(uncached,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.[^']+)'/g,(_,path)=>`from '${new URL(path,sourceUrl).href}'`);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
async function countDigests(run,onDigest){
 const original=crypto.subtle.digest;let calls=0;
 crypto.subtle.digest=async function(...args){calls++;await onDigest?.(calls);return original.apply(this,args);};
 try{return {value:await run(),calls};}finally{crypto.subtle.digest=original;}
}
test('shared collections reuse only digest work: six hashes become one with exact output parity',async()=>{
 const f=fixture(),before=await countDigests(()=>baseline.projectImportedGeocodes(f.snapshot,f.records,[],[])),after=await countDigests(()=>projectImportedGeocodes(f.snapshot,f.records,[],[]));
 assert.deepEqual(after.value,before.value);assert.equal(before.calls,6);assert.equal(after.calls,1);assert.ok(after.value.items[0].locationImportedGeocode);
});
for(const [label,mutate] of [
 ['returned guard changes',f=>f.records[0].binding.nativeGuardSha256='e'.repeat(64)],
 ['returned product changes',f=>f.records[0].binding.productId='2'],
 ['returned native identity changes',f=>f.records[0].binding.nativeUnitId='33333333-3333-4333-8333-333333333333'],
 ['returned timestamp is future',f=>Object.assign(f.records[0],{status:'success',provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:29,longitude:-95,matchedAddress:f.row.address,geocodedAt:'2999-01-01T00:00:00Z'})],
 ['malformed digest',f=>f.row.importedInstallation.addressSha256='wrong'],
 ['revised exact address',f=>f.row.address='2 Fixture St, Houston, TX 77002'],
 ['source precedence missing confirmation',f=>f.row.importedInstallation.sourcePrecedence={}],
 ['Shop excludes estimates',f=>f.row.placement='SHOP'],
])test(label+' preserves uncached denial',async()=>{const f=fixture();mutate(f);const expected=await baseline.projectImportedGeocodes(f.snapshot,f.records,[],[]),actual=await projectImportedGeocodes(f.snapshot,f.records,[],[]);assert.deepEqual(actual,expected);assert.equal(actual.items[0].locationImportedGeocode,undefined);});
for(const field of ['nativeGuardSha256','installation'])test('mutation during digest await: '+field,async()=>{
 const run=async project=>{const f=fixture();return (await countDigests(()=>project(f.snapshot,f.records,[],[]),async n=>{if(n!==1)return;await Promise.resolve();if(field==='installation')f.row.importedInstallation.installation.street='2 Fixture St';else f.row.importedInstallation.nativeGuardSha256='e'.repeat(64);})).value;};
 assert.deepEqual(await run(projectImportedGeocodes),await run(baseline.projectImportedGeocodes));
});
test('rejected digest stays rejected and does not poison the next invocation',async()=>{
 const f=fixture();await assert.rejects(countDigests(()=>projectImportedGeocodes(f.snapshot,f.records,[],[]),()=>{throw Error('Synthetic digest failure');}),/Synthetic digest failure/);
 const next=await countDigests(()=>projectImportedGeocodes(f.snapshot,f.records,[],[]));assert.equal(next.calls,1);assert.ok(next.value.items[0].locationImportedGeocode);
});
test('cross-call source mutations revalidate hashes and binding fields',async()=>{
 const f=fixture();assert.ok((await projectImportedGeocodes(f.snapshot,f.records,[],[])).items[0].locationImportedGeocode);
 f.row.importedInstallation.installation.street='2 Fixture St';
 const next=await countDigests(()=>projectImportedGeocodes(f.snapshot,f.records,[],[]));assert.ok(next.calls>0);assert.equal(next.value.items[0].locationImportedGeocode,undefined);
 assert.equal(await checkedImportedBinding(f.row.importedInstallation),null);
});

test('binding validator ignores Array.map index arguments while preserving valid results',async()=>{const f=fixture(),bindings=[f.row.importedInstallation,structuredClone(f.row.importedInstallation)];assert.deepEqual(await Promise.all(bindings.map(checkedImportedBinding)),await Promise.all(bindings.map(value=>baseline.checkedImportedBinding(value))));});
