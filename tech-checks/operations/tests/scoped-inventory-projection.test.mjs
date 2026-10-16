import test from 'node:test';import assert from 'node:assert/strict';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {projectCombinedFleetRoster,projectCurrentTrackerPlacement} from '../../supabase/functions/cos-operations-pages/combinedFleetRoster.ts';
import {fixture,tracker,requestId,hash} from './fixtures/scoped-inventory-fixture.mjs';
const now=Date.parse('2026-01-03T00:00:00Z');
const row=()=>({id:tracker,unitNumber:'Sniper 80',placement:'SHOP',currentLocationType:'shop',readOnly:true,publicIp:'203.0.113.80',status:'available',endpoint:{port:443},health:{status:'offline',observedAt:'2026-01-01T00:00:00Z'},latitude:null,longitude:null});
const snapshot=r=>({items:r.placement==='FIELD'?[r]:[],inventoryItems:[r],summary:{fieldUnits:r.placement==='FIELD'?1:0}});
const project=(r,upload,audits=[])=>{const p=projectMhelpUploadPlacement(snapshot(r),upload,audits,undefined,now);return projectCombinedFleetRoster(projectEffectiveFleetPlacement(projectCurrentTrackerPlacement(p.snapshot,audits),audits,{authorizedUploadPlacements:p.authorities}),audits);};
test('admitted correction uses only its row time through final roster and preserves health/endpoints',async()=>{
 const f=await fixture();try{const r=row(),before=structuredClone(r);await f.call({apply:true});const result=project(r,await f.snapshot()),unit=result.inventoryItems[0];assert.equal(unit.placement,'FIELD');assert.equal(unit.placementEvidence.observedAt,f.evidence.receivedAt);assert.equal(result.fleetRoster.items.find(r=>r.unitId===tracker).observedAt,f.evidence.receivedAt);assert.equal(result.uploadInventory.receivedAt,f.receipt.receivedAt);assert.equal(result.uploadInventory.records.find(r=>r.productId==='102').observedAt,f.receipt.receivedAt);for(const key of ['publicIp','endpoint','health','status'])assert.deepEqual(unit[key],before[key]);assert.deepEqual(r,before);
 }finally{await f.db.close();}
});
test('newer and undated Owner changes defeat scoped projection; malformed authority fails closed',async()=>{
 const f=await fixture();try{await f.call({apply:true});const upload=await f.snapshot();for(const at of ['2026-01-02T12:00:00Z',null]){const result=project({...row(),placementSource:'owner',placementUpdatedAt:at},upload);assert.equal(result.inventoryItems[0].placement,'SHOP');assert.equal(result.uploadInventory.records[0].overlayApplied,false);}
 for(const authority of [{...upload.records[0].scopedAuthority,receivedAt:'2099-01-01T00:00:00Z'},{...upload.records[0].scopedAuthority,revisionId:'invalid'},{...upload.records[0].scopedAuthority,evidenceSha256:'invalid'}]){const bad=structuredClone(upload);bad.records[0].scopedAuthority=authority;assert.throws(()=>project(row(),bad),/scoped inventory authority/);}
 }finally{await f.db.close();}
});
test('replacement is visible source inventory but cannot adopt the old unit or its health',async()=>{
 const f=await fixture();try{const before=await f.preserved();await f.call({apply:true,operations:[{...f.op,mode:'replace_source_hold',inventoryOnlyReason:'no_sim',after:{...f.op.after,productId:'104',customerId:'11',customer:'Company',placement:'SHOP'}}]});const result=project(row(),await f.snapshot()),source=result.fleetRoster.items.find(r=>r.productIds.includes('104'));
 assert.equal(source.kind,'identity_review');assert.equal(source.unitId,null);assert.equal(source.recordedSourcePlacement,'shop');assert.equal(result.uploadInventory.records.length,3);assert.equal(result.uploadInventory.records[0].binding.state,'held');assert.equal(result.uploadInventory.records[0].overlayApplied,false);
 assert.equal(result.uploadInventory.records[0].inventoryOnlyReason,'no_sim');assert.equal(source.unit,null);assert.equal(source.publicIp,undefined);assert.equal(source.health,undefined);assert.equal(result.items.length,0);assert.deepEqual(await f.preserved(),before);
 }finally{await f.db.close();}
});
