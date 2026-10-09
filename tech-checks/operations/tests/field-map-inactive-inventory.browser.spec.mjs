// Actual native Field Map with fully intercepted synthetic inventory and map tiles.
import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {snapshot as healthSnapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
import {inventorySnapshot,inactiveUnit,fieldUnit,ids,stamp} from './inactive-inventory-fixtures.mjs';
const repo=resolve(process.env.COS_INACTIVE_MAP_TEST_DIST||fileURLToPath(new URL('../dist',import.meta.url)));
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';
async function mount(page,data=inventorySnapshot(),routeHash='#field-map'){
  const state={data,requests:[],writes:[],errors:[],allowGpsWrite:false};
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.clock.install({time:new Date(stamp)});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin){
      if(url.pathname==='/inactive-inventory-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/${routeHash}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
      const path=resolve(repo,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
      if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream'});
      return route.abort();
    }
    if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url.href))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
    if(!url.href.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON();state.requests.push(request);
    if(request.method!=='GET'){
      state.writes.push(request);
      if(state.allowGpsWrite&&request.path==='/api/field-map/'+ids[0]+'/gps')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({id:ids[0],...request.body,recordedAt:stamp})});
      return route.fulfill({status:400,headers,body:'{}'});
    }
    const result=request.path==='/api/session'?{authorized:true,name:'Synthetic owner',role:'Owner',features:{fieldLocationVerification:true}}
      :request.path==='/api/field-map'?state.data
      :request.path==='/api/camera-health/summary-v3'?healthSnapshot([resource(1,fieldUnit().unitNumber)])
      :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}
      :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:stamp}:{items:[]};
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(origin+'/inactive-inventory-fixture');
  const frame=page.frameLocator('iframe');
  await expect(frame.locator('.field-map-workspace')).toBeVisible();
  return {frame,state};
}
test('inactive native/V1 tracker/V2 tracker inventory stays searchable outside every field consumer',async({page})=>{
  const {frame,state}=await mount(page),inventory=frame.getByRole('region',{name:'Inactive inventory'});
  await expect(inventory.locator('li')).toHaveCount(3);
  await expect(inventory).toContainText('No current field placement');
  await expect(inventory.getByRole('button')).toHaveCount(0);
  await expect(inventory.getByRole('link')).toHaveCount(0);
  await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
  await expect(frame.locator('.field-map-kpis article').first()).toHaveText('1FIELD UNITS');
  await expect(frame.getByLabel('Nearby unit center').locator('option')).toHaveCount(2);
  await frame.getByLabel('Review unverified historical locations').check();
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
  await expect(frame.getByLabel('Review unverified historical locations').locator('..')).toContainText('(0)');
  for(const label of ['Helios 401','Solar Stand 402','Skid 403']){
    await frame.getByLabel('Search field units').fill(label.toLowerCase());
    await expect(inventory.locator('li')).toHaveCount(1);await expect(inventory.locator('strong')).toHaveText(label);
    await expect(frame.locator('.field-map-list>button')).toHaveCount(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(0);
  }
  await frame.getByLabel('Field health filter').selectOption('offline');
  await frame.getByLabel('Nearby unit center').selectOption(ids[0]);
  await expect(inventory.locator('strong')).toHaveText('Skid 403');
  await frame.getByLabel('Search field units').fill('missing');await expect(inventory).toContainText('No inactive inventory matches this search');
  await frame.getByLabel('Search field units').fill('retired customer');await expect(inventory.locator('li')).toHaveCount(3);
  await frame.getByLabel('Search field units').fill('');await frame.getByLabel('Field health filter').selectOption('all');await frame.getByLabel('Nearby unit center').selectOption('');
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
  expect(state.requests.filter(row=>row.path.endsWith('/history')).every(row=>row.path==='/api/field-map/'+ids[0]+'/history')).toBe(true);
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('inactive unit deep link finds inventory without selecting another field unit or enabling GPS/history',async({page})=>{
  const {frame,state}=await mount(page,inventorySnapshot(),'#field-map?unitLabel=Helios%20401');
  await expect(frame.getByRole('region',{name:'Inactive inventory'}).locator('strong')).toHaveText('Helios 401');
  await expect(frame.locator('.toast')).toHaveText('This unit is INACTIVE / DO NOT USE. It remains searchable in inactive inventory and has no current field pin.');
  await expect(frame.locator('.field-map-detail h2')).toHaveCount(0);await expect(frame.locator('.field-map-coordinate-form')).toHaveCount(0);await expect(frame.locator('.field-map-history')).toHaveCount(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(0);
  expect(state.requests.filter(row=>row.path.endsWith('/history'))).toEqual([]);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('inactive UUID deep link identifies the current inactive inventory record with accurate placement copy',async({page})=>{
  const {frame,state}=await mount(page,inventorySnapshot(),'#field-map?unit='+ids[1]);
  await expect(frame.getByRole('region',{name:'Inactive inventory'})).toContainText('Helios 401');
  await expect(frame.locator('.toast')).toHaveText('This unit is INACTIVE / DO NOT USE. It remains searchable in inactive inventory and has no current field pin.');
  await expect(frame.locator('.field-map-detail h2')).toHaveCount(0);await expect(frame.locator('.field-map-coordinate-form')).toHaveCount(0);await expect(frame.locator('.field-map-history')).toHaveCount(0);
  expect(state.requests.filter(row=>row.path.endsWith('/history'))).toEqual([]);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
for(const [name,mutate] of [
  ['invalid source proof',snapshot=>snapshot.inventoryItems[1].importedInstallation.sourceRowSha256='bad'],
  ['inactive field item',snapshot=>{snapshot.items=[snapshot.inventoryItems[1]];snapshot.summary.fieldUnits=1;}],
  ['active duplicate of inactive identity',snapshot=>{snapshot.items[0].id=ids[1];}],
  ['non-array inventory',snapshot=>snapshot.inventoryItems={}]
])test(name+' never creates initial active pins and can recover after a valid refresh',async({page})=>{
  const data=inventorySnapshot();mutate(data);const {frame,state}=await mount(page,data);
  await expect(frame.getByRole('alert')).toContainText('Field units could not be loaded');await expect(frame.locator('.cos-field-pin')).toHaveCount(0);await expect(frame.locator('.field-map-layout')).toHaveCount(0);await expect(frame.getByRole('region',{name:'Inactive inventory'})).toHaveCount(0);
  state.data=inventorySnapshot();await frame.getByRole('button',{name:'Retry map load'}).click();await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await expect(frame.locator('.cos-field-pin')).toHaveCount(1);await expect(frame.getByRole('region',{name:'Inactive inventory'}).locator('li')).toHaveCount(3);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('Owner effective field placement retains its pin while historical INACTIVE metadata stays out of inactive inventory',async({page})=>{
  const owner={...fieldUnit(),importedPlacement:'INACTIVE',importedInstallation:inactiveUnit().importedInstallation,placementSource:'owner',placement:'FIELD',placementAuditId:'43'};
  const {frame,state}=await mount(page,inventorySnapshot([], [owner]));
  await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await expect(frame.locator('.cos-field-pin')).toHaveCount(1);await expect(frame.getByRole('region',{name:'Inactive inventory'})).toHaveCount(0);expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
});
test('malformed inventory during GPS readback keeps uncertain save gated until a valid refresh, without replay',async({page})=>{
  const {frame,state}=await mount(page),save=frame.getByRole('button',{name:'Save verified location',exact:true});
  await expect(frame.locator('.field-map-detail h2')).toHaveText('Ranger 001');
  await frame.getByRole('checkbox',{name:/I checked that these coordinates/}).check();
  state.allowGpsWrite=true;state.data=inventorySnapshot();state.data.inventoryItems[1].importedInstallation.sourceRowSha256='bad';
  await save.click();
  await expect(frame.locator('.field-map-error')).toContainText('GPS may have been saved, but could not be verified');
  await expect(save).toBeDisabled();expect(state.writes).toHaveLength(1);
  await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-error')).toContainText('Inactive inventory has an inconsistent placement record');await expect(save).toBeDisabled();expect(state.writes).toHaveLength(1);
  state.data=inventorySnapshot();await frame.getByRole('button',{name:'Retry map load'}).click();await expect(frame.locator('.field-map-error')).toHaveCount(0);
  await frame.getByRole('checkbox',{name:/I checked that these coordinates/}).check();await expect(save).toBeEnabled();expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});
