import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {prepareCameraPlacementDeployment} from '../scripts/cameraPlacementDeployment.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/camera-placement-deployment.json',import.meta.url)));
const digest=s=>createHash('sha256').update(s).digest('hex');
const expected=d=>({version:d.version,verifyJwt:d.verify_jwt,bundleSha256:d.ezbr_sha256,serveSha256:digest(d.files[0].content),configSha256:digest(d.files[1].content)});
test('preparation preserves complete closure and changes only unknown-until-proof fallback',()=>{
 const original=structuredClone(fixture),r=prepareCameraPlacementDeployment(fixture,expected(fixture));
 assert.deepEqual(fixture,original);assert.equal(r.changedFallbacks,1);
 assert.equal(r.payload.files[1].content,fixture.files[1].content);
 assert.equal(r.payload.verify_jwt,fixture.verify_jwt);
 assert.equal(r.payload.files[0].content.replace('?"unknown":"unknown"}', '?"unknown":"field"}'),fixture.files[0].content);
 const context=vm.createContext({});vm.runInContext(r.payload.files[0].content,context);
 const row={activation_state:'ACTIVE',organization:'Customer folder',unit_key:'Unit 1',source_status:'offline'};
 assert.equal(context.cameraScope2(row),'unknown');
 assert.equal(context.cameraScope2({...row,__ownerPlacement:'FIELD'}),'field');
 assert.equal(context.cameraScope2({...row,__ownerPlacement:'SHOP'}),'shop');
 assert.equal(context.cameraScope2({...row,organization:'ROOT'}),'shop');
 assert.equal(context.cameraScope2({...row,activation_state:'DEACTIVATED'}),'inactive');
 assert.equal(row.source_status,'offline');
});
test('changed version, archive, file bytes or closure fail closed',()=>{
 const e=expected(fixture);
 for(const mutate of [d=>d.version++,d=>d.verify_jwt=!d.verify_jwt,d=>d.ezbr_sha256='0'.repeat(64),d=>d.files[0].content+='\n',d=>d.files[1].content+=' ',d=>d.files.pop(),d=>d.files.push({...d.files[0]}),d=>d.files[1].name='other.ts']){
  const d=structuredClone(fixture);mutate(d);assert.throws(()=>prepareCameraPlacementDeployment(d,e));
 }
});
test('changed, duplicated or already patched scope requires new review',()=>{
 for(const mutate of [s=>s.replace('function cameraScope2(', 'function renamedScope('),s=>s+s,s=>s.replace('?"unknown":"field"}', '?"unknown":"unknown"}')]){
  const d=structuredClone(fixture);d.files[0].content=mutate(d.files[0].content);
  assert.throws(()=>prepareCameraPlacementDeployment(d,expected(d)));
 }
});
