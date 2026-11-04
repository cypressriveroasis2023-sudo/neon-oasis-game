import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {verify2027CensusRanges} from '../../supabase/functions/cos-operations-pages/mhelp2027ProductCensus.ts';
import {verify2027ConnectionCensus} from '../../supabase/functions/cos-operations-pages/mhelp2027ConnectionCensus.ts';
import {buildExactProductConnections,TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';
const now=Date.parse('2026-10-27T12:00:00Z'),at=new Date(now).toISOString(),hash='a'.repeat(64),filename='ServiceItem_List_20261023120000.csv';
const ranges=["'UNIT OVERVIEW'!A1:E1500","'UNIT OVERVIEW'!O1:O1500","'UNIT OVERVIEW'!Q1:R1500","'MHELP MATCH INDEX'!A1:B1200","'MHELP MATCH INDEX'!D1:E1200","'MHELP MATCH INDEX'!H1:H1200","'UNIT OVERVIEW'!H1:H1500"];
function fixture(){
 const historic=parseEquipmentCsv([
  'ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip',
  '11,Ranger 011,10,Synthetic Builders,Ranger,11 Fixture St,Houston,TX,77064',
  '12,Ranger 012,20,Cameras OnSite,Ranger,12 Fixture St,Houston,TX,77064',
  '13,Ranger 013,10,Synthetic Builders,Ranger,13 Fixture St,Houston,TX,77064',
  '14,Ranger 014,20,Cameras OnSite,Ranger,14 Fixture St,Houston,TX,77064'
 ].join('\n'));
 const current=structuredClone(historic);
 current[1].placement='FIELD';current[1].customer='Different Synthetic Builders';
 const values=[
  [['EQUIPMENT TYPE','UNIT #','PLACEMENT','LIVE STATUS','CUSTOMER'],...historic.map(x=>['RANGERS',x.unitNumber,x.placement,'UNKNOWN',x.customer])],
  [['MHELP EQUIPMENT ID'],...historic.map(x=>[x.productId])],
  [['TRACKER PLACEMENT','MHELP PLACEMENT'],...historic.map(x=>[x.placement,x.placement])],
  [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],...historic.map(x=>['RANGERS|'+x.unitNumber,x.productId])],
  [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],...historic.map(x=>[x.unitNumber,x.customer])],
  [['MHELP SOURCE EXPORT'],...historic.map(()=>[filename])],
  [['IP'],['8.8.8.8'],['1.1.1.1'],['9.9.9.9'],[]]
 ].map((v,i)=>({range:ranges[i],majorDimension:'ROWS',values:v}));
 const accepted={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',
  sourceSha256:hash,receivedAt:at,source:'mhelpdesk_api',lastApiReadAt:at,
  summary:{totalRecords:4,fieldRecords:3,shopRecords:1,unflaggedFieldRecords:3,doNotUseRecords:0,missingRecords:0},
  records:current.map(r=>({productId:r.productId,recordId:'mhelp_product:'+r.productId,placement:r.placement,uploadLifecycle:r.lifecycle}))};
 return {values,current,historic,accepted};
}
const endpoint=(id,ip,online)=>({deviceId:id,publicIp:ip,expectedPorts:[80],monitoringEnabled:true,connectionRevision:2,
 portStatus:{80:{online,attempted:true},_connection:{ip,revision:2,checkedAt:at,status:online?'online':'offline',reachable:online}}});
const devices=[endpoint(101,'8.8.8.8',true),endpoint(102,'1.1.1.1',true),endpoint(103,'9.9.9.9',false)];
const verify=f=>verify2027ConnectionCensus(f.values,ranges,f.current,hash,at);
import {isTrackerSourceLabel} from '../src/trackerSourceLabel.ts';
const apiLabel='MHelpDesk pull accepted 2026-11-04 06:36 CT';
function apiFixture(){const f=fixture();for(const row of f.values[5].values.slice(1))row[0]=apiLabel;return f;}
test('actual API pull provenance is accepted without inventing a CSV filename',async()=>{
 const f=apiFixture(),proof=await verify(f);
 assert.equal(proof.sourceExport,apiLabel);assert.equal(proof.records.length,4);
 const result=buildExactProductConnections(f.accepted,proof,devices,now,new Map([['11',['101']],['13',['103']]]));
 assert.deepEqual(result.items.map(p=>[p.productId,p.status]),[['11','online'],['12','unknown'],['13','offline']]);
 assert.deepEqual(proof.records[1].reviewReasons,['placement_mismatch','customer_mismatch']);
});
test('legacy CSV labels continue to be accepted',async()=>{
 assert.equal(isTrackerSourceLabel(filename),true);assert.equal((await verify(fixture())).sourceExport,filename);
});
test('API labels require the exact format and a real calendar date',()=>{
 for(const value of [null,{},'',apiLabel+' ',apiLabel+'\n','MHelpDesk pull accepted 2026-02-30 06:36 CT','MHelpDesk pull accepted 2026-11-04 25:36 CT','MHelpDesk pull accepted 2026-11-04 06:60 CT','MHelpDesk pull accepted 2026-11-04 06:36 UTC','MHelpDesk pull accepted yesterday','<script>'])assert.equal(isTrackerSourceLabel(value),false,JSON.stringify(value));
 assert.equal(isTrackerSourceLabel('MHelpDesk pull accepted 2028-02-29 00:00 CT'),true);
});
test('mixed source labels cannot certify one census',async()=>{
 for(const label of [filename,'MHelpDesk pull accepted 2026-11-04 06:37 CT']){const f=apiFixture();f.values[5].values[2][0]=label;await assert.rejects(verify(f));}
});
test('API label does not weaken exact Product ID and row/column guards',async()=>{
 for(const mutate of [f=>f.values[1].values[2][0]='11',f=>f.values[3].values.pop(),f=>f.values[3].values[1][0]='RANGERS|Wrong 999',f=>f.values[6].range="'UNIT OVERVIEW'!I1:I1500",f=>f.current.push({...f.current[0]})]){const f=apiFixture();mutate(f);await assert.rejects(verify(f));}
});
test('shared-IP ownership remains held for API provenance',async()=>{
 const f=apiFixture();f.values[6].values[2]=['8.8.8.8'];
 const result=buildExactProductConnections(f.accepted,await verify(f),devices,now,new Map([['11',['101']],['13',['103']]]));
 assert.equal(result.items[0].status,'unknown');assert.equal(result.items[2].status,'offline');
});
test('API label never bypasses stale timestamps or source-hash mismatch',async()=>{
 const f=apiFixture(),proof=await verify(f),members=new Map([['11',['101']],['13',['103']]]);
 assert.equal(buildExactProductConnections(f.accepted,{...proof,expectedMhelpSourceSha256:'b'.repeat(64)},devices,now,members),null);
 assert.equal(buildExactProductConnections(f.accepted,{...proof,verifiedAt:new Date(now-31*60000).toISOString()},devices,now,members),null);
 assert.equal(buildExactProductConnections(f.accepted,{...proof,sourceExport:'unvalidated label'},devices,now,members),null);
});
