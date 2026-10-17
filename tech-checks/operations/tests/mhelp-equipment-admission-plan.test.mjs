import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {prepareMhelpEquipmentAdmission} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentAdmissionPlan.ts';
const S='a'.repeat(64), T='b'.repeat(64);
const header='ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip';
const product=(id,name,who,cat='Camera',loc='Site')=>`${id},${name},${who==='Cameras OnSite'?11:22},${who},${cat},${loc},Houston,TX,77064`;
const old=(r)=>({contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:S,records:r});
const input=(entries)=>parseEquipmentCsv([header,...entries].join('\n'));
const admit=(rows,older,extra={})=>prepareMhelpEquipmentAdmission(rows,old(older),{sourceSha256:T,expectedActiveSourceSha256:S,currentNativeGuardsVerified:false,...extra});
const tracker=(ids)=>({contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1',sourceSha256:S,observedAt:'2026-10-16T21:00:00Z',verifiedBy:'cos_sheets_service',productIds:ids});

test('unchanged Product ID and exact Shop/Field membership require no equipment rewrite',()=>{
 const rows=input([product('11','Ranger 007','Domain Builders'),product('12','Ranger 024','Cameras OnSite')]);
 const p=admit(rows,rows,{tracker:tracker(['11','12']),currentNativeGuardsVerified:true});
 assert.equal(p.inventory.field,1);assert.equal(p.inventory.shop,1);assert.equal(p.counts.unchanged,2);assert.equal(p.gates.current2027CensusVerified,true);assert.equal(p.gates.canCommit,false);
 assert.deepEqual(p.blockers,['TRANSACTIONAL_OWNER_SOURCE_ADMISSION_NOT_INSTALLED']);
});
test('movement is held pending current authority and location checks',()=>{
 const oldRows=input([product('11','Ranger 024','Domain Builders'),product('12','Spotter 255','Cameras OnSite')]);
 const rows=input([product('11','Ranger 024','Cameras OnSite'),product('12','Spotter 255','AT&T')]);
 const p=admit(rows,oldRows);
 assert.equal(p.counts.assignment_change,2);assert.equal(p.holds.length,2);
 assert.ok(p.holds.every(r=>r.reason.includes('retain old GPS')));
});
test('Sniper 230 replacement Product ID cannot inherit prior camera identity',()=>{
 const oldRows=input([product('11','Sniper 230','AT&T')]);
 const rows=input([product('12','Sniper 230','Cameras OnSite')]);
 const p=admit(rows,oldRows,{tracker:tracker(['12'])});
 assert.equal(p.counts.product_id_collision,1);assert.equal(p.counts.absent_from_source,1);
 assert.equal(p.holds.length,2);assert.ok(p.holds.some(x=>x.productId==='12'&&x.disposition==='product_id_collision'));
});
test('current immutable identity guard false is held rather than guessed',()=>{
 const rows=input([product('11','Solar Spotter 039','Site')]);
 const prior=rows.map(row=>({...row,binding:{guardCurrent:false}}));
 const p=admit(rows,prior);assert.equal(p.counts.held_existing_guard,1);
});
test('decimal/family identity does not collapse; no customer or IP association',()=>{
 const rows=input([product('11','Ranger 029.2','Site'),product('12','Ranger 029','Site'),product('13','Solar Spotter 023','Site'),product('14','Spotter 023','Site')]);
 const p=admit(rows,rows,{tracker:tracker(['11','12','13','14'])});
 assert.equal(p.counts.unchanged,4);assert.equal(new Set(p.changes.map(x=>x.productId)).size,4);
 assert.ok(p.changes.every(x=>!Object.hasOwn(x,'ip')&&!Object.hasOwn(x,'address')));
});
test('older 2027 tracker data cannot pass simply because row count matches',()=>{
 const rows=input([product('11','Ranger 007','Domain Builders'),product('12','Ranger 024','Cameras OnSite')]);
 const p=admit(rows,rows,{tracker:tracker(['11','999'])});
 assert.equal(p.gates.current2027CensusVerified,false);
 assert.ok(p.blockers.includes('CURRENT_2027_PRODUCT_CENSUS_NOT_VERIFIED'));
});
test('rejects noncurrent source receipt SHA, duplicate Product IDs and fake verified tracker',()=>{
 const rows=input([product('11','Ranger 024','Cameras OnSite')]);
 assert.throws(()=>prepareMhelpEquipmentAdmission(rows,old(rows),{sourceSha256:T,expectedActiveSourceSha256:T,currentNativeGuardsVerified:false}),/current reviewed source guard/);
 assert.throws(()=>admit([...rows,...rows],rows),/duplicate source equipment/);
 assert.throws(()=>admit(rows,rows,{tracker:{...tracker(['11']),verifiedBy:'browser_client'}}),/unverified 2027/);
});
test('actual 1,001-row mHelp sample safely yields 287 Field and 714 Shop',async()=>{
 const {readFileSync}=await import('node:fs');let data;try{data=readFileSync('/mnt/data/ServiceItem_List_20261016131754.csv','utf8');}catch{return;}
 const rows=parseEquipmentCsv(data);const plan=admit(rows,rows,{tracker:tracker(rows.map(x=>x.productId)),currentNativeGuardsVerified:true});
 assert.equal(plan.inventory.total,1001);assert.equal(plan.inventory.field,287);assert.equal(plan.inventory.shop,714);assert.equal(plan.counts.unchanged,1001);assert.equal(plan.gates.canCommit,false);
});
test('safe Owner summary has no customer address, GPS, or operational IP',async()=>{
 const {summarizeMhelpAdmission}=await import('../../supabase/functions/cos-operations-pages/mhelpEquipmentAdmissionPlan.ts');
 const oldRows=input([product('11','Ranger 024','Domain Builders')]);
 const rows=input([product('11','Ranger 024','Cameras OnSite')]);
 const summary=summarizeMhelpAdmission(admit(rows,oldRows));
 assert.equal(summary.totalHeld,1);assert.equal(summary.readyToCommit,false);
 assert.equal(Object.hasOwn(summary,'changes'),false);
 assert.ok(!JSON.stringify(summary).includes('123 Main St'));
 assert.ok(!JSON.stringify(summary).includes('166.193'));
});