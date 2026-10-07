import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173',unitId='11111111-1111-4111-8111-111111111111';
const host=fs.readFileSync(new URL('../../verified-it-fleet-host.js',import.meta.url),'utf8');
async function mount(page,role='it',linked=true){
 const requests=[];const now=new Date().toISOString();
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/fleet-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="appView"><div id="view-it"></div></div><script>window.fixtureTokens=0;window.fixtureRole=${JSON.stringify(role)};window.TechCheckContext={getProfile:()=>({active:true,archived_at:null}),getRole:()=>window.fixtureRole,getEffectiveRole:()=>window.fixtureRole,getSession:()=>({user:{id:${JSON.stringify(linked?'4f7044b5-86b6-411f-8898-39bb64b4ddbc':'33333333-3333-4333-8333-333333333333')}}}),db:{rpc:async()=>({data:{fleetRead:true}}),auth:{onAuthStateChange:()=>{},getSession:async()=>{window.fixtureTokens++;return {data:{session:{user:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},access_token:'synthetic-only'}}}}}}};</script><script type="module" src="/fleet-host-fixture.js"></script>`});
  if(url===origin+'/field-map-display-host.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
  if(url===origin+'/fleet-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:host+'\nwindow.fixtureHostLoaded=true;'});
  if(url.startsWith(origin+'/operations/dist/index.html'))return route.fulfill({status:302,headers:{location:'/?mode=fleet#field-map'}});
  if(url===origin+'/owner-fixture')return route.fulfill({contentType:'text/html',body:`<iframe style="width:100vw;height:100vh" src="/#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort();
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();requests.push(request);const owner=role==='owner';
  const base={id:unitId,unitNumber:'Solar Spotter 51',modelName:'Solar Spotter',status:'installed',currentLocationType:'site',site:'Synthetic job',address:'100 Fixture Road, Houston TX 77001',latitude:29.76,longitude:-95.37,locationVerification:'owner_verified',gpsRecordedAt:now,locationVerifiedAt:now,coordinateSource:'site',hasUnitGps:true};
  const data=request.path==='/api/session'?{authorized:true,legacyOwner:owner,name:'Synthetic '+role,role:owner?'Owner':'IT',features:{fleetAccess:true,fleetPlacementEdit:true,fleetConnectionEdit:true,fieldLocationVerification:owner}}:
   request.path==='/api/field-map'?{items:[base],summary:{fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0},generatedAt:now}:
   request.path==='/api/camera-health/summary-v3'?snapshot([resource(1,'SOLARSPOTTER 51',{name:'Fixture camera',status:'online',checkedAt:now,evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'online',observedAt:now,lastOnlineAt:now}})]):
   request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(role==='owner'?'/owner-fixture':'/fleet-fixture');return requests;
}
test('verified IT host authenticates fleet frame, limits navigation and avoids Owner GPS history',async({page})=>{
 const calls=await mount(page);await page.getByRole('button',{name:'Field Map & Camera Health',exact:true}).click();const frame=page.frameLocator('iframe');
 await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await frame.locator('.field-map-list>button').click();
 await expect(frame.getByRole('heading',{name:'GPS history',exact:true})).toHaveCount(0);
 expect(calls.some(c=>c.path.endsWith('/history'))).toBe(false);
 await frame.getByRole('button',{name:'More',exact:true}).first().click();const nav=frame.getByRole('navigation',{name:'COS Operations',exact:true});
 await expect(nav.getByRole('button',{name:'Camera Health',exact:true})).toBeVisible();await expect(nav.getByRole('button',{name:/Money|Team|Dispatch|Dashboard/})).toHaveCount(0);
 await nav.getByRole('button',{name:'Camera Health',exact:true}).click();await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.getByRole('button',{name:'Create ticket',exact:true})).toHaveCount(0);
 await frame.getByRole('button',{name:'More',exact:true}).first().click();await nav.getByRole('button',{name:'InHand Routers',exact:true}).click();await expect.poll(()=>calls.some(c=>c.path==='/api/routers')).toBe(true);
 expect(calls.every(c=>c.method==='GET'&&['/api/session','/api/field-map','/api/camera-health/summary-v3','/api/routers'].includes(c.path))).toBe(true);
 expect(await page.evaluate(()=>window.fixtureTokens)).toBeGreaterThan(0);await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('button',{name:'Field Map & Camera Health'})).toBeFocused();
});
for(const [role,linked] of [['service',true],['it',false]])test(`${role} linked=${linked} gets no fleet button or session token`,async({page})=>{await mount(page,role,linked);await expect.poll(()=>page.evaluate(()=>window.fixtureHostLoaded)).toBe(true);await expect(page.getByRole('button',{name:'Field Map & Camera Health'})).toHaveCount(0);expect(await page.evaluate(()=>window.fixtureTokens)).toBe(0);});
test('Owner retains full navigation and location history',async({page})=>{const calls=await mount(page,'owner');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await frame.locator('.field-map-list>button').click();await expect.poll(()=>calls.some(c=>c.path.endsWith('/history'))).toBe(true);await frame.getByRole('button',{name:'More',exact:true}).first().click();await expect(frame.getByRole('navigation',{name:'COS Operations',exact:true})).toContainText('Team');});

test('verified IT fullscreen fallback fills host and restores its original frame',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'Field Map & Camera Health',exact:true}).click();const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
 const original=await page.locator('iframe').getAttribute('style');
 // Force the supported presentation fallback; this does not grant a permission.
 await frame.locator('body').evaluate(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('Fixture unsupported'));});
 await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();
 await expect(page.locator('iframe')).toHaveCSS('position','fixed');await expect(page.locator('body')).toHaveCSS('overflow','hidden');
 const bounds=await page.locator('iframe').boundingBox();expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(page.viewportSize().width);expect(bounds.height).toBe(page.viewportSize().height);
 await frame.getByRole('button',{name:'Exit TV view',exact:true}).click();await expect(page.locator('iframe')).toHaveAttribute('style',original);
 await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();await page.keyboard.press('Escape');await expect(frame.getByRole('button',{name:'TV / fullscreen map',exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveAttribute('style',original);
});
