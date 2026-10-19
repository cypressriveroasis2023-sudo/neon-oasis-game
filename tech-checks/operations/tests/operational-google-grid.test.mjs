import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationalRanges,readOperationalWorkbook} from '../../supabase/functions/cos-operational-sheets-sync/googleGrid.ts';
import {COS_2027_WORKBOOK,OPERATIONAL_SHEETS_TABS} from '../../supabase/functions/cos-sheets-placement-publish/operationalSyncModel.ts';
const headers=['UNIT #','PLACEMENT','CUSTOMER','SITE / PROJECT','PHYSICAL ADDRESS'];
const pole=['Unit','Status','Customer','Site Name / Project','Location / Address'];
const vals=['FIELD','Builder','Site Alpha','400 Builder St, Houston TX'];
const value=(text)=>({userEnteredValue:{stringValue:text}});
function workbook(){
 const equipment=OPERATIONAL_SHEETS_TABS.map((tab,i)=>{
  const label=tab.title==='SOLAR POLES & SKIDS'?'Solar Pole 72 001':tab.title+' 001';
  const p={sheetId:tab.id,title:tab.title,sheetType:'GRID',hidden:false,gridProperties:{rowCount:8,columnCount:80}};
  const h=tab.title==='SOLAR POLES & SKIDS'?pole:headers;
  const data=tab.columns.map((c,j)=>({startRow:0,startColumn:c,rowData:[
    {values:[value(h[j])]},{values:[value(j===0?label:vals[j-1])]}
  ]}));
  return {properties:p,data,label};
 });
 const index={properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',hidden:false,gridProperties:{rowCount:20,columnCount:8}},data:[
  {startRow:0,startColumn:0,rowData:[{values:[value('TRACKER MATCH KEY')]},...equipment.map(s=>({values:[value(s.properties.title+'|'+s.label)]}))]},
  {startRow:0,startColumn:1,rowData:[{values:[value('MHELP EQUIPMENT ID')]},...equipment.map((_,i)=>({values:[value(String(i+101))]}))]}
 ]};
 return {metadata:{spreadsheetId:COS_2027_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[...equipment,index].map(x=>({properties:x.properties}))},
 grid:{spreadsheetId:COS_2027_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[...equipment,index]},equipment};
}
test('bounded Sheet reader recognizes exactly 12 equipment tabs and Product-ID index, not LIVE STATUS or gate codes',()=>{
 const {metadata,grid}=workbook();
 const ranges=operationalRanges(metadata);
 assert.equal(ranges.length,62);
 assert.equal(ranges.filter(r=>r.includes('MHELP MATCH INDEX')).length,2);
 assert.ok(ranges.every(r=>!/PASSWORDS|MOVEMENT LOG/.test(r)));
 const actual=readOperationalWorkbook(metadata,grid);
 assert.equal(actual.count,12);
 assert.equal(actual.index.length,12);
 assert.equal(actual.sheet.length,12);
 assert.equal(new Set(actual.index.map(x=>x.productId)).size,12);
 assert.equal(actual.sheet.find(x=>x.sheetId===828079282).fields.address,'400 Builder St, Houston TX');
});
test('index edits, duplicate Product IDs, shifted columns, formulas and wrong workbook all fail closed',()=>{
 const first=workbook();
 first.grid.sheets.at(-1).data[1].rowData[2].values[0]=value('101');
 assert.throws(()=>readOperationalWorkbook(first.metadata,first.grid),/Duplicate/);
 const shifted=workbook();shifted.grid.sheets[0].data[0].startColumn=2;
 assert.throws(()=>readOperationalWorkbook(shifted.metadata,shifted.grid),/Tracker column range changed/);
 const formula=workbook();
 formula.grid.sheets[0].data[1].rowData[1].values[0]={userEnteredValue:{formulaValue:'=IMPORTRANGE("secret","A1")'}};
 assert.throws(()=>readOperationalWorkbook(formula.metadata,formula.grid),/Formula|Unsafe/);
 const wrong=workbook();wrong.metadata.spreadsheetId='another-workbook';
 assert.throws(()=>operationalRanges(wrong.metadata),/Wrong tracker workbook/);
 const missing=workbook();missing.grid.sheets[0].data[0].rowData.pop();
 assert.throws(()=>readOperationalWorkbook(missing.metadata,missing.grid),/Not every Product ID/);
});
