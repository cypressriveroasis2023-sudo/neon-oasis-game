import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGoogleSheetWire} from '../../supabase/functions/cos-operational-sheets-sync/wire.ts';

test('Google omitted offsets and hidden defaults normalize without mutating source',()=>{
 const source={spreadsheetId:'one',sheets:[{properties:{title:'RANGERS',sheetId:3,sheetType:'GRID',gridProperties:{columnCount:65,rowCount:1018}},data:[{rowData:[{values:[{userEnteredValue:{stringValue:'RANGER 007'}}]}]}]}]};
 const before=JSON.stringify(source),result=normalizeGoogleSheetWire(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(result.sheets[0].data[0].startColumn,0);
 assert.equal(result.sheets[0].data[0].startRow,0);
 assert.equal(result.sheets[0].properties.hidden,false);
 assert.deepEqual(result.sheets[0].data[0].rowData,source.sheets[0].data[0].rowData);
});
test('property order cannot fabricate a workbook-layout change',()=>{
 const a={sheets:[{properties:{sheetId:3,title:'RANGERS',gridProperties:{rowCount:4,columnCount:65}}}]};
 const b={sheets:[{properties:{gridProperties:{columnCount:65,rowCount:4},title:'RANGERS',hidden:false,sheetId:3}}]};
 assert.deepEqual(normalizeGoogleSheetWire(a),normalizeGoogleSheetWire(b));
});
test('actual column shifts, hidden tabs, formulas and Product IDs are not repaired or discarded',()=>{
 const formula={formulaValue:'=SENSITIVE()'},source={sheets:[{properties:{sheetId:3,title:'RANGERS',hidden:true},data:[{startColumn:7,startRow:3,rowData:[{values:[{userEnteredValue:formula}]}]}]}]};
 const result=normalizeGoogleSheetWire(source);
 assert.equal(result.sheets[0].properties.hidden,true);
 assert.equal(result.sheets[0].data[0].startColumn,7);
 assert.equal(result.sheets[0].data[0].startRow,3);
 assert.deepEqual(result.sheets[0].data[0].rowData[0].values[0].userEnteredValue,formula);
});
test('malformed or nonspreadsheet upstream replies stay malformed for strict validation',()=>{
 for(const value of [null,[],{},'error',{sheets:[null,{properties:null}]}]) assert.deepEqual(normalizeGoogleSheetWire(value),value);
});
