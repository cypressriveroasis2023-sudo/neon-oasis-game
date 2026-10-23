import test from 'node:test';
import assert from 'node:assert/strict';
import {publisherRefreshCandidates,planPublishing,snapshotCell,tabLayout,trackerRanges,projectTracker,UNIT_TRACKER_WORKBOOK} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
import {createPublisherHandler} from '../../supabase/functions/cos-sheets-placement-publish/index.ts';
import {TRACKER_TABS} from '../../supabase/functions/cos-operations-pages/googleSheets.ts';
const cell=(s,validation=null)=>snapshotCell({userEnteredValue:{stringValue:s},...(validation?{dataValidation:validation}:{})});
const base=[cell('Spotter 023.1'),cell('FIELD'),cell('Synthetic Builder'),cell('Synthetic Job')];
const observation={equipmentId:'123',state:'confirmed',placement:'SHOP',customerId:'2',serviceLocationId:null,customerLabel:'Cameras Onsite LLC',siteLabel:'SHOP'};
const binding={equipmentId:'123',sheetId:2017346590,row:2,label:'Spotter 023.1',baseline:base,pending:null,observation,sourceCurrent:true};
const row={sheetId:binding.sheetId,row:binding.row,label:binding.label,unique:true,cells:base};
const request=(body={action:'run'})=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('the publisher writes exactly the three approved cells, including the separate solar-pole layout',()=>{
 for(const [sheetId,cols] of [[2017346590,[1,3,4]],[828079282,[5,4,2]]]){
  const b={...binding,sheetId},r={...row,sheetId};const p=planPublishing([b],[r]);
  assert.equal(p.intents.length,1);assert.deepEqual(p.requests.map(x=>x.updateCells.range.startColumnIndex),cols);
  for(const x of p.requests){assert.equal(x.updateCells.fields,'userEnteredValue');assert.equal(x.updateCells.range.endRowIndex-x.updateCells.range.startRowIndex,1);assert.equal(x.updateCells.range.endColumnIndex-x.updateCells.range.startColumnIndex,1);assert.equal(x.updateCells.rows[0].values.length,1);}
 }
 assert.equal(planPublishing([binding],[row]).intents[0].cells[0],base[0]);
});
test('manual edits, row movement, duplicate labels, source holds and native guard changes cannot publish',()=>{
 const cases=[[binding,{...row,cells:[base[0],base[1],base[2],cell('Technician job')]}], [binding,{...row,row:3}], [binding,{...row,unique:false}], [{...binding,sourceCurrent:false},row], [{...binding,observation:{state:'held'}},row], [binding,{...row,label:'Spotter 023'}]];
 for(const [b,r] of cases){const p=planPublishing([b],[r]);assert.equal(p.requests.length,0);assert.equal(p.results[0].state,'held');}
 assert.throws(()=>planPublishing([binding,binding],[row]),/bindings/);
});
test('formulas, chips, unsupported validation and invalid dropdown values are held; existing equivalent Shop names are retained',()=>{
 const badCells=[snapshotCell({userEnteredValue:{formulaValue:'=1'}}),snapshotCell({userEnteredValue:{stringValue:'FIELD'},chipRuns:[{}]}),cell('FIELD',{condition:{type:'ONE_OF_RANGE',values:[{userEnteredValue:'Other!A:A'}]}}),cell('FIELD',{condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'FIELD'}]}})];
 for(const bad of badCells){const cells=[base[0],bad,base[2],base[3]],p=planPublishing([{...binding,baseline:cells}],[{...row,cells}]);assert.equal(p.requests.length,0);}
 const validation={condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'FIELD'},{userEnteredValue:'SHOP'}]}};
 const cells=[base[0],cell('FIELD',validation),base[2],base[3]];assert.equal(planPublishing([{...binding,baseline:cells}],[{...row,cells}]).requests.length,3);
 const shop=[base[0],cell('SHOP'),cell('Cameras Onsite'),cell('Main COS Shop')];const p=planPublishing([{...binding,baseline:shop}],[{...row,cells:shop}]);assert.equal(p.requests.length,0);assert.equal(p.results[0].state,'unchanged');
});
test('ambiguous failed writes are recoverable only from exact intended readback; changed pending assignments remain held',()=>{
 const intended=planPublishing([binding],[row]).intents[0].cells;
 const b={...binding,pending:intended};assert.equal(planPublishing([b],[{...row,cells:intended}]).results[0].state,'recovered');
 assert.equal(planPublishing([b],[row]).requests.length,3);
 const changed={...b,observation:{...observation,placement:'FIELD',customerLabel:'New Builder',siteLabel:'New Job'}};
 assert.equal(planPublishing([changed],[row]).results[0].reason,'pending_write_changed');
});
test('metadata reads only identity/placement/customer/site columns and reject layout changes and global duplicates',()=>{
 const metadata={spreadsheetId:UNIT_TRACKER_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:TRACKER_TABS.map(t=>({properties:{sheetId:t.id,title:t.title,sheetType:'GRID',gridProperties:{rowCount:10,columnCount:12}}}))};
 const ranges=trackerRanges(metadata);assert.equal(ranges.length,40);assert(ranges.every(x=>!x.includes('!G')&&!x.includes('!H')));assert(ranges.includes("'SOLAR POLES & SKIDS'!F1:F10"));assert(!ranges.includes("'SOLAR POLES & SKIDS'!B1:B10"));
 const narrow=trackerRanges(metadata,[binding]);assert(narrow.includes("'SPOTTERS'!A1:A10"));assert(narrow.includes("'SPOTTERS'!B1:B2"));assert(narrow.includes("'HELIOS'!B1:B1"));
 const grid={...metadata,sheets:metadata.sheets.map(s=>({...s,data:tabLayout(s.properties.sheetId).columns.map((col,i)=>({startColumn:col,rowData:[{values:[{userEnteredValue:{stringValue:tabLayout(s.properties.sheetId).headers[i]}}]},{values:[{userEnteredValue:{stringValue:i===0?'Duplicate label':'FIELD'}}]}]}))}))};
 assert.equal(projectTracker(metadata,grid).filter(x=>x.unique).length,0);
 assert.throws(()=>trackerRanges({...metadata,spreadsheetId:'other'}),/workbook/);
 const altered=structuredClone(grid);altered.sheets[0].properties.title='Changed';assert.throws(()=>projectTracker(metadata,altered),/changed/);
});
test('authentication and bounded request parsing precede any Google/database work',async()=>{
 let calls=0;const rpc=async()=>{calls++;throw Error('secret token');};const read=async()=>{calls++;return[];},write=async()=>{calls++;};
 const denied=createPublisherHandler({authenticate:async()=>false,rpc,read,write});assert.equal((await denied(request())).status,403);assert.equal(calls,0);
 const h=createPublisherHandler({authenticate:async()=>true,rpc,read,write});
 for(const v of [{action:'run',workbookId:'other'},{action:'run',token:'private'},{action:'publish'}])assert.equal((await h(request(v))).status,400);
 assert.equal(calls,0);const r=await h(request());assert.equal(r.status,503);assert(!((await r.text()).includes('secret')));
});
test('a changed second read prevents staging and all writes; source refusal also prevents Google POST',async()=>{
 for(const changedSheet of [true,false]){
  let reads=0,writes=0,stages=0,failed=0;
  const h=createPublisherHandler({authenticate:async()=>true,rpc:async name=>{if(name.endsWith('begin'))return {leaseId:'lease',bindings:[binding]};if(name.endsWith('stage')){stages++;return {committed:false};}if(name.endsWith('fail')){failed++;return null;}throw Error('Unexpected call');},read:async()=>{reads++;return[{...row,...(changedSheet&&reads===2?{cells:[base[0],base[1],base[2],cell('Manual job')]}:{})}];},write:async()=>{writes++;}});
  assert.equal((await h(request())).status,503);assert.equal(writes,0);assert.equal(stages,changedSheet?0:1);assert.equal(failed,1);
 }
});
test('publish requires exact readback; a collaborator change is held and cannot advance the baseline',async()=>{
 for(const correct of [true,false]){
  let reads=0,writes=0,results;
  const expected=planPublishing([binding],[row]).intents[0].cells;
  const h=createPublisherHandler({authenticate:async()=>true,rpc:async(name,body)=>{if(name.endsWith('begin'))return {leaseId:'lease',bindings:[binding]};if(name.endsWith('stage'))return {committed:true};if(name.endsWith('finish')){results=body.p_results;return {committed:true,sheetsPublisher:true};}throw Error('Unexpected call');},read:async()=>{reads++;return[{...row,cells:reads===3?(correct?expected:[base[0],base[1],base[2],cell('Manual job')]):base}];},write:async requests=>{writes++;assert.equal(requests.length,3);}});
  assert.equal((await h(request())).status,200);assert.equal(writes,1);assert.equal(results[0].state,correct?'published':'held');
 }
});

test('only otherwise writable stale changes request evidence; manual corrections and pending writes never do',()=>{
 const stale={...binding,sourceCurrent:false};
 assert.deepEqual(publisherRefreshCandidates([stale],[row]),['123']);
 assert.equal(planPublishing([stale],[row]).requests.length,0);
 for(const b of [{...stale,pending:base},{...stale,observation:{state:'held'}},{...stale,sourceCurrent:true}])assert.deepEqual(publisherRefreshCandidates([b],[row]),[]);
 assert.deepEqual(publisherRefreshCandidates([stale],[{...row,cells:[base[0],base[1],cell('Manual correction'),base[3]]}]),[]);
 assert.deepEqual(publisherRefreshCandidates([stale],[{...row,unique:false}]),[]);
});
