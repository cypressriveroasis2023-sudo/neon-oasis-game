import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {OPERATIONAL_SHEETS_TABS,planOperationalSync,COS_OPERATIONAL_SHEETS_SYNC} from '../../supabase/functions/cos-sheets-placement-publish/operationalSyncModel.ts';
const field={placement:'FIELD',customer:'Builder',site:'Construction site',address:'300 Main St, Houston, TX 77002'};
const shop={placement:'SHOP',customer:'Cameras OnSite',site:'SHOP',address:'9949 W Sam Houston Pkwy N, Houston, TX 77064'};
const label='Ranger 028';
const ID='1947767';
const key='RANGERS|'+label;
const item={key,productId:ID};
const tab=OPERATIONAL_SHEETS_TABS.find(t=>t.title==='RANGERS');
const row={sheetId:tab.id,row:24,label,fields:field};
const mirror={productId:ID,sheetId:row.sheetId,row:24,label,revision:1,fields:field};
const pending={productId:ID,requestId:randomUUID(),revision:2,fields:shop};

test('all twelve current equipment tabs are scoped and the 2027 LIVE STATUS column is never a placement write',()=>{
 assert.equal(OPERATIONAL_SHEETS_TABS.length,12);
 assert.equal(new Set(OPERATIONAL_SHEETS_TABS.map(t=>t.id)).size,12);
 for(const t of OPERATIONAL_SHEETS_TABS){
  assert.equal(t.columns.length,5);
  assert.equal(t.columns[0],0);
  assert.equal(t.columns.includes(2),t.title==='SOLAR POLES & SKIDS');
  assert.deepEqual(t.title==='SOLAR POLES & SKIDS'?t.columns:[...t.columns],[0,...(t.title==='SOLAR POLES & SKIDS'?[5,4,2,3]:[1,3,4,5])]);
 }
 assert.equal(OPERATIONAL_SHEETS_TABS.find(t=>t.title==='STANDS').id,1900162010);
 assert.equal(OPERATIONAL_SHEETS_TABS.find(t=>t.title==='WALL-E').id,1900162011);
});
test('first read boots a mirror without treating preexisting differences as incoming owner intent',()=>{
 const plan=planOperationalSync([item],[row],[],[]);
 assert.equal(plan.contract,COS_OPERATIONAL_SHEETS_SYNC);
 assert.equal(plan.coverage,1);assert.equal(plan.bootstrap.length,1);
 assert.equal(plan.inbound.length,0);assert.equal(plan.outbound.length,0);
});
test('COS Field-to-Shop sends only after the exact Sheet baseline still matches',()=>{
 const plan=planOperationalSync([item],[row],[mirror],[pending]);
 assert.equal(plan.outbound.length,1);
 assert.deepEqual(plan.outbound[0].columns,[0,1,3,4,5]);
 assert.equal(plan.outbound[0].newFields.placement,'SHOP');
 assert.equal(plan.inbound.length,0);
});
test('already published writes acknowledge readback and do not echo a second inbound move',()=>{
 const plan=planOperationalSync([item],[{...row,fields:shop}],[mirror],[pending]);
 assert.equal(plan.alreadyPublished.length,1);assert.equal(plan.outbound.length,0);assert.equal(plan.inbound.length,0);
});
test('manual tracker Field-to-Shop edit produces an inbound proposal only when there is no pending COS write',()=>{
 const plan=planOperationalSync([item],[{...row,fields:shop}],[mirror],[]);
 assert.equal(plan.inbound.length,1);
 assert.equal(plan.inbound[0].productId,ID);
 assert.equal(plan.inbound[0].expectedMirrorRevision,1);
 assert.equal(plan.inbound[0].newFields.placement,'SHOP');
 assert.equal(plan.outbound.length,0);
});
test('concurrent edits hold rather than picking arbitrary winner',()=>{
 const edited={...field,customer:'Another Builder'};
 const plan=planOperationalSync([item],[{...row,fields:edited}],[mirror],[pending]);
 assert.deepEqual(plan.held,[{productId:ID,reason:'concurrent_sheet_edit_conflicts_with_cos_move'}]);
 assert.equal(plan.inbound.length,0);assert.equal(plan.outbound.length,0);
});
test('duplicate Product ID, duplicate tab/label and formula-backed operational fields fail closed',()=>{
 assert.throws(()=>planOperationalSync([item,item],[row],[],[]),/Duplicate/);
 assert.throws(()=>planOperationalSync([item],[row,row],[],[]),/Duplicate/);
 const plan=planOperationalSync([item],[{...row,formula:true}],[],[]);
 assert.deepEqual(plan.held,[{productId:ID,reason:'unsafe_or_formula_fields'}]);
});
test('row movement invalidates mirror location rather than writing a different cell',()=>{
 const plan=planOperationalSync([item],[{...row,row:200}],[mirror],[pending]);
 assert.deepEqual(plan.held,[{productId:ID,reason:'mirrored_identity_or_row_changed'}]);
 assert.equal(plan.outbound.length,0);
});
test('one exact crosswalk per Product ID across the 12 tabs preserves every family and suffix',()=>{
 const idx=OPERATIONAL_SHEETS_TABS.map((t,i)=>({key:t.title+'|UNIT '+String(i+1).padStart(3,'0')+'HDC4',productId:String(100+i)}));
 const sheet=OPERATIONAL_SHEETS_TABS.map((t,i)=>({sheetId:t.id,row:i+2,label:'UNIT '+String(i+1).padStart(3,'0')+'HDC4',fields:shop}));
 const plan=planOperationalSync(idx,sheet,[],[]);
 assert.equal(plan.bootstrap.length,12);assert.equal(plan.held.length,0);
 assert.equal(plan.coverage,12);
});

test('all 1,001 historical rows may bootstrap while decommissioned and incomplete Field rows remain held',()=>{
 const retired={placement:'DECOMMISSIONED',customer:'Cameras OnSite',site:'',address:''};
 const missingSite={...field,site:''};
 const idx=[item,{key:'SPOTTERS|Spotter 017 - DO NOT USE',productId:'456'},
   {key:'STANDS|ST 174',productId:'789'}];
 const all=[row,{sheetId:2017346590,row:4,label:'Spotter 017 - DO NOT USE',fields:retired},
   {sheetId:1900162010,row:177,label:'ST 174',fields:missingSite}];
 const first=planOperationalSync(idx,all,[],[]);
 assert.equal(first.bootstrap.length,3);
 assert.equal(first.held.length,0);
 const mirror=[mirror,
  {productId:'456',sheetId:2017346590,row:4,label:'Spotter 017 - DO NOT USE',fields:retired,revision:0},
  {productId:'789',sheetId:1900162010,row:177,label:'ST 174',fields:missingSite,revision:0}];
 const later=planOperationalSync(idx,all,mirror,[]);
 assert.equal(later.coverage,3);
 assert.deepEqual(later.held.map(x=>x.productId),['456','789']);
 assert.equal(later.inbound.length,0);
 // The operator supplied the missing site, making exactly that record
 // eligible for inbound revision without inventing a map pin.
 const improved=all.map(x=>x.label==='ST 174'?{...x,fields:{...missingSite,site:'Project corrected'}}:x);
 const after=planOperationalSync(idx,improved,mirror,[]);
 assert.deepEqual(after.inbound.map(x=>x.productId),['789']);
 assert.deepEqual(after.held.map(x=>x.productId),['456']);
});
