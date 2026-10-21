import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewedShopAddressEnrichment} from '../../supabase/functions/cos-operations-pages/mhelpShopAddressEvidence.ts';
import {prepareMhelpEquipmentAdmission} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentAdmissionPlan.ts';
import {compareMhelpEquipmentRows} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
const A='a'.repeat(64),B='b'.repeat(64);
function fixture(){
 const row={productId:'12',unitNumber:'Ranger 024',category:'Ranger',customerId:'200',customer:'Cameras OnSite',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:2,sourceAddress:{street:'Saved Shop',city:'Houston',state:'TX',zip:'77064'}};
 const old={...row,sourceAddress:{street:'',city:'',state:'',zip:''},binding:{guardCurrent:true},apiAssignment:{placementProof:{version:1,serviceVerified:false,siteLabel:''}},addressReview:null};
 const previous={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,reviewed:true,recordCount:1,sourceSha256:A,payloadSha256:B,apiMissingRecords:[],records:[old],shopAddressBaseline:{contract:'COS_REVIEWED_SHOP_ADDRESS_BASELINE_V1',baseSourceSha256:A,sourceSha256:B,payloadSha256:B,records:[structuredClone(row)]}};
 return {row,old,previous};
}
const plan=({row,previous})=>prepareMhelpEquipmentAdmission([row],previous,{sourceSha256:B,expectedActiveSourceSha256:A,currentNativeGuardsVerified:false});
test('reviewed Shop enrichment preserves raw address difference and creates no assignment hold',()=>{
 const f=fixture(),before=structuredClone(f);assert.equal(reviewedShopAddressEnrichment(f.previous,f.old,f.row),true);
 assert.equal(plan(f).counts.unchanged,1);assert.equal(plan(f).gates.canCommit,false);
 const preview=compareMhelpEquipmentRows([f.row],f.previous,B);assert.equal(preview.changes.address,1);assert.match(preview.samples[0].reason,/enrichment/);assert.deepEqual(f,before);
});
for(const [name,mutate] of [
 ['missing evidence',f=>delete f.previous.shopAddressBaseline],
 ['wrong baseline',f=>f.previous.shopAddressBaseline.baseSourceSha256=B],
 ['different address',f=>f.row.sourceAddress.street='New Shop'],
 ['different customer',f=>f.row.customerId='201'],
 ['Field movement',f=>f.row.placement='FIELD'],
 ['changed label',f=>f.row.unitNumber='Ranger 025'],
 ['changed lifecycle',f=>f.row.lifecycle='DO_NOT_USE'],
 ['partial API address',f=>f.old.sourceAddress.city='Houston'],
 ['verified API service',f=>f.old.apiAssignment.placementProof.serviceVerified=true],
 ['duplicate historical ID',f=>f.previous.shopAddressBaseline.records.push(f.row)],
 ['ordinary CSV baseline',f=>f.previous.contract='COS_MHELP_UPLOAD_V1'],
])test(name+' is not Shop omission enrichment',()=>{const f=fixture();mutate(f);assert.equal(reviewedShopAddressEnrichment(f.previous,f.old,f.row),false);assert.equal(plan(f).holds.length,1);});
test('stale association and existing holds take precedence over valid address evidence',()=>{
 for(const edit of [f=>f.old.binding.guardCurrent=false,f=>f.old.placementHeld=true]){const f=fixture();edit(f);assert.equal(plan(f).counts.held_existing_guard,1);}
});

test('newer API Shop assignment can use one sealed company postal address without a historical Shop identity match',()=>{
 const f=fixture();f.previous.shopAddressBaseline.records[0].productId='99';
 assert.equal(reviewedShopAddressEnrichment(f.previous,f.old,f.row),true);assert.equal(plan(f).counts.unchanged,1);
 f.previous.shopAddressBaseline.records.push({...f.row,productId:'98',sourceAddress:{...f.row.sourceAddress,street:'Different company address'}});
 assert.equal(reviewedShopAddressEnrichment(f.previous,f.old,f.row),false);assert.equal(plan(f).holds.length,1);
});
