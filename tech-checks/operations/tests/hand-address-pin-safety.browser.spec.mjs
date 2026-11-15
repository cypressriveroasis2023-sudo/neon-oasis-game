import {test,expect} from '@playwright/test';
import {mountFleet,fresh} from './fleet-dashboard-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';
const address='22725 Ashley Pines Dr, Spring, TX 77373-3257',revision='0d3a6038-1f3e-4a2e-9d7a-2b9c6f5a1e44';
const initial={unit:'SOLARSPOTTER 023',placement:'FIELD',site:'Original site',siteNamePending:false,state:'GREEN',cameras:1,online:1,offline:0,unknown:0,down:[],onlineInShop:false,publicIp:null,observedAt:fresh,
 cameraList:[{name:'SS023_1',status:'online',atSite:true}],address,addressRevision:revision,
 location:{latitude:30.1,longitude:-95.4,matchedAddress:'22726 ASHLEY PINES DR, SPRING, TX',source:'hand'},
 handEdits:{address:{value:address,by:'Owner',role:'owner',at:fresh}}};
async function setup(page,{fail=false,canEdit=true}={}){
 const {app}=await mountFleet(page);let unit=structuredClone(initial);const writes=[];
 const report=()=>({contract:'COS_STAR_UNIT_STATUS_V1',units:[unit],counts:countUnits([unit]),feed:{provider:'star4live',syncedAt:fresh,status:'ok',fresh:true},handEditsRead:true,otherSourcesRead:true,canEdit,refreshedAt:fresh});
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  const envelope=route.request().postDataJSON();
  if(envelope.path.endsWith('/edit')){
   writes.push(envelope.body);
   if(fail)return route.fulfill({status:409,headers:cors,json:{error:'The saved address changed. Refresh before editing it.'}});
   const request=envelope.body;unit={...unit,addressRevision:request.requestId,location:null};
   return route.fulfill({status:200,headers:cors,json:{...report(),recorded:{unit:unit.unit,field:'address',action:request.action||'set',value:unit.address,by:'Owner',role:'owner',duplicate:false,pinned:false,pinNote:'Different house number'}}});
  }
  return route.fulfill({status:200,headers:cors,json:report()});
 });
 await openFleetView(app,'Camera status');
 const row=app.locator('.cos-camera-status-row').filter({hasText:initial.unit});
 await row.getByRole('button',{name:canEdit?'Open →':'Details →'}).click();return {app,row,writes};
}
test('Remove pin only preserves exact address and retry works without changing it',async({page})=>{
 const {app,row,writes}=await setup(page);
 await row.getByLabel('Address (drops the pin)').fill('999 Unsaved St, Houston, TX');
 await row.getByRole('button',{name:'Remove pin only',exact:true}).evaluate(button=>{button.click();button.click();});
 await expect(app.getByText(/saved address kept/)).toBeVisible();
 expect(writes).toHaveLength(1);expect(writes[0].action).toBe('clear_pin');expect(writes[0].expectedAddressRevision).toBe(revision);expect(writes[0].value).toBeUndefined();
 await expect(row.locator('.cos-camera-status-address')).toContainText(address);
 await row.getByRole('button',{name:'Open →'}).click();
 await expect(row.getByLabel('Address (drops the pin)')).toHaveValue(address);
 await expect(row.getByRole('button',{name:'Remove address and pin',exact:true})).toBeVisible();
 await expect(row.getByRole('button',{name:'Remove pin only',exact:true})).toHaveCount(0);
 await row.getByRole('button',{name:'Retry pin lookup',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(2);
 expect(writes[1].value).toBe(address);expect(writes[1].expectedAddressRevision).toBe(writes[0].requestId);
 await expect(row).toContainText('All cameras up');await expect(row).toContainText('Original site');
});
test('stale save locks edits until explicit successful refresh, without automatic replay',async({page})=>{
 const {app,row,writes}=await setup(page,{fail:true});
 await row.getByRole('button',{name:'Remove pin only',exact:true}).click();
 await expect(app.getByText(/save could not be confirmed/)).toBeVisible();
 await expect(row.getByRole('button',{name:'Remove pin only',exact:true})).toHaveCount(0);expect(writes).toHaveLength(1);
 await app.getByRole('button',{name:'↻ Refresh',exact:true}).click();
 await row.getByRole('button',{name:'Open →'}).click();
 await expect(row.getByRole('button',{name:'Remove pin only',exact:true})).toBeVisible();expect(writes).toHaveLength(1);
});
test('read-only actor gets no pin-clear or retry controls',async({page})=>{
 const {row,writes}=await setup(page,{canEdit:false});
 await expect(row.getByRole('button',{name:'Remove pin only',exact:true})).toHaveCount(0);
 await expect(row.getByRole('button',{name:'Retry pin lookup',exact:true})).toHaveCount(0);expect(writes).toHaveLength(0);
});
