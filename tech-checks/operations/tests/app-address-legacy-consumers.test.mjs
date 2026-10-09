import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
for(const name of ['camera-placement-controls.js','camera-effective-placement.js'])vm.runInContext(readFileSync(new URL('../../'+name,import.meta.url),'utf8'),context);
const api=context.CameraPlacementControls,effective=context.CameraEffectivePlacement;
import {appLegacyFixture as fixture} from './app-address-legacy-fixture.mjs';
const id='11111111-1111-4111-8111-111111111111',control='22222222-2222-4222-8222-222222222222';
for(const placement of ['FIELD','SHOP','INACTIVE'])for(const ownerClaim of [false,true])for(const version of [1,2])test(`actual app ${placement} V${version} projection remains usable in legacy view/editor with Owner claim ${ownerClaim}`,async()=>{
 const f=await fixture(placement,ownerClaim,version),row=f.snapshot.inventoryItems[0];assert.equal(row.customer,'Current source customer');
 const view=effective.resolve(f.snapshot,f.health,f.devices,{appProofs:[{unitId:id,proof:f.proof}]}).get('11');assert.equal(view.status,'ready');assert.equal(view.scope,placement.toLowerCase());assert.match(view.source,/COS app Owner \/ IT placement/);
 const edit=api.resolvePlacement(f.snapshot,f.health,f.state,f.key,f.proof);assert.equal(edit.row.id,id);assert.equal(edit.writerCompatible,true);assert.equal(edit.newInstallation,placement!=='FIELD');
 assert.equal(edit.address,placement==='FIELD'?'123 App St, Houston, TX 77002':'');assert.equal(edit.state,undefined);
 assert.throws(()=>api.resolvePlacement(f.snapshot,f.health,f.state,f.key),/proof changed/);
 assert.throws(()=>api.resolvePlacement(f.snapshot,f.health,f.state,f.key,{...f.proof,legacyPlacementSha256:'0'.repeat(64)}),/proof changed/);
});
test('legacy app consumer rejects altered contract, family, native target, revision and extra proof fields',async()=>{
 const f=await fixture();
 for(const change of [r=>r.importedInstallation.sourcePrecedence={},r=>r.readOnly=false,r=>r.appAddressRevision=control,r=>r.importedInstallation.addressAuthority.revision=control,r=>r.importedInstallation.addressAuthority.actorId=id,r=>r.importedInstallation.addressAuthority.legacyUnitKey='SNIPER 001',r=>r.importedInstallation.nativeUnitId=control]){
  const s=structuredClone(f.snapshot);change(s.inventoryItems[0]);assert.equal(api.isImportedInactive(s.inventoryItems[0]),false);assert.throws(()=>api.resolvePlacement(s,f.health,f.state,f.key,f.proof));assert.equal(effective.resolve(s,f.health,f.devices).get('11').status,'unresolved');
 }
});

test('app display holds mismatched or absent current proof even when a newer Owner group claim is otherwise valid',async()=>{
 const f=await fixture('FIELD',true,2);f.health.unitIdentities[0].placementAuditId='8';f.health.unitIdentities[0].proof='0'.repeat(64);f.devices[0].organization='Newer Owner destination';
 for(const appProofs of [[],[{unitId:id,proof:{...f.proof,legacyPlacementSha256:'0'.repeat(64)}}]])assert.equal(effective.resolve(f.snapshot,f.health,f.devices,{appProofs}).get('11').status,'unresolved');
});
