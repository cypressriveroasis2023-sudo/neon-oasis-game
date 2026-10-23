import test from 'node:test';import assert from 'node:assert/strict';
import {planPublishing,snapshotCell} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
const cell=s=>snapshotCell({userEnteredValue:{stringValue:s}});
function fixture(customer='Builder A: Job A',site='Job A',placement='FIELD'){
 const b={equipmentId:'123',sheetId:2017346590,row:2,label:'Synthetic Unit',baseline:['Synthetic Unit',placement,customer,site].map(cell),pending:null,customerStyle:'combined',sourceCurrent:true,observation:{equipmentId:'123',state:'confirmed',placement:'FIELD',customerLabel:'Builder A',siteLabel:'Job A'}};
 return {b,row:{sheetId:b.sheetId,row:2,label:b.label,unique:true,cells:b.baseline}};
}
test('unchanged combined labels retain exact spelling',()=>{const {b,row}=fixture('Builder A:  Job A');assert.equal(planPublishing([b],[row]).requests.length,0);});
test('same Product ID job-to-job, job-to-Shop and Shop-to-job retain admitted style',()=>{
 for(const [from,to] of [['field','job'],['field','shop'],['shop','job']]){
 const {b,row}=from==='shop'?fixture('Cameras OnSite','SHOP','SHOP'):fixture();
 b.observation={...b.observation,placement:to==='shop'?'SHOP':'FIELD',customerLabel:to==='shop'?'Cameras Onsite LLC':'Builder B',siteLabel:to==='shop'?'SHOP':'Job B'};
 const original=structuredClone(b),plan=planPublishing([b],[row]);assert.equal(plan.intents[0].equipmentId,'123');
 assert.equal(plan.intents[0].cells[2].entered.stringValue,to==='shop'?'Cameras Onsite LLC':'Builder B: Job B');assert.deepEqual(b,original);
 assert(plan.requests.every(x=>[1,3,4].includes(x.updateCells.range.startColumnIndex)));
 }
});
test('plain labels remain plain; stale source and manual edit remain held',()=>{
 const {b,row}=fixture('Builder A');b.customerStyle='plain';assert.equal(planPublishing([b],[row]).requests.length,0);
 b.sourceCurrent=false;assert.equal(planPublishing([b],[row]).results[0].reason,'source_unverified');
 b.sourceCurrent=true;row.cells=[...row.cells.slice(0,2),cell('Manual: Correction'),row.cells[3]];assert.equal(planPublishing([b],[row]).results[0].reason,'manual_sheet_change');
});

test('review planner rejects changed reads and propagates protected destination holds',async()=>{
 const {reviewBindings}=await import('../../supabase/functions/cos-sheets-placement-publish/review.ts');const {b,row}=fixture();b.guardCurrent=true;b.operationalOverride=false;
 const target={...row,row:3},record={productId:'123',holdReason:null,apiAssignment:{fullLabel:b.label},customer:'Builder A: Job A'};
 const input={sourceSha256:'a'.repeat(64),sheetReadAt:'2026-10-23T23:00:00Z',bindings:[b],firstRows:[target],secondRows:[target],index:[{productId:'123',key:'SPOTTERS|'+b.label,name:b.label,customerSite:record.customer}],records:[record]};
 assert.equal(reviewBindings(input).items[0].status,'review_required');assert.equal(reviewBindings(input).executable,false);assert.throws(()=>reviewBindings({...input,secondRows:[]}),/changed/);
 input.bindings.push({...b,equipmentId:'456',row:3,label:'Retained',guardCurrent:false});input.records.push({...record,productId:'456'});input.index.push({...input.index[0],productId:'456',key:'SPOTTERS|Retained'});
 const result=reviewBindings(input);assert(result.items[0].reasons.includes('retained_destination:456'));assert.deepEqual(result.proposedOrder,[]);
});
