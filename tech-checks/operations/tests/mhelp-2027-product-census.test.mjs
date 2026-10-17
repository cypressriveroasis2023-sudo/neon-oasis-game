import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {verify2027CensusRanges,read2027CensusFromGoogle} from '../../supabase/functions/cos-operations-pages/mhelp2027ProductCensus.ts';
globalThis.crypto??=webcrypto;
const filename='ServiceItem_List_20261016131754.csv',sha=x=>x;
const head='ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip';
const candidate=()=>parseEquipmentCsv([head,'11,Ranger 007,10,Domain Builders,Ranger,113 Main St,Houston,TX,77064','12,Ranger 024,20,Cameras OnSite,Ranger,9949 W Sam Houston,Houston,TX,77064'].join('\n'));
const rangeNames=["'UNIT OVERVIEW'!A1:E1500","'UNIT OVERVIEW'!O1:O1500","'UNIT OVERVIEW'!Q1:R1500","'MHELP MATCH INDEX'!A1:B1200","'MHELP MATCH INDEX'!D1:E1200","'MHELP MATCH INDEX'!H1:H1200"];
function mockRangeData(source,{file=filename}={}){
 const list=source.map(row=>['CAM V & RSU',row.unitNumber,row.placement,'UNKNOWN',row.customer]);
 const columns=[
  [['EQUIPMENT TYPE','UNIT #','PLACEMENT','LIVE STATUS','CUSTOMER'],...list],
  [['MHELP EQUIPMENT ID'],...source.map(x=>[x.productId])],
  [['TRACKER PLACEMENT','MHELP PLACEMENT'],...source.map(x=>[x.placement,x.placement])],
  [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],...source.map(x=>['CAM V & RSU|'+x.unitNumber,x.productId])],
  [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],...source.map(x=>[x.unitNumber,x.customer])],
  [['MHELP SOURCE EXPORT'],...source.map(x=>[file])]
 ];
 return columns.map((values,i)=>({range:rangeNames[i],majorDimension:'ROWS',values}));
}
const verify=(x,candidateSource=candidate())=>verify2027CensusRanges(x,rangeNames,candidateSource,filename,'2026-10-17T01:10:00Z');

test('proof requires same 2027 Product IDs, exact Field/Shop and source filenames',async()=>{
 const rows=candidate(),r=await verify(mockRangeData(rows));
 assert.equal(r.total,2);assert.equal(r.field,1);assert.equal(r.shop,1);assert.equal(r.contract,'COS_VERIFIED_2027_PRODUCT_CENSUS_V1');
 assert.equal(r.verifiedBy,'cos_sheets_service');assert.equal(r.productIds.length,2);
});
test('Rejects a stale copied MHELP MATCH INDEX even if row totals equal',async()=>{
 const data=mockRangeData(candidate());data[3].values[2][1]='987654';
 await assert.rejects(verify(data),/index is inconsistent/);
});
test('blank non-authority display cells retain complete Product-ID and current-placement proof',async()=>{
 const data=mockRangeData(candidate());data[0].values[1][3]=null;
 data[2].values[1][1]=null;data[2].values[2]=['SHOP'];
 const v=await verify(data);assert.equal(v.total,2);assert.equal(v.field,1);assert.equal(v.shop,1);
 const bad=mockRangeData(candidate());bad[1].values[1][0]=null;
 await assert.rejects(verify(bad),/missing or shifted/);
 const badCustomer=mockRangeData(candidate());badCustomer[0].values[1][4]=null;
 await assert.rejects(verify(badCustomer),/missing or shifted/);
});
test('retirement labels stay separate from placement and require a protected mHelp lifecycle',async()=>{
 const rows=candidate();rows[1]={...rows[1],lifecycle:'DO_NOT_USE'};
 const data=mockRangeData(rows);data[2].values[2][0]='DECOMMISSIONED';
 const v=await verify(data,rows);assert.equal(v.shop,1);assert.equal(v.productRows[1].placement,'SHOP');
 await assert.rejects(verify(data,candidate()),/placement or customer/);
 const conflict=mockRangeData(rows);conflict[2].values[2]=['DECOMMISSIONED','FIELD'];
 await assert.rejects(verify(conflict,rows),/placement or customer/);
 const changed=mockRangeData(rows);changed[2].values[2][0]='RETIRED';
 assert.notEqual((await verify(changed,rows)).sourceSha256,v.sourceSha256);
});
test('Rejects changed Shop/Field/Customer without using IP or geographical guesses',async()=>{
 const rows=candidate(),data=mockRangeData(rows);data[0].values[1][2]='SHOP';
 await assert.rejects(verify(data),/placement or customer/);
 const data2=mockRangeData(rows);data2[4].values[1][1]='Wrong Customer';
 await assert.rejects(verify(data2),/indexed identity\/customer disagree/);
 const data3=mockRangeData(rows);data3[2].values[2][1]='FIELD';
 await assert.rejects(verify(data3),/placement or customer/);
});
test('Rejects a stale CSV source filename even with matching Product IDs',async()=>{
 const data=mockRangeData(candidate(),{file:'ServiceItem_List_20261013141848.csv'});
 await assert.rejects(verify(data),/source lookup is incomplete or stale/);
});
test('Blank row in only one range cannot shift indexed Product IDs',async()=>{
 const r=mockRangeData(candidate());r[0].values.splice(1,0,[]);
 await assert.rejects(verify(r),/missing or shifted/);
});
test('Rejects heading drift and range injection across workbooks',async()=>{
 const r=mockRangeData(candidate());r[0].range='2026 UNIT TRACKER!A1:E1500';
 await assert.rejects(verify(r),/expected range unavailable|expected range was unavailable/);
 const u=mockRangeData(candidate());u[1].values[0][0]='2026 EQUIPMENT ID';
 await assert.rejects(verify(u),/headers differ/);
});
test('source content digest is stable across observation times',async()=>{
 const d=mockRangeData(candidate()),a=await verify2027CensusRanges(d,rangeNames,candidate(),filename,'2026-10-17T01:10:00Z'),b=await verify2027CensusRanges(d,rangeNames,candidate(),filename,'2026-10-17T01:15:00Z');
 assert.equal(a.sourceSha256,b.sourceSha256);assert.notEqual(a.observedAt,b.observedAt);
});
test('real local 1,001-row source validates 287 Field / 714 Shop only with 2027-matching rows',async()=>{
 let content;try{content=readFileSync('/mnt/data/ServiceItem_List_20261016131754.csv','utf8');}catch{return;}
 const records=parseEquipmentCsv(content);const ranges=mockRangeData(records);
 const v=await verify(ranges,records);
 assert.equal(v.total,1001);assert.equal(v.field,287);assert.equal(v.shop,714);
});
test('server Google Viewer rejects missing service-account secret',async()=>{
 await assert.rejects(read2027CensusFromGoogle({getServiceAccountJson:()=>null,sourceFilename:filename,candidate:candidate()}),/Viewer connection is unavailable/);
});
