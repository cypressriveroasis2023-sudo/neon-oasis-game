import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {ownerEquipmentCsvReview} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentOwnerReview.ts';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
globalThis.crypto??=webcrypto;
const sourceFilename='ServiceItem_List_20261016131754.csv';
const CSV=['ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip','11,Ranger 007,100,Domain Builders,Ranger,113 Main St,Houston,TX,77064','12,Ranger 024,200,Cameras OnSite,Ranger,9949 W Sam Houston,Houston,TX,77064'].join('\n');
const records=parseEquipmentCsv(CSV);
const receipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:'a'.repeat(64),records};
const body={bytesBase64:Buffer.from(CSV).toString('base64'),sourceFilename};
const google={getServiceAccountJson:()=>null};
const validVerifier=async()=>({contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1',sourceSha256:'b'.repeat(64),observedAt:'2026-10-16T21:00:00Z',verifiedBy:'cos_sheets_service',productIds:['11','12'],total:2,field:1,shop:1,sourceExport:sourceFilename});
test('Owner review remains non-writable with genuine 2027 provider membership',async()=>{
 const out=await ownerEquipmentCsvReview({body,previous:receipt,google,verifyCensus:validVerifier});
 assert.equal(out.inventory.total,2);assert.equal(out.admission.inventory.field,1);assert.equal(out.censusStatus,'verified');
 assert.equal(out.admission.gates.current2027CensusVerified,true);
 assert.equal(out.admission.gates.canCommit,false);assert.equal(out.admission.readyToCommit,false);
 assert.ok(out.admission.blockers.includes('TRANSACTIONAL_OWNER_SOURCE_ADMISSION_NOT_INSTALLED'));
});
test('missing Sheets Viewer fails closed while preserving valid preview',async()=>{
 const out=await ownerEquipmentCsvReview({body,previous:receipt,google});
 assert.equal(out.censusStatus,'unavailable');assert.equal(out.admission.gates.current2027CensusVerified,false);
 assert.ok(out.admission.blockers.includes('CURRENT_2027_PRODUCT_CENSUS_NOT_VERIFIED'));
});
test('untrusted filename and duplicate CSV fail before any Google reads',async()=>{
 let calls=0;
 await assert.rejects(ownerEquipmentCsvReview({body:{...body,sourceFilename:'2026.csv'},previous:receipt,google,verifyCensus:async()=>{calls++;return await validVerifier();}}),/source filename/);
 assert.equal(calls,0);
});
test('changed assignment is held even if the 2027 source confirms it',async()=>{
 const previous={...receipt,records:records.map(x=>({...x,placement:'SHOP'}))};
 const out=await ownerEquipmentCsvReview({body,previous,google,verifyCensus:validVerifier});
 assert.equal(out.admission.counts.assignment_change,1);
 assert.equal(out.admission.totalHeld,1);
 assert.equal(out.admission.gates.canCommit,false);
});
test('scoped Owner corrections with unknown address cells remain readable and held',async()=>{
 for(const sourceAddress of [{},{street:'113 Main St'},{street:null,city:'Houston',state:'TX',zip:'77064'}]){
  const previous={...receipt,records:records.map((row,i)=>i?row:{...row,sourceAddress,placementHeld:true,scopedAuthority:{reviewed:true}})};
  const before=JSON.stringify(previous);
  const out=await ownerEquipmentCsvReview({body,previous,google,verifyCensus:validVerifier});
  assert.equal(out.changes.address,1);
  assert.equal(out.admission.counts.held_existing_guard,1);
  assert.equal(out.admission.gates.current2027CensusVerified,true);
  assert.equal(out.admission.gates.canCommit,false);
  assert.equal(JSON.stringify(previous),before);
 }
});
