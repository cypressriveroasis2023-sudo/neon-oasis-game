import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {prepareMhelpShopAddressRuntime} from '../scripts/prepareMhelpShopAddressRuntime.mjs';
const original=`const CosMhelpCsvBaselineRelease={};
function compareMhelpEquipmentRows(){throw Error('old compare');}
function prepareMhelpEquipmentAdmission(){throw Error('old plan');}
Deno.serve({compare:(r,p,s)=>compareMhelpEquipmentRows(r,p,s),plan:(r,p,g)=>prepareMhelpEquipmentAdmission(r,p,g)});`;
test('compiled Shop patch preserves existing bytes and baseline/identity gates',async()=>{
 const native={slug:'cos-operations-pages',verify_jwt:false,files:[{name:'cos-operations-pages/serve.ts',content:original},{name:'cos-operations-pages/deno.json',content:'preserved'}]};
 const candidate=await prepareMhelpShopAddressRuntime(native),code=candidate.files[0].content;
 const start=code.indexOf('\nvar CosMhelpShopAddressRelease'),end=code.indexOf('Deno.serve(');assert(start>=0);assert.equal(code.slice(0,start)+code.slice(end),original);assert.deepEqual(candidate.files[1],native.files[1]);assert.equal(candidate.verify_jwt,false);
 let handler;vm.runInNewContext(code,{Deno:{serve:v=>handler=v}});
 const row={productId:'12',unitNumber:'Ranger 024',category:'Ranger',customerId:'200',customer:'Cameras OnSite',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:2,sourceAddress:{street:'Saved Shop',city:'Houston',state:'TX',zip:'77064'}};
 const old={...row,sourceAddress:{street:'',city:'',state:'',zip:''},binding:{guardCurrent:true},apiAssignment:{placementProof:{version:1,serviceVerified:false,siteLabel:''}},addressReview:null};
 const previous={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,reviewed:true,recordCount:1,sourceSha256:'a'.repeat(64),payloadSha256:'b'.repeat(64),apiMissingRecords:[],records:[old],shopAddressBaseline:{contract:'COS_REVIEWED_SHOP_ADDRESS_BASELINE_V1',baseSourceSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),payloadSha256:'b'.repeat(64),records:[structuredClone(row)]}};
 const guards={sourceSha256:'c'.repeat(64),expectedActiveSourceSha256:previous.sourceSha256,currentNativeGuardsVerified:false};
 assert.equal(handler.plan([row],previous,guards).counts.unchanged,1);assert.equal(handler.plan([row],previous,guards).gates.canCommit,false);
 assert.match(handler.compare([row],previous,guards.sourceSha256).samples[0].reason,/enrichment/);
 old.binding.guardCurrent=false;assert.equal(handler.plan([row],previous,guards).counts.held_existing_guard,1);
 assert.throws(()=>handler.plan([row],{...previous,complete:false},guards),/complete reviewed/);
 assert.throws(()=>handler.plan([row],previous,{...guards,expectedActiveSourceSha256:'d'.repeat(64)}),/current reviewed/);
 await assert.rejects(prepareMhelpShopAddressRuntime(candidate),/runtime changed/);
});
