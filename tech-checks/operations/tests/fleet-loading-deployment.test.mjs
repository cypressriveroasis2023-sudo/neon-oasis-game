import test from 'node:test';import assert from 'node:assert/strict';
import {prepareFleetLoadingDeployment} from '../scripts/fleetLoadingDeployment.mjs';
const start='let[freshSnapshot,freshBundle]=await Promise.all([rpc(snapshots[path],actorPayload),readIdentitySources(context)])';
const end=',mhelpReceipt=await readMhelpPlacements(actorPayload),ownerCensusEvidence=await readOwnerCensusEvidence(';
const deployment=()=>({name:'cos-operations-pages',version:103,verify_jwt:false,files:[{name:'cos-operations-pages/serve.ts',content:'protected-address-token-wrapper();'+start+';other-guards()'+end+'args);protected-runtime-auth();'},{name:'cos-operations-pages/deno.json',content:'{"nodeModulesDir":"auto"}'}]});
test('deployment scheduling patch preserves all other live bytes and runtime settings',()=>{
 const live=deployment(),copy=structuredClone(live),result=prepareFleetLoadingDeployment(live);
 assert.deepEqual(live,copy);assert.equal(result.payload.verify_jwt,false);assert.equal(result.version,103);
 assert.deepEqual(result.payload.files[1],live.files[1]);assert.notEqual(result.beforeSha256,result.afterSha256);
 assert.ok(result.payload.files[0].content.startsWith('protected-address-token-wrapper();'));
 assert.ok(result.payload.files[0].content.endsWith('protected-runtime-auth();'));
 assert.match(result.payload.files[0].content,/freshBundle,mhelpReceipt/);
});
for(const change of [f=>f.files[0].content+=';'+start,f=>f.files[0].content=f.files[0].content.replace(end,'different-code'),f=>f.files=[],f=>f.name='other-function'])test('a changed deployment refuses an automatic patch',()=>{const live=deployment();change(live);assert.throws(()=>prepareFleetLoadingDeployment(live));});
