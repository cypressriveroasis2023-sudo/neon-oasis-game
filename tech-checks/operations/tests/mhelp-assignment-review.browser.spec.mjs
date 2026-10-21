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
