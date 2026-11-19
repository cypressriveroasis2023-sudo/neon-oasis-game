import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
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
  await expect(stage.locator('[data-stage-box=monitored]')).toContainText('Arming read stale');
  await expect(stage.locator('[data-stage-box=monitored]')).not.toContainText(/monitored/i);
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1920_default.png'});
  const pins=app.locator('.cos-field-pin');
  const before=await pins.count();
  await stage.locator('[data-stage-box=monitored]').click();
  const drawer=app.locator('.cos-stage-drawer');
  await expect(drawer).toBeVisible();
  const unknown=drawer.locator('[data-stage-icon=unknown]');
  await expect(unknown.first()).toBeVisible();
  await expect(unknown.first()).toContainText('Unknown');
  await expect(unknown.first()).not.toContainText('Down');
  await expect.poll(()=>pins.count()).toBeLessThan(before);
  await expect.poll(()=>fits(app)).toEqual({html:true,body:true,y:0});
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_1920_count.png'});
  await stage.locator('[data-stage-box=monitored]').click();
  await expect(drawer).toBeHidden();
  const pin=app.locator('.cos-field-pin-wrap[data-unit-id="00000000-0000-4000-8000-000000000001"]');
  await expect(pin).toBeVisible();
  await pin.click();
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
    if(path==='/api/field-map')return route.fulfill({headers,json:{items:[unit,staleUnit],summary:{fieldUnits:2,mappedUnits:2,unitGps:2,missingGps:0},generatedAt:time}});
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
  await expect(frame.locator('[data-stage-box=monitored]')).toContainText('Arming read stale');
  await frame.locator('[data-stage-box=monitored]').click();
  const staleRow=frame.locator('.cos-stage-list [data-unit-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]');
  await expect(staleRow).toHaveAttribute('data-stage-icon','unknown');
  await expect(staleRow).toContainText('Unknown');
  await expect(staleRow).not.toContainText('Down');
  expect(await board.evaluate(node=>node.scrollHeight<=node.clientHeight+1&&document.documentElement.scrollHeight<=document.documentElement.clientHeight+1)).toBe(true);
  await page.screenshot({path:'/opt/cursor/artifacts/fleet_stage_tv.png'});
});
