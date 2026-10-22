import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
const sha='a'.repeat(64),stageId='11111111-1111-4111-8111-111111111111';
const address={street:'Shop postal address',city:'Houston',state:'TX',zip:'77064'};
const item={productId:'2229931',unitNumber:'Solar Stand 015',before:{placement:'FIELD',customer:'Old customer',customerId:'100',address},after:{placement:'SHOP',customer:'Cameras OnSite',customerId:'200',address},identity:{nativeUnitId:null,nativeLabel:null,trackerId:'existing-tracker',trackerLabel:'Solar Stand 72 015'},current:{nativePlacement:null,nativeStatus:null,internalTrackerPlacement:'FIELD',internalTrackerCustomer:'Old customer',internalTrackerSite:'Old site',gpsPresent:false,shopReceiptId:null,shopRecordedAt:null},guardChanged:false,eligible:true,blocker:null};
test('Owner must inspect and explicitly approve exact assignment identities before final source Apply',async({page})=>{
 const {app}=await mountFleet(page,false,{features:{ownerEquipmentImportEnabled:true}});let approvals=0,commits=0;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();const request=route.request().postDataJSON();if(!request.path.startsWith('/api/mhelpdesk/equipment/'))return route.fallback();
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173'};let data;
  if(request.path.endsWith('/preview'))data={contract:'COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1',previewOnly:true,readyToCommit:false,sourceSha256:sha,inventory:{total:1,field:0,shop:1,inactive:0},changes:{unchanged:0,added:0,absent:0,placement:1,customer:1,address:1,identityReview:0},samples:[],censusStatus:'verified',admission:{counts:{unchanged:0,assignment_change:1,new_source_only:0},totalHeld:1},guardNotice:'Current identity review required'};
  if(request.path.endsWith('/stage'))data={contract:'COS_OWNER_EQUIPMENT_STAGE_V1',stageId,sourceSha256:sha,productIdsMatched:1,recordedField:0,recordedShop:1,expiresInMinutes:60,previewOnly:true,readyToCommit:false};
  if(request.path.endsWith('/assignments')){if(request.body.action==='approve'){approvals++;expect(request.body.reviewDigest).toBe('d'.repeat(64));}data={contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1',stageId,sourceSha256:sha,censusSha256:'c'.repeat(64),reviewDigest:'d'.repeat(64),approved:request.body.action==='approve',items:[item]};}
  if(request.path.endsWith('/commit')){commits++;data={contract:'COS_OWNER_EQUIPMENT_COMMIT_V1',sourceSha256:sha,records:1,field:0,shop:1,applied:true};}
  return route.fulfill({headers,json:data});
 });
 await app.getByRole('button',{name:'Data sources',exact:true}).click();
 await app.getByLabel('Original mHelpDesk equipment CSV').setInputFiles({name:'ServiceItem_List_20261020172623.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic complete CSV')});
 await app.getByRole('button',{name:'Preview equipment changes'}).click();await app.getByRole('button',{name:'Stage reviewed inventory (no Fleet changes)'}).click();
 const apply=app.getByRole('button',{name:'Apply reviewed source through protected COS backend'});await expect(apply).toBeDisabled();
 await app.getByRole('button',{name:'Review current assignment identities'}).click();const review=app.getByRole('region',{name:'Review existing equipment assignments'});
 await expect(review).toContainText('Product 2229931');await expect(review).toContainText('None — tracker-only');await expect(review).toContainText('Old customer');await expect(review).toContainText('Cameras OnSite');
 const approve=review.getByRole('button',{name:'Approve these assignments for this stage'});await expect(approve).toBeDisabled();
 await review.getByRole('checkbox').check();await review.getByRole('textbox').fill('I confirm this exact tracker identity and Shop assignment.');await approve.click();await expect(review).toContainText('Assignment review recorded');
 await expect(apply).toBeDisabled();await app.getByRole('checkbox',{name:/I reviewed the changed/}).check();await app.getByLabel('Owner approval note (at least 24 characters)').fill('I approve the complete reviewed source and identity transitions.');await apply.click();
 await expect(app.getByRole('status').filter({hasText:'Committed source receipt verified'})).toBeVisible();expect(approvals).toBe(1);expect(commits).toBe(1);
});

test('large continuity review stays compact, exposes the exact manifest, and keeps Apply held after a 409 or blocked evidence',async({page})=>{
 const {assignmentContinuityItems}=await import('./fixtures/assignment-continuity-ui.mjs');
 const items=assignmentContinuityItems(item),{app}=await mountFleet(page,false,{features:{ownerEquipmentImportEnabled:true}});let approvals=0,stages=0,blocked=false;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();const request=route.request().postDataJSON();if(!request.path.startsWith('/api/mhelpdesk/equipment/'))return route.fallback();
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173'};let data;
  if(request.path.endsWith('/preview'))data={contract:'COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1',previewOnly:true,readyToCommit:false,sourceSha256:sha,inventory:{total:1001,field:284,shop:717,inactive:0},changes:{unchanged:996,added:0,absent:0,placement:5,customer:5,address:1,identityReview:0},samples:[],censusStatus:'verified',admission:{counts:{unchanged:996,assignment_change:5,new_source_only:0},totalHeld:352},guardNotice:'Current evidence review required'};
  if(request.path.endsWith('/stage')){stages++;data={contract:'COS_OWNER_EQUIPMENT_STAGE_V1',stageId,sourceSha256:sha,productIdsMatched:1001,recordedField:284,recordedShop:717,expiresInMinutes:60,previewOnly:true,readyToCommit:false};}
  if(request.path.endsWith('/assignments')){
   if(request.body.action==='approve'){approvals++;expect(request.body.reviewDigest).toBe('d'.repeat(64));blocked=true;return route.fulfill({headers,status:409,json:{error:'The equipment source or assignment evidence changed. Refresh the Owner review before continuing.'}});}
   data={contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1',stageId,sourceSha256:sha,censusSha256:'c'.repeat(64),reviewDigest:'d'.repeat(64),approved:false,items:items.map((r,i)=>blocked&&i===100?{...r,eligible:false,continuity:null,blocker:'Current link evidence is ambiguous'}:r)};
  }
  if(request.path.endsWith('/commit'))throw Error('Final Apply must remain held');
  return route.fulfill({headers,json:data});
 });
 await app.getByRole('button',{name:'Data sources',exact:true}).click();
 await app.getByLabel('Original mHelpDesk equipment CSV').setInputFiles({name:'ServiceItem_List_20261020172623.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic complete CSV')});
 await app.getByRole('button',{name:'Preview equipment changes'}).click();await app.getByRole('button',{name:'Stage reviewed inventory (no Fleet changes)'}).click();
 await app.getByRole('button',{name:'Review current assignment identities'}).click();const review=app.getByRole('region',{name:'Review existing equipment assignments'});
 await expect(review).toContainText('5 CSV assignment changes');await expect(review).toContainText('344 timestamp-only evidence references');await expect(review).toContainText('8 historical assignment differences');await expect(review).toContainText('352 unique Product IDs');
 await expect(review.locator('article[data-assignment-product]')).toHaveCount(11);await expect(review.locator('[data-assignment-product="2229931"]')).toHaveCount(1);
 await expect(review.getByRole('table',{name:'Timestamp-only Product ID manifest'})).toHaveCount(0);
 await review.locator('summary').click();const manifest=review.getByRole('table',{name:'Timestamp-only Product ID manifest'});await expect(manifest.locator('tbody tr')).toHaveCount(344);
 await expect(manifest.locator('tbody tr').first()).toContainText('2226860');await expect(manifest.locator('tbody tr').first()).toContainText('2026-10-13T10:00:00Z');await expect(manifest.locator('tbody tr').first()).toContainText('2026-10-20T17:36:07.336985+00:00');await expect(manifest.locator('tbody tr').first()).toContainText('00000000-0000-4000-8000-000000000001');
 await review.locator('summary').click();await expect(manifest).toHaveCount(0);
 const approve=review.getByRole('button',{name:'Approve these assignments for this stage'});await expect(approve).toBeDisabled();
 await review.getByRole('checkbox').check();await review.getByRole('textbox').fill('I reviewed the continuity manifest and each historical assignment difference.');await approve.click();
 await expect(app.getByRole('alert').filter({hasText:'Refresh the Owner review'})).toBeVisible();await expect(app.getByRole('button',{name:'Apply reviewed source through protected COS backend'})).toBeDisabled();expect(approvals).toBe(1);expect(stages).toBe(1);
 await app.getByRole('button',{name:'Review current assignment identities'}).click();await expect(review.getByRole('alert')).toContainText('Product 7000100: Current link evidence is ambiguous');
 await review.getByRole('checkbox').check();await review.getByRole('textbox').fill('This note cannot authorize an unresolved current identity blocker.');await expect(approve).toBeDisabled();expect(approvals).toBe(1);
});

test('failed source proof shows safe diagnostics and keeps Stage hidden until a fresh verified preview',async({page})=>{
 const {app}=await mountFleet(page,false,{features:{ownerEquipmentImportEnabled:true}});let verified=false,writes=0;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();
  const request=route.request().postDataJSON();if(!request.path.startsWith('/api/mhelpdesk/equipment/'))return route.fallback();
  if(!request.path.endsWith('/preview')){writes++;return route.abort();}
  return route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{contract:'COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1',previewOnly:true,readyToCommit:false,sourceSha256:sha,inventory:{total:1001,field:284,shop:717,inactive:0},changes:{unchanged:1001,added:0,absent:0,placement:0,customer:0,address:0,identityReview:0},samples:[],censusStatus:verified?'verified':'unavailable',...(!verified?{censusFailureReason:'The tracker source-export evidence is incomplete or cites a different export. Reconcile the current source explicitly; preserve historical evidence.'}:{}),admission:{counts:{unchanged:1001,assignment_change:0,new_source_only:0},totalHeld:0},guardNotice:'Explicit Owner review required'}});
 });
 await app.getByRole('button',{name:'Data sources',exact:true}).click();
 await app.getByLabel('Original mHelpDesk equipment CSV').setInputFiles({name:'ServiceItem_List_20261022134456.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic complete CSV')});
 await app.getByRole('button',{name:'Preview equipment changes'}).click();
 await expect(app.getByText(/The tracker source-export evidence/)).toBeVisible();
 await expect(app.getByRole('button',{name:'Stage reviewed inventory (no Fleet changes)'})).toHaveCount(0);
 verified=true;await app.getByRole('button',{name:'Preview equipment changes'}).click();
 await expect(app.getByRole('button',{name:'Stage reviewed inventory (no Fleet changes)'})).toBeEnabled();
 await expect(app.getByText(/The tracker source-export evidence/)).toHaveCount(0);expect(writes).toBe(0);
});
