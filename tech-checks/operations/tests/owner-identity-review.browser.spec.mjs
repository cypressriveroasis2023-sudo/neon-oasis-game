import {test,expect} from '@playwright/test';
import {resource,snapshot as healthSnapshot} from './fixtures/camera-evidence-fixtures.mjs';
import {key} from './owner-identity-fixtures.mjs';
import {unitId,label,row} from './native-placement-alias-fixtures.mjs';
const origin='http://127.0.0.1:4173',contract='COS_OWNER_CONFIRMED_IDENTITY_V1',claimId='88888888-8888-4888-8888-888888888888';
async function mount(page,{owner=true,fail=false,existing=false}={}){
 const state={requests:[],writes:[],confirmations:existing?[{id:claimId,unitId,unitNumber:label,unitKey:key,status:'active',revision:'1',provenance:'owner_confirmation'}]:[],fail};
 const health={...healthSnapshot([resource(9101,key)]),identityVersion:1,unitIdentities:[],identityWarnings:[]};
 const {_sourceField,...unit}=row();
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/owner-identity-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#camera-health"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.requests.push(request);let data,status=200;
  if(request.path==='/api/session')data={authorized:true,name:'Synthetic Owner',role:owner?'Owner':'IT',features:{fleetAccess:true,ownerIdentityReview:owner}};
  else if(request.path==='/api/field-map')data={items:[unit],inventoryItems:[unit],summary:{fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0},generatedAt:new Date().toISOString()};
  else if(request.path==='/api/camera-health/summary-v3')data=health;
  else if(request.path==='/api/owner-identity/review')data={contract,nativeUnits:[{id:unitId,unitNumber:label}],rawKeys:[key],confirmations:state.confirmations};
  else if(request.path==='/api/owner-identity/preview')data={contract,unitId,unitNumber:label,unitKey:key,deviceIds:['9101'],reviewToken:'a'.repeat(64),provenance:'owner_confirmation'};
  else if(request.path==='/api/owner-identity/confirm'){
   state.writes.push(request);if(state.fail){status=503;data={error:'Synthetic uncertain readback'};}else{state.confirmations=[{id:claimId,unitId,unitNumber:label,unitKey:key,status:'active',revision:'1',provenance:'owner_confirmation'}];data={claimId,revision:'1',provenance:'owner_confirmation'};}
  }else if(request.path==='/api/owner-identity/revoke'){state.writes.push(request);state.confirmations[0].status='revoked';state.confirmations[0].revision='2';data={claimId,revision:'2'};}
  else data={items:[]};
  return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/owner-identity-fixture');const frame=page.frameLocator('iframe');await frame.locator('.camera-card-main').first().click();return {frame,state};
}
async function open(frame){await frame.getByRole('button',{name:'Review equipment identity',exact:true}).click();await expect(frame.getByLabel('Exact registered equipment')).toBeVisible();}
async function preview(frame){await open(frame);await expect(frame.getByLabel('Exact registered equipment')).toHaveValue('');await frame.getByLabel('Exact registered equipment').selectOption(unitId);await frame.getByRole('button',{name:'Review exact association',exact:true}).click();await expect(frame.getByRole('checkbox',{name:/same physical equipment/})).toBeVisible();}
test('Owner reviews exact records then confirms once; no placement or health request is written',async({page},info)=>{
 const {frame,state}=await mount(page);await preview(frame);await expect(frame.getByRole('button',{name:'Save Owner identity confirmation',exact:true})).toBeDisabled();await frame.getByLabel('Identity review reason').fill('I compared the labels on this physical equipment.');await frame.getByRole('checkbox',{name:/same physical equipment/}).check();await frame.getByRole('button',{name:'Save Owner identity confirmation',exact:true}).click();await expect(frame.locator('.camera-identity-review [role=status]')).toContainText('saved and re-read');expect(state.writes).toHaveLength(1);expect(state.writes[0].body).not.toHaveProperty('physicalDigest');expect(state.writes[0].body).not.toHaveProperty('actorId');
 await frame.getByRole('button',{name:'Reload identity review',exact:true}).click();await expect(frame.getByRole('region',{name:'Owner equipment identity review'})).toContainText('Saved Owner confirmation');expect(state.writes).toHaveLength(1);await frame.locator('.camera-identity-review').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('combined-owner-confirmation.png')});
});
test('IT presentation has no identity approval control',async({page})=>{const {frame}=await mount(page,{owner:false});await expect(frame.getByRole('button',{name:'Review equipment identity',exact:true})).toHaveCount(0);});
test('uncertain save cannot be repeated by clicking, Enter, or reopening the same pending form',async({page})=>{
 const {frame,state}=await mount(page,{fail:true});await preview(frame);await frame.getByLabel('Identity review reason').fill('Verified in person.');await frame.getByRole('checkbox',{name:/same physical equipment/}).check();await frame.getByRole('button',{name:'Save Owner identity confirmation',exact:true}).click();await expect(frame.locator('.camera-identity-review [role=status]')).toContainText('Do not repeat');await expect(frame.getByRole('button',{name:'Save Owner identity confirmation',exact:true})).toBeDisabled();await page.keyboard.press('Enter');expect(state.writes).toHaveLength(1);
});
test('Close and re-open clears prior selection, preview and confirmation',async({page})=>{
 const {frame,state}=await mount(page);await preview(frame);await frame.getByRole('checkbox',{name:/same physical equipment/}).check();await frame.getByRole('button',{name:'Close identity review',exact:true}).click();await open(frame);await expect(frame.getByLabel('Exact registered equipment')).toHaveValue('');await expect(frame.getByRole('checkbox',{name:/same physical equipment/})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('revocation requires an Owner reason, is re-read, and never deletes the history',async({page})=>{
 const {frame,state}=await mount(page,{existing:true});await frame.getByRole('button',{name:'Review equipment identity',exact:true}).click();const revoke=frame.getByRole('button',{name:'Revoke this identity link',exact:true});await expect(revoke).toBeDisabled();await frame.getByLabel('Identity review reason').fill('Replacement camera identified.');await revoke.click();await expect(frame.locator('.camera-identity-review [role=status]')).toContainText('revoked and re-read');expect(state.writes).toHaveLength(1);expect(state.writes[0].path).toBe('/api/owner-identity/revoke');await frame.getByRole('button',{name:'Reload identity review',exact:true}).click();await expect(frame.getByRole('region',{name:'Owner equipment identity review'})).toContainText('revoked');await expect(revoke).toHaveCount(0);
});
