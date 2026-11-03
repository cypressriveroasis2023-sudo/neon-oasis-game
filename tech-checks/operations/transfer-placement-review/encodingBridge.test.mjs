import test from 'node:test';import assert from 'node:assert/strict';import {inspectEncodingBridge} from './encodingBridge.mjs';
const native=[{productId:'9001',binding:{productId:'9001',nativeUnitId:'native-53',canonicalKey:'SOLAR SPOTTER:53',matchMethod:'reviewed_product_id',guardCurrent:true,expectedGuard:'a'.repeat(64),evidenceSha256:'b'.repeat(64)}}];
const legacy=[{equipment_key:'solar_spotter:53',source_family:'Solar Spotter',canonical_family:'Solar Spotter',workflow_type:'Solar Spotter',unit_tag:'53'}];
test('exact reviewed machine key bridges to stable legacy primary key without labels',()=>{
 const result=inspectEncodingBridge(native,legacy);assert.equal(result.records.length,1);assert.equal(result.records[0].equipmentKey,'solar_spotter:53');assert.equal(result.records[0].productId,'9001');assert.equal(result.held.length,0);
 const changed=native.map(r=>({...r,unitNumber:'Completely different display name'}));assert.deepEqual(inspectEncodingBridge(changed,legacy.map(r=>({...r,source_label:'Unrelated display text'}))),result);
});
test('padding collisions, families, missing bindings, stale guards and conflicting Products stay held',()=>{
 assert.equal(inspectEncodingBridge(native,[...legacy,{...legacy[0],equipment_key:'solar_spotter:053',unit_tag:'053'}]).records.length,0);
 assert.equal(inspectEncodingBridge([...native,{...native[0],productId:'9002'}],legacy).records.length,0);
 for(const b of [null,{...native[0].binding,guardCurrent:false},{...native[0].binding,matchMethod:'exact_family_unit'},{...native[0].binding,productId:'9002'}])assert.equal(inspectEncodingBridge([{...native[0],binding:b}],legacy).records.length,0);
 assert.equal(inspectEncodingBridge(native,[{...legacy[0],source_family:'Solar Stand'}]).records.length,0);
 assert.equal(inspectEncodingBridge(native,[{...legacy[0],unit_tag:'54',equipment_key:'solar_spotter:54'}]).records.length,0);
});
