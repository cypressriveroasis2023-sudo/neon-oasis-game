import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

const blank={displayName:null,placement:null,customer:null,siteName:null,address:null,deviceLink:null,note:null};
async function open(page,{conflictOnce=false}={}){
 const f=fieldProductFixture(),state={revision:0,record:{...blank},edits:[],posts:[],conflict:conflictOnce};
 const {app}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 const answer=productId=>({contract:'COS_MANUAL_EQUIPMENT_V1',productId,revision:state.revision,auditId:state.edits.at(-1)?.auditId??null,recordedAt:state.edits.at(-1)?.recordedAt??null,recordedBy:state.edits.length?'00000000-0000-4000-8000-000000000001':null,recordedByName:state.edits.length?'Teddy Hopper':null,record:state.record,proof:String(state.revision).padStart(64,'a')});
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const req=route.request().postDataJSON();
  const match=/^\/api\/fleet\/products\/(\d+)\/manual-record(\/history)?$/.exec(req.path||'');if(!match)return route.fallback();
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173'},productId=match[1];
  if(match[2])return route.fulfill({headers,json:{contract:'COS_MANUAL_EQUIPMENT_HISTORY_V1',productId,items:[...state.edits].reverse()}});
  if(req.method==='GET')return route.fulfill({headers,json:answer(productId)});
  state.posts.push(req.body);
  if(state.conflict){state.conflict=false;state.revision++;state.record={...state.record,note:'Changed by someone else'};state.edits.push({auditId:'20000000-0000-4000-8000-000000000009',revision:state.revision,actorId:'x',actorName:'James Martin',recordedAt:'2026-11-11T16:00:00Z',reason:'Other edit',before:blank,after:state.record});
   return route.fulfill({status:409,headers,json:{error:'This record was changed by someone else. Reload it and try again.'}});}
  const before=state.record;state.record={...state.record,...req.body.changes};state.revision++;
  state.edits.push({auditId:req.body.requestId,revision:state.revision,actorId:'00000000-0000-4000-8000-000000000001',actorName:'Teddy Hopper',recordedAt:'2026-11-11T17:00:00Z',reason:req.body.reason,before,after:state.record});
  return route.fulfill({headers,json:{...answer(productId),saved:true,requestId:req.body.requestId,replayed:false,current:true}});
 });
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await board.locator('.cos-equipment-total-cameras .cos-total-status-unverified').click();
 const row=board.locator('.cos-equipment-status-list li').first();
 await row.getByRole('button',{name:'Edit record'}).click();
 const editor=row.getByRole('region',{name:/^Manual record for /});await expect(editor).toContainText('No one has edited this record yet');
 return {state,editor,row};
}
test('Owner or IT can edit a unit from the unverified list, with a reason, and the change is recorded',async({page})=>{
 const {state,editor}=await open(page);
 const save=editor.getByRole('button',{name:'Save record'});await expect(save).toBeDisabled();
 await editor.getByLabel('Placement').selectOption('FIELD');await editor.getByLabel('Unit name').fill('Spotter 052');await editor.getByLabel('Site',{exact:true}).fill('Bastrop: David Weekley');await editor.getByLabel('Address').fill('110 Twistleaf, Buda, TX 78610');
 await expect(save).toBeDisabled();                       // a reason is required
 await editor.getByLabel('Reason for this change').fill('Installed today');await expect(save).toBeEnabled();await save.click();
 await expect(editor.getByRole('status')).toContainText('Saved by Teddy Hopper');await expect(editor).toContainText('Last changed by Teddy Hopper');
 expect(state.posts).toHaveLength(1);const sent=state.posts[0];
 expect(sent.changes).toEqual({displayName:'Spotter 052',placement:'FIELD',siteName:'Bastrop: David Weekley',address:'110 Twistleaf, Buda, TX 78610'});
 expect(sent.reason).toBe('Installed today');expect(sent.expected.revision).toBe(0);expect(sent.requestId).toMatch(/^[a-f0-9-]{36}$/);
 await expect(save).toBeDisabled();                       // nothing left to save
 await editor.getByLabel('Placement').selectOption('SHOP');await editor.getByLabel('Reason for this change').fill('Returned to shop');await save.click();
 await expect(editor).toContainText('change 2');expect(state.posts[1].changes).toEqual({placement:'SHOP'});expect(state.posts[1].expected.revision).toBe(1);
 await editor.getByRole('button',{name:'Show history'}).click();
 const history=editor.getByLabel('Change history');await expect(history.locator('li')).toHaveCount(2);
 await expect(history.locator('li').first()).toContainText('Teddy Hopper');await expect(history.locator('li').first()).toContainText('Returned to shop');await expect(history.locator('li').first()).toContainText('Placement: Field → Shop');
 await expect(history.locator('li').nth(1)).toContainText('Unit name: not set → Spotter 052');
 if(process.env.COS_SHOT)await editor.screenshot({path:process.env.COS_SHOT});
});
test('if someone else saved first, the edit is refused, nothing is overwritten, and reloading shows their change',async({page})=>{
 const {state,editor}=await open(page,{conflictOnce:true});
 await editor.getByLabel('Placement').selectOption('FIELD');await editor.getByLabel('Reason for this change').fill('Installed today');await editor.getByRole('button',{name:'Save record'}).click();
 await expect(editor.getByRole('alert')).toContainText('changed by someone else');await expect(editor.getByRole('alert')).toContainText('Your changes were not saved');
 await expect(editor.getByRole('button',{name:'Save record'})).toBeDisabled();await expect(editor.getByLabel('Placement')).toBeDisabled();
 await editor.getByRole('button',{name:'Reload the record'}).click();
 await expect(editor.getByLabel('Note')).toHaveValue('Changed by someone else');await expect(editor.getByLabel('Placement')).toHaveValue('');await expect(editor.getByLabel('Placement')).toBeEnabled();
 expect(state.posts).toHaveLength(1);
});
test('a saved manual Shop entry moves the unit out of the Field totals on the Fleet screen',async({page})=>{
 const count=async records=>{
  const f=fieldProductFixture(),field={...f.field,manualPlacementOverrides:{contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[],records:records(f)}};
  const {app}=await mountFleet(page,false,{field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
  const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
  await expect(board.locator('.cos-fleet-stat-field strong').first()).toHaveText(/^\d+$/);
  return {field:Number(await board.locator('.cos-fleet-stat-field strong').first().textContent()),shop:Number(await board.locator('.cos-fleet-stat-shop strong').first().textContent()),total:Number(await board.locator('.cos-fleet-stat-total strong').first().textContent())};
 };
 const before=await count(()=>[]);
 const after=await count(f=>[{productId:f.field.uploadInventory.records.find(r=>r.placement==='FIELD').productId,auditId:'10000000-0000-4000-8000-000000000001',revision:1,recordedAt:'2026-11-11T17:00:00Z',recordedByName:'Teddy Hopper',record:{...blank,placement:'SHOP'}}]);
 expect(after.field).toBe(before.field-1);expect(after.shop).toBe(before.shop+1);expect(after.total).toBe(before.total);
});
