import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {prepareCameraSweepCoverageRuntime} from '../scripts/prepareCameraSweepCoverageRuntime.mjs';
const query='units:metadata->units&provider=in.(witness,vigilant)&order=provider.asc';
test('coverage patch preserves every unrelated runtime byte and config, with no new network or auth handler',async()=>{
 const original=`const query=${JSON.stringify(query)};const bundle={sources:{}};const identity={};const providerIntegrations=[];function fieldRecorderHealthGuards(){return {existing:true}};Deno.serve(()=>({...fieldRecorderHealthGuards(bundle.sources,identity,providerIntegrations)}));`;
 const native={slug:'cos-operations-pages',verify_jwt:false,files:[{name:'cos-operations-pages/serve.ts',content:original},{name:'cos-operations-pages/deno.json',content:'original imports'}]};
 const candidate=await prepareCameraSweepCoverageRuntime(native);assert.equal(candidate.verify_jwt,native.verify_jwt);assert.deepEqual(candidate.files[1],native.files[1]);
 let handler;vm.runInNewContext(candidate.files[0].content,{Deno:{serve:v=>handler=v}});assert.deepEqual({...handler()},{sweepCoverage:null,existing:true});
 const code=candidate.files[0].content,helper=code.slice(code.indexOf('\nvar CosCameraSweepCoverageRelease'),code.indexOf('Deno.serve('));
 const restored=code.replace(helper,'').replace('sweepCoverage:CosCameraSweepCoverageRelease.projectCameraSweepCoverage(providerIntegrations),','').replace('units:metadata->units,sweep_source:metadata->>source,sweep_complete:metadata->complete,sweep_counts_known:metadata->counts_known,sweep_eligible:metadata->eligible,sweep_scanned:metadata->scanned,sweep_published:metadata->published,sweep_held:metadata->held,sweep_reconciled_at:metadata->>reconciled_at,sweep_held_reasons:metadata->held_reasons&provider=in.(witness,vigilant,avigilon)&order=provider.asc',query);
 assert.equal(restored,original);await assert.rejects(prepareCameraSweepCoverageRuntime(candidate),/runtime changed/);
});
