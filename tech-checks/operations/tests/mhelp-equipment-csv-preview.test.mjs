import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {parseEquipmentCsv,previewMhelpEquipmentCsv,compareMhelpEquipmentRows,equipmentCustomerPlacement} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';

globalThis.crypto??=webcrypto;
const HASH='a'.repeat(64);
const header='ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip';
const equipment=(id,name,customer,idCustomer='1234',address='123 Main St')=>`${id},${name},${idCustomer},${customer},Sniper 2,${address},Houston,TX,77064`;
const baseline=()=>({contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:HASH,records:parseEquipmentCsv([header,equipment('101','Sniper 230','Atlas Construction'),equipment('102','Ranger 024','Cameras OnSite')].join('\n'))});
const sha=x=>createHash('sha256').update(x).digest('hex');
const preview=async(text,prior=baseline(),digest)=>previewMhelpEquipmentCsv({bytesBase64:Buffer.from(text,'utf8').toString('base64'),...(digest?{expectedSha256:digest}:{})},prior);

test('Shop classification recognizes COS exact names but not customer names beginning with COS',()=>{
 for(const name of ['Cameras OnSite','Cameras Onsite LLC','Cameras On Site','CAMERAS ONSITE - TEST UNITS'])assert.equal(equipmentCustomerPlacement(name),'SHOP');
 for(const name of ['Cameras Onsite Customer LLC','Cameras OnSite: Site Project','Cameras Onsite TEST CUSTOMER','SCS 211 Series'])assert.equal(equipmentCustomerPlacement(name),'FIELD');
});

test('parses strict multiline RFC4180 CSV and preserves decimal/family identity',()=>{
 const txt=[header,'107,"Spotter 023, HDC4S",120,"Forney, Houston",Spotter,"Line 1\nLine 2",Houston,TX,77041','108,Ranger 029.2,111,Cameras OnSite,Ranger,Shop,Houston,TX,77064'].join('\r\n');
 const rows=parseEquipmentCsv('\ufeff'+txt);
 assert.equal(rows.length,2);assert.equal(rows[0].unitNumber,'Spotter 023, HDC4S');assert.equal(rows[0].sourceAddress.street,'Line 1\nLine 2');assert.equal(rows[1].unitNumber,'Ranger 029.2');assert.equal(rows[0].placement,'FIELD');assert.equal(rows[1].placement,'SHOP');
});

test('preview identifies six independent change types and never reports readiness to commit',async()=>{
 const source=[header,equipment('101','Sniper 230','Cameras OnSite'),equipment('102','Ranger 024','Customer Field'),equipment('103','Solar Spotter 039','Cameras OnSite'),equipment('104','Sniper 230','Cameras OnSite')].join('\n');
 const r=await preview(source);
 assert.equal(r.inventory.total,4);assert.equal(r.inventory.shop,3);assert.equal(r.inventory.field,1);
 assert.equal(r.changes.placement,2);assert.equal(r.changes.customer,2);assert.equal(r.changes.added,2);assert.equal(r.changes.absent,0);
 assert.equal(r.previewOnly,true);assert.equal(r.readyToCommit,false);
 assert.equal(r.sourceSha256,sha(source));
 assert.equal(r.samples.some(s=>s.kind==='identity_review'),false);
});

test('changed Product ID with identical family and unit is held, never merged by label',async()=>{
 const txt=[header,equipment('103','Sniper 230','Cameras OnSite'),equipment('102','Ranger 024','Cameras OnSite')].join('\n');
 const r=await preview(txt);
 assert.equal(r.changes.added,1);assert.equal(r.changes.absent,1);assert.equal(r.changes.identityReview,1);
 assert.ok(r.samples.some(s=>s.kind==='identity_review'&&s.productId==='103'));
});

test('checks exact original bytes including UTF-8 BOM and expected manifest digest',async()=>{
 const csv='\ufeff'+[header,equipment('101','Sniper 230','Atlas Construction')].join('\n');
 const digest=sha(csv);const result=await preview(csv,baseline(),digest);
 assert.equal(result.sourceSha256,digest);
 await assert.rejects(preview(csv,baseline(),HASH),/SHA-256 mismatch/);
});

test('rejects malformed fields, duplicates, embedded unsafe markup, oversized source and invalid former receipts',async()=>{
 for(const csv of [header+'\n101,a,2,Cameras OnSite,Sniper 2,x,y,TX,77064\n101,b,2,Cameras OnSite,Sniper 2,x,y,TX,77064',header+'\n101,"bad"junk,2,Cameras OnSite,Sniper 2,x,y,TX,77064',header+'\n101,b,2,Customer,Sniper 2,<script>,y,TX,77064',header+'\n101,b,2,Customer,Sniper 2,x,y,TX',header+'\n101,"unterminated,2,Customer,Sniper 2,x,y,TX,77064'])assert.throws(()=>parseEquipmentCsv(csv),/Invalid mHelpDesk/);
 await assert.rejects(preview([header,equipment('101','Sniper 230','Cameras OnSite')].join('\n'),{contract:'bad',records:[]}),/previous upload/);
 await assert.rejects(previewMhelpEquipmentCsv({bytesBase64:Buffer.alloc(2*1024*1024+1).toString('base64')},baseline()),/CSV bytes/);
});

test('source comparison never includes ProductDesc/IP as operational identity',()=>{
 const rows=parseEquipmentCsv([header+',ProductDesc',equipment('101','Sniper 230','Atlas Construction')+',166.203.204.123'].join('\n'));
 assert.equal(Object.hasOwn(rows[0],'ip'),false);assert.equal(Object.hasOwn(rows[0],'productDesc'),false);
 assert.equal(compareMhelpEquipmentRows(rows,baseline(),HASH).changes.unchanged,1);
});

test('real mHelpDesk fixture stays private and independently verifies 1,001 / 287 / 714',()=>{
 // Test against original bytes only when the optional local fixture is mounted.
 const path='/mnt/data/ServiceItem_List_20261016131754.csv';
 let csv;try{csv=readFileSync(path,'utf8');}catch{return;}
 const rows=parseEquipmentCsv(csv);
 assert.equal(rows.length,1001);
 assert.equal(rows.filter(row=>row.placement==='FIELD').length,287);
 assert.equal(rows.filter(row=>row.placement==='SHOP').length,714);
 assert.equal(sha(csv),'7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891');
});

test('reviewed complete API baseline supports CSV comparison with unchanged identity protections',async()=>{
 const prior={...baseline(),contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,recordCount:2,payloadSha256:'b'.repeat(64),apiMissingRecords:[]};
 const source=[header,equipment('103','Sniper 230','Cameras OnSite'),equipment('102','Ranger 024','Cameras OnSite')].join('\n');
 const result=await preview(source,prior);assert.deepEqual(result,await preview(source,baseline()));assert.equal(result.changes.identityReview,1);assert.equal(result.readyToCommit,false);
 for(const patch of [{reviewed:false},{sourceSha256:'bad'},{payloadSha256:'bad'},{origin:'csv'},{portalId:'17'},{complete:false},{recordCount:1},{apiMissingRecords:null},{records:[prior.records[0],prior.records[0]]}])await assert.rejects(preview(source,{...prior,...patch}),/Invalid mHelpDesk/);
 await assert.rejects(preview(source,prior,HASH),/SHA-256 mismatch/);
});
