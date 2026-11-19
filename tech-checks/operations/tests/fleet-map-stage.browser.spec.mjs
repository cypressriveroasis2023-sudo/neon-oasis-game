import {test,expect} from '@playwright/test';
import {mountFleet,field} from './fleet-dashboard-fixtures.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const fits = (frame)=>frame.locator('html').evaluate(()=>({
  html: document.documentElement.scrollHeight<=document.documentElement.clientHeight+1,
  body: document.body.scrollHeight<=document.body.clientHeight+1,
  y: window.scrollY,
}));

test('the fleet stage does not scroll, a count filters the map, and a unit opens details',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440','covered once at 1920x1080');
  await page.setViewportSize({width:1920,height:1080});
  const {app}=await mountFleet(page,true);
  const stage=app.locator('.cos-stage');
  await expect(stage).toBeVisible();
  await expect(stage.locator('[data-stage-box=monitored]')).toHaveCount(0);
  await expect(stage.locator('[data-stage-box=in-watchful]')).toHaveCount(0);
  await expect(stage.locator('[data-stage-box=immix]')).toHaveCount(0);
  await expect(stage.getByText('Arming read stale')).toHaveCount(0);
  await expect(stage.locator('[data-stage-box=field]')).toContainText('selectFleetCounts');
  await expect(stage.locator('[data-stage-box=in-shop]')).toContainText('selectFleetCounts');
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1920_default.png'});
  const pins=app.locator('.cos-field-pin');
  const before=await pins.count();
  await stage.locator('[data-stage-box=field]').click();
  const drawer=app.locator('.cos-stage-drawer');
  await expect(drawer).toBeVisible();
  const unknown=drawer.locator('[data-stage-icon=unknown]');
  await expect(unknown.first()).toBeVisible();
  await expect(unknown.first()).toContainText('Unknown');
  await expect(unknown.first()).not.toContainText('Down');
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1920_count.png'});
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await stage.locator('[data-stage-box=in-shop]').click();
  await expect.poll(()=>pins.count()).toBeLessThan(before);
  await page.keyboard.press('Escape');
  await stage.locator('[data-stage-box=field]').click();
  await stage.locator('.cos-stage-list button',{hasText:'Helios 1'}).click();
  await expect(app.locator('.cos-stage-details')).toContainText('Helios 1');
  await expect.poll(()=>app.locator('body').evaluate(()=>history.state?.cosFieldMapView?.zoom||0)).toBeGreaterThanOrEqual(14);
  const visible=await app.locator('.cos-fleet-board').innerText();
  expect(visible).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  expect(visible).not.toMatch(/SIM number|password|credential/i);
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1920_unit.png'});
});

const origin='http://127.0.0.1:4173';
const time='2026-11-19T17:48:00Z';
const stale='2026-11-19T17:00:00Z';
test('the TV board stays on one screen and a stale unit is Unknown',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440','covered once at the TV viewport');
  await page.setViewportSize({width:1920,height:1080});
  const dist=fileURLToPath(new URL('../dist/',import.meta.url));
  const harness=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/operations-host.css"><style>body{margin:0}#cosOperationsMount{height:100dvh}</style></head><body><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=>"owner",getEffectiveRole:()=>"owner",getSession:()=>({user:{id:"fixture-owner"}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:"fixture-owner"},access_token:"synthetic-owner-session"}}})}}};</script><script type="module" src="/operations-host.js"></script></body></html>`;
  const unit={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',unitNumber:'North Yard',modelName:'SNIPER',status:'installed',placement:'FIELD',site:'Synthetic yard',address:'100 Synthetic Rd',latitude:29.98,longitude:-95.31,locationVerification:'owner_verified',locationVerifiedAt:time,gpsRecordedAt:time};
  const staleUnit={...unit,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',unitNumber:'Stale Yard',latitude:30.1,longitude:-95.4};
  const loose={...unit,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',unitNumber:'Loose Yard',placement:'UNKNOWN',currentLocationType:'unknown',latitude:30.2,longitude:-95.5,locationVerification:'address_only',gpsRecordedAt:null,locationVerifiedAt:null};
  const shop={...unit,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',unitNumber:'Bench Yard',placement:'SHOP',currentLocationType:'shop',latitude:30.3,longitude:-95.2,locationVerification:'address_only',gpsRecordedAt:null,locationVerifiedAt:null};
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin){
      if(url.pathname==='/tv-stage')return route.fulfill({contentType:'text/html',body:harness});
      if(url.pathname==='/operations-host.js')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../operations-host.js',import.meta.url),'utf8')});
      if(url.pathname==='/field-map-display-host.js')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
      if(url.pathname==='/operations-host.css')return route.fulfill({contentType:'text/css',body:await readFile(new URL('../../operations-host.css',import.meta.url),'utf8')});
      if(url.pathname.startsWith('/operations/dist/'))return route.fulfill({path:dist+url.pathname.slice('/operations/dist/'.length)});
      return route.continue();
    }
    if(!url.href.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST, OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON();
    if(request.method!=='GET')return route.fulfill({status:403,headers,json:{error:'Display cannot write'}});
    const path=request.path;
    if(path==='/api/tv-board/settings')return route.fulfill({headers,json:{sections:['map'],revision:1,updatedAt:time,rotationSeconds:60}});
    if(path==='/api/daily-board')return route.fulfill({headers,json:{jobs:[],tasks:[],readiness:[],asOf:time}});
    if(path==='/api/field-map')return route.fulfill({headers,json:{items:[unit,staleUnit,loose,shop],summary:{fieldUnits:4,mappedUnits:2,unitGps:2,missingGps:2},generatedAt:time}});
    if(path==='/api/routers')return route.fulfill({headers,json:{items:[],generatedAt:time,source:'camera_health',gpsAvailable:false}});
    if(path==='/api/camera-health/summary-v3')return route.fulfill({headers,json:{totalDevices:2,online:1,offline:1,review:0,shopRoot:0,healthRows:2,fieldDevices:2,refreshedAt:time,evidenceVersion:2,inventory:{allRecords:2,activeFieldRecords:2,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0},rows:[
      {id:'fresh-resource',name:'North Yard connection',unit:'North Yard',status:'online',scope:'field',activationState:'active',serviceEvidence:{kind:'service_port',source:'Saved connection',status:'online',active:true,resource:'service',observedAt:time,lastOnlineAt:time,reachable:true}},
      {id:'stale-resource',name:'Stale Yard connection',unit:'Stale Yard',status:'offline',scope:'field',activationState:'active',serviceEvidence:{kind:'service_port',source:'Saved connection',status:'offline',active:true,resource:'service',observedAt:stale,lastOnlineAt:stale,reachable:false}},
    ]}});
    if(path==='/api/session')return route.fulfill({headers,json:{authorized:true,legacyOwner:true,role:'Owner',name:'Fixture Owner',productionOwnerUserId:'11111111-1111-4111-8111-111111111111',features:{fleetAccess:true}}});
    return route.fulfill({headers,json:{items:[]}});
  });
  await page.goto('/tv-stage?tvBoard=1');
  const frame=page.frameLocator('#cosOperationsFrame');
  const board=frame.getByRole('region',{name:'Tech Check TV Board'});
  await expect(board).toBeVisible();
  await expect(frame.locator('.cos-tv-stage')).toBeVisible();
  await expect(frame.locator('[data-stage-box=monitored]')).toHaveCount(0);
  await expect(frame.locator('[data-stage-box=field] strong')).not.toHaveText('—');
  await expect(frame.locator('[data-stage-box=in-shop] strong')).toHaveText('1');
  await expect(frame.locator('[data-stage-box=unknown-placement] strong')).toHaveText('1');
  await frame.locator('[data-stage-box=field]').click();
  const staleRow=frame.locator('.cos-stage-list [data-unit-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]');
  await expect(staleRow).toHaveAttribute('data-stage-icon','unknown');
  await expect(staleRow).toContainText('Unknown');
  await expect(staleRow).not.toContainText('Down');
  await expect(frame.locator('.cos-stage-list')).not.toContainText('Loose Yard');
  await expect(frame.locator('.cos-stage-list')).not.toContainText('Bench Yard');
  const mapBox=await frame.locator('.tv-fleet-map').boundingBox();
  expect(mapBox.height).toBeGreaterThan(500);
  expect(await board.evaluate(node=>node.scrollHeight<=node.clientHeight+1&&document.documentElement.scrollHeight<=document.documentElement.clientHeight+1)).toBe(true);
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_tv.png'});
});

test('the stage drawer keeps the last unit on screen at 1920x1080',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440');
  await page.setViewportSize({width:1920,height:1080});
  const many=structuredClone(field);
  const sample=many.inventoryItems.find(item=>item.currentLocationType==='shop');
  for(let i=0;i<30;i++)many.inventoryItems.push({...sample,id:`00000000-0000-4000-8000-${String(300+i).padStart(12,'0')}`,unitNumber:`Shop bench ${i}`,currentLocationType:'shop',placement:'SHOP'});
  const {app}=await mountFleet(page,true,{field:many});
  await app.locator('[data-stage-box=in-shop]').click();
  const drawer=app.locator('.cos-stage-drawer');
  const last=drawer.locator('.cos-stage-list button').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  const box=await last.boundingBox();
  const view=page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y+box.height).toBeLessThanOrEqual(view.height+1);
  const panel=await drawer.boundingBox();
  expect(panel.y+panel.height).toBeLessThanOrEqual(view.height+1);
  expect(await fits(app)).toEqual({html:true,body:true,y:0});
});

test('a grouped site zooms in and the old group sheet stays closed',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440');
  await page.setViewportSize({width:1920,height:1080});
  const clustered=structuredClone(field);
  for(let i=0;i<20;i++){
    const id=`00000000-0000-4000-8000-${String(500+i).padStart(12,'0')}`;
    const copy={...clustered.items[0],id,unitNumber:`Cluster ${i}`,latitude:29.7+i*0.012,longitude:-95.4+(i%3)*0.012};
    clustered.items.push(copy);
    clustered.inventoryItems.push({...clustered.inventoryItems[0],...copy,currentLocationType:'field',placement:'FIELD'});
  }
  clustered.summary.fieldUnits=clustered.items.length;
  const {app}=await mountFleet(page,false,{field:clustered});
  const marker=app.locator('.cos-compact-group-marker').first();
  await expect(marker).toBeVisible();
  const before=await app.locator('body').evaluate(()=>history.state?.cosFieldMapView?.zoom??0);
  await marker.click();
  await expect.poll(()=>app.locator('body').evaluate(()=>history.state?.cosFieldMapView?.zoom??0)).toBeGreaterThan(Math.max(before,5));
  await expect(app.locator('.cos-compact-group-sheet')).toHaveCount(0);
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1920_group.png'});
});

test('the map fills a 1600x900 screen without page scroll',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440');
  await page.setViewportSize({width:1600,height:900});
  const {app}=await mountFleet(page,true);
  await expect(app.locator('.cos-stage')).toBeVisible();
  const canvas=await app.locator('.cos-fleet-map-canvas').boundingBox();
  expect(canvas.height).toBeGreaterThan(500);
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1600x900.png'});
});

test('failure warnings and the read time stay visible on the stage',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440');
  await page.setViewportSize({width:1920,height:1080});
  const {app}=await mountFleet(page,true,{failHealth:true});
  await expect(app.getByText('Health update unavailable')).toBeVisible();
  await expect(app.locator('.cos-fleet-heading small').filter({hasText:'health read'})).toBeVisible();
  await expect(app.locator('.cos-source-strip')).toBeVisible();
});

test('fleetStage=0 renders the reviewed main board',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1440');
  await page.setViewportSize({width:1920,height:1080});
  const {app}=await mountFleet(page,false);
  await page.locator('iframe').evaluate(frame=>{frame.src='/?fleetStage=0#fleet-dashboard';});
  await expect(app.locator('.cos-fleet-stat-field strong')).toBeVisible();
  await expect(app.locator('.cos-stage')).toHaveCount(0);
  await expect(app.locator('.cos-fleet-unit-panel')).toBeVisible();
  await expect(app.locator('.cos-fleet-map-panel')).toBeVisible();
});
