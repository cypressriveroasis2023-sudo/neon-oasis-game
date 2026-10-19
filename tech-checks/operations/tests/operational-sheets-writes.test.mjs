import test from 'node:test';
import assert from 'node:assert/strict';
import {operationalUpdateCells,verifiedOperationalReadback} from '../../supabase/functions/cos-sheets-placement-publish/operationalSheetsWrites.ts';
import {OPERATIONAL_SHEETS_TABS} from '../../supabase/functions/cos-sheets-placement-publish/operationalSyncModel.ts';
const field={placement:'FIELD',customer:'Builder',site:'Job',address:'10 Old Rd, Houston TX'};
const shop={placement:'SHOP',customer:'Cameras OnSite',site:'SHOP',address:'9949 W Sam Houston Pkwy N, Houston TX'};
const move=(tab,i=24)=>({sheetId:tab.id,row:i,label:'Ranger 028',productId:'123',requestId:'11111111-1111-4111-8111-111111111111',revision:1,oldFields:field,newFields:shop,columns:tab.columns});
test('standard equipment tabs write B,D,E,F only and cannot alter LIVE STATUS or sensitive columns',()=>{
 const x=move(OPERATIONAL_SHEETS_TABS.find(t=>t.title==='RANGERS'));
 const requests=operationalUpdateCells([x]);
 assert.equal(requests.length,4);
 assert.deepEqual(requests.map(r=>r.updateCells.range.startColumnIndex),[1,3,4,5]);
 assert.ok(requests.every(r=>r.updateCells.fields==='userEnteredValue'));
 assert.ok(requests.every(r=>Object.keys(r.updateCells.rows[0].values[0]).join()==='userEnteredValue'));
 const match=verifiedOperationalReadback([x],[{sheetId:x.sheetId,row:x.row,label:x.label,fields:shop}]);
 assert.equal(match[0].state,'published');
});
test('special Solar Pole rows update Status F, Customer E, Site C, Address D without touching gate codes',()=>{
 const x=move(OPERATIONAL_SHEETS_TABS.find(t=>t.title==='SOLAR POLES & SKIDS'));
 const requests=operationalUpdateCells([x]);
 assert.deepEqual(requests.map(r=>r.updateCells.range.startColumnIndex),[5,4,2,3]);
});
test('failed readback never marks an outbox item published',()=>{
 const x=move(OPERATIONAL_SHEETS_TABS[0]);
 assert.equal(verifiedOperationalReadback([x],[{sheetId:x.sheetId,row:x.row,label:x.label,fields:field}])[0].state,'readback_mismatch');
 assert.equal(verifiedOperationalReadback([x],[{sheetId:x.sheetId,row:x.row,label:'Other',fields:shop}])[0].state,'readback_mismatch');
 assert.equal(verifiedOperationalReadback([x],[])[0].state,'readback_mismatch');
});
test('repeated Product IDs, formulas, unsupported columns and injection are rejected',()=>{
 const x=move(OPERATIONAL_SHEETS_TABS[0]);
 assert.throws(()=>operationalUpdateCells([x,x]),/uniquely verified/);
 assert.throws(()=>operationalUpdateCells([{...x,columns:[0,2,3,4,5]}]),/uniquely verified/);
 assert.throws(()=>operationalUpdateCells([{...x,newFields:{...shop,customer:'=HYPERLINK()'}}]),/Unsafe/);
});
