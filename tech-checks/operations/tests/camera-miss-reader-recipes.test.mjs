import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparePayload} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root=new URL('../../..', import.meta.url);
const read=(path)=>readFileSync(new URL(path, root),'utf8');
const load=(path)=>JSON.parse(read(path));
function patched(path){
  const patch=load(path);
  const files=Object.fromEntries(preparePayload(patch, name=>readFileSync(new URL(patch.sourceDir+'/'+name, root))).map(file=>[file.recordName, file.content.toString('utf8')]));
  return {patch, files};
}
const oldReason='Completed saved TCP/service-port check had no response on all configured ports. Camera video is not verified.';
const verifying='One or two fresh probe misses. Status is Verifying, not an outage. Camera video is not verified.';

test('classifier recipes are stacked on the confirmed #433 bytes',()=>{
  const pages=load('.github/function-patches/cos-operations-pages/camera-miss-readers-v170.json');
  const camera=load('.github/function-patches/cos-unit-camera-status/camera-miss-readers-v18.json');
  const producer=load('.github/function-patches/cos-fleet-board-producer/camera-miss-readers-v11.json');
  assert.equal(pages.requireLiveBeforeDeploy.version, 170);
  assert.equal(camera.requireLiveBeforeDeploy.version, 18);
  assert.equal(producer.requireLiveBeforeDeploy.version, 11);
  assert.equal(pages.expectedBefore['serve.ts'], '45a6ffce48b4803ea91c9f160c702312c07af91a3618c7087f45216468b6ba79');
  assert.equal(camera.expectedBefore['index.ts'], '60e2634386c2963c1aa5aeb67c2335e10fa3e5f974ab5505eed0c80bcb007ae4');
  assert.equal(producer.expectedBefore['index.ts'], '7d57a8e33fc3b4c4b0099920758770687840e3d719b22ba2971a2dbe1cc11e2e');
  for (const patch of [pages, camera, producer]) assert.equal(patch.expectedBefore['routerBoardJoin.mjs'], 'e01f4c1370bc3d2acd6e5db7f69951470e02db1f78b533ae11520bbeead41dc4');
});

test('pages recipe keeps the 410 gate and replaces the first-miss classifier',()=>{
  const {patch, files}=patched('.github/function-patches/cos-operations-pages/camera-miss-readers-v170.json');
  assert.equal(patch.requireLiveBeforeDeploy.version, 170);
  assert.match(files['serve.ts'], /function cosBusinessGone\(path\)/);
  assert.match(files['serve.ts'], /error:"gone"/);
  assert.equal(files['serve.ts'].includes(oldReason), false);
  assert.match(files['serve.ts'], /Three fresh probe misses in a row/);
  assert.match(files['savedFleetBoard.mjs'], /verifying: "Verifying"/);
  assert.match(files['savedFleetBoard.mjs'], /PLACEMENT CONFLICT: camera inventory says/);
  assert.equal(files['savedFleetBoard.mjs'].includes('classification.scope === "shop" && state === "offline"'), false);
  assert.match(files['productVerifyNow.ts'], /\['online','offline','verifying'\]/);
  assert.match(files['productTcpRuntime.ts'], /Connection refused \(os error 111\)/);
});

test('unit camera status recipe patches the bundled classifier and keeps the route gate',()=>{
  const {patch, files}=patched('.github/function-patches/cos-unit-camera-status/camera-miss-readers-v18.json');
  assert.equal(patch.requireLiveBeforeDeploy.version, 18);
  assert.match(files['index.ts'], /\/api\/unit-camera-status/);
  assert.equal(files['index.ts'].includes(oldReason), false);
  assert.match(files['index.ts'], new RegExp(verifying.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(files['index.ts'], /PLACEMENT CONFLICT: camera inventory says/);
  assert.equal(files['index.ts'].includes('classification.scope === "shop" && state2 === "offline"'), false);
  assert.match(files['index.ts'], /Connection refused \(os error 111\)/);
});

test('producer recipe keeps the router wrap and points at the patched handler',()=>{
  const {patch, files}=patched('.github/function-patches/cos-fleet-board-producer/camera-miss-readers-v11.json');
  assert.equal(patch.requireLiveBeforeDeploy.version, 11);
  assert.match(files['index.ts'], /routerBoardAuth\.run/);
  assert.match(files['index.ts'], /411138b49fd6b7fd2ab426bb8318c08a86e7da01\/tech-checks\/docs\/cos-fleet-board-producer-handler\/serve\.ts/);
  assert.equal(files['index.ts'].includes('b5b188229346182d9a4e29da42415a1b9d3b9d53'), false);
});

test('step-back rollbacks restore the pre-miss bytes and live rollbacks match the recorded entries',()=>{
  const pages=patched('.github/function-patches/cos-operations-pages/rollback-camera-miss-readers-to-433.json');
  assert.match(pages.files['serve.ts'], /function cosBusinessGone\(path\)/);
  assert.match(pages.files['serve.ts'], new RegExp(oldReason.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const live=patched('.github/function-patches/cos-operations-pages/rollback-camera-miss-readers-to-live-v168.json');
  assert.equal(live.patch.expectedBefore['index.ts'], '4340eb2f772cf4e7c0bc26475f1c7ca164f2ca0e9ae321fe6f6ce21ef1fdb7c3');
  const camera=patched('.github/function-patches/cos-unit-camera-status/rollback-camera-miss-readers-to-live-v16.json');
  assert.equal(camera.patch.expectedBefore['index.ts'], 'f8de9ac5df1955803d6f37d5fbccfbdf3bce5e68079670f48418c414978830c9');
  const producer=patched('.github/function-patches/cos-fleet-board-producer/rollback-camera-miss-readers-to-live-v9.json');
  assert.equal(producer.patch.expectedBefore['index.ts'], '12e1c91640809fcb9f2cd74d26d24970d875d12b55482885b3eab40d0b6a330e');
});
