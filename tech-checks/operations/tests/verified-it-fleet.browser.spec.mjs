import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {itHomeFixture} from './it-home-fixture.mjs';
import {snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173',unitId='11111111-1111-4111-8111-111111111111';
const host=fs.readFileSync(new URL('../../verified-it-fleet-host.js',import.meta.url),'utf8');
async function mount(page,role='it',linked=true,options={}){
 const requests=[];const now=new Date().toISOString();
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(new URL(url).origin===origin&&new URL(url).pathname==='/fleet-fixture')return route.fulfill({contentType:'text/html',body:itHomeFixture(role,linked,options)});
  if(url===origin+'/it-mhelp-projection.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../it-mhelp-projection.js',import.meta.url),'utf8')});
  if(url===origin+'/field-map-display-host.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
  if(url.startsWith(origin+'/resources/fonts/'))return route.fulfill({path:new URL('../../resources/fonts/'+url.split('/').pop(),import.meta.url).pathname});
  if(url===origin+'/techcheck-eye-favicon-32.png')return route.fulfill({path:new URL('../../techcheck-eye-favicon-32.png',import.meta.url).pathname});
  if(url===origin+'/fleet-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:host+'\nwindow.fixtureHostLoaded=true;'});
  if(url.startsWith(origin+'/operations/dist/index.html'))return route.fulfill({status:302,headers:{location:url.includes('mode=fleet')?'/?mode=fleet#field-map':options.ownerHome?'/#today':'/#field-map'}});
  if(url===origin+'/owner-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../operations-host.js',import.meta.url),'utf8')});
  if(url===origin+'/owner-fixture')return route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#0b111c}iframe{width:100%;height:100vh;border:0;display:block}</style><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=> 'owner',getEffectiveRole:()=> 'owner',getSession:()=>({user:{id:'synthetic-owner'}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:'synthetic-owner'},access_token:'synthetic-only'}}})}}};</script><script type="module" src="/owner-host-fixture.js"></script>`});
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
 await page.goto(role==='owner'?'/owner-fixture':'/fleet-fixture'+(options.deepLink?'?fieldView=1':''));return requests;
}
test('verified IT host authenticates fleet frame, limits navigation and avoids Owner GPS history',async({page})=>{
 const calls=await mount(page);await page.getByRole('button',{name:'Field View',exact:true}).click();const frame=page.frameLocator('iframe');
 await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await frame.locator('.field-map-list>button').click();
 await expect(frame.getByRole('heading',{name:'GPS history',exact:true})).toHaveCount(0);
 expect(calls.some(c=>c.path.endsWith('/history'))).toBe(false);
 await frame.getByRole('button',{name:'More',exact:true}).first().click();const nav=frame.getByRole('navigation',{name:'COS Operations',exact:true});
 await expect(nav.getByRole('button',{name:'Camera Health',exact:true})).toBeVisible();await expect(nav.getByRole('button',{name:/Money|Team|Dispatch/})).toHaveCount(0);
 await nav.getByRole('button',{name:'Camera Health',exact:true}).click();await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.getByRole('button',{name:'Create ticket',exact:true})).toHaveCount(0);
 await frame.getByRole('button',{name:'More',exact:true}).first().click();await nav.getByRole('button',{name:'InHand Routers',exact:true}).click();await expect.poll(()=>calls.some(c=>c.path==='/api/routers')).toBe(true);
 expect(calls.every(c=>c.method==='GET'&&['/api/session','/api/field-map','/api/camera-health/summary-v3','/api/routers'].includes(c.path))).toBe(true);
 expect(await page.evaluate(()=>window.fixtureTokens)).toBeGreaterThan(0);await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('button',{name:'Field View'})).toBeFocused();
});
for(const [role,linked] of [['service',true],['it',false]])test(`${role} linked=${linked} gets no fleet button or session token`,async({page})=>{await mount(page,role,linked);await expect.poll(()=>page.evaluate(()=>window.fixtureHostLoaded)).toBe(true);await expect(page.getByRole('button',{name:'Field View'})).toHaveCount(0);expect(await page.evaluate(()=>window.fixtureTokens)).toBe(0);});
test('Owner retains full navigation and location history',async({page})=>{const calls=await mount(page,'owner');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await frame.locator('.field-map-list>button').click();await expect.poll(()=>calls.some(c=>c.path.endsWith('/history'))).toBe(true);await frame.getByRole('button',{name:'More',exact:true}).first().click();await expect(frame.getByRole('navigation',{name:'COS Operations',exact:true})).toContainText('Team');});

for(const role of ['it','owner'])test(role+' fullscreen fallback fills host and restores its original frame',async({page})=>{
 await mount(page,role);if(role==='it')await page.getByRole('button',{name:'Field View',exact:true}).click();const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
 const original=await page.locator('iframe').getAttribute('style')||'';
 // Force the supported presentation fallback; this does not grant a permission.
 await frame.locator('body').evaluate(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('Fixture unsupported'));});
 await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();
 await expect(page.locator('iframe')).toHaveCSS('position','fixed');await expect(page.locator('body')).toHaveCSS('overflow','hidden');
 const bounds=await page.locator('iframe').boundingBox();expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(page.viewportSize().width);expect(bounds.height).toBe(page.viewportSize().height);
 await frame.getByRole('button',{name:'Exit TV view',exact:true}).click();await expect(page.locator('iframe')).toHaveAttribute('style',original);
 await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();await page.keyboard.press('Escape');await expect(frame.getByRole('button',{name:'TV / fullscreen map',exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveAttribute('style',original);
});


test('IT Home keeps one clear entry through real legacy redraws, keyboard, return and role changes',async({page},testInfo)=>{
 await mount(page);const entry=page.locator('#wlItHome .wl-it-command-workspace [data-cos-field-view]');
 await expect(entry).toBeVisible();await expect(entry).toHaveText('Field View');expect((await entry.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:testInfo.outputPath('verified-it-home-field-view.png'),fullPage:true});
 for(let i=0;i<3;i++){
  await page.evaluate(()=>window.renderITHome());await expect(entry).toBeVisible();await expect(page.locator('[data-cos-field-view]')).toHaveCount(1);
  await entry.focus();await page.keyboard.press('Enter');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
  if(i===0)await page.screenshot({path:testInfo.outputPath('verified-it-open-field-map.png'),fullPage:true});
  if(i===1){await page.evaluate(()=>window.renderITHome());await expect(entry).toHaveCount(1);await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();}
  else await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);await expect(entry).toBeFocused();
 }
 await entry.click();await expect(page.locator('dialog')).toHaveCount(1);
 await page.evaluate(()=>{window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');});
 await expect(page.locator('[data-cos-field-view],dialog,iframe')).toHaveCount(0);
 const issued=await page.evaluate(()=>window.fixtureTokens);
 await page.evaluate(()=>{window.fixtureRole='it';window.fixtureAuthChanged();});await expect(entry).toBeVisible();await entry.click();await expect(page.locator('dialog')).toHaveCount(1);
 await page.evaluate(()=>{window.fixtureSubject=null;window.fixtureAuthChanged();});await expect(page.locator('[data-cos-field-view],dialog,iframe')).toHaveCount(0);
 expect(await page.evaluate(()=>window.fixtureTokens)).toBeGreaterThanOrEqual(issued);
});

for(const action of ['role change','logout'])test(`IT ${action} during fullscreen restores the parent and removes stale access`,async({page})=>{
 await mount(page);const entry=page.locator('[data-cos-field-view]');await expect(entry).toBeVisible();
 const readParent=()=>page.evaluate(()=>({overflow:document.body.style.overflow,visibility:document.getElementById('appView').style.visibility,pointerEvents:document.getElementById('appView').style.pointerEvents,inert:document.getElementById('appView').inert}));
 const original=await readParent();await entry.click();const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
 await frame.locator('body').evaluate(()=>{HTMLElement.prototype.requestFullscreen=undefined;});
 await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();
 await expect(page.locator('body')).toHaveCSS('overflow','hidden');await expect(page.locator('#appView')).toHaveCSS('visibility','hidden');expect((await readParent()).inert).toBe(true);
 await page.evaluate(action=>{if(action==='logout'){window.fixtureSubject=null;window.fixtureAuthChanged();}else{window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');}},action);
 await expect(page.locator('[data-cos-field-view],dialog,iframe')).toHaveCount(0);await expect.poll(readParent).toEqual(original);
 await expect(page.locator('#appView')).toBeVisible();await page.keyboard.press('Tab');expect(await page.locator('body').evaluate(()=>document.activeElement?.closest('dialog,iframe')===null)).toBe(true);
});

for(const [label,options] of [['capability denied',{capability:false}],['inactive',{active:false}],['archived',{archived:true}],['owner preview',{effectiveRole:'owner'}]])test('IT '+label+' receives no Home entry or token',async({page})=>{
 await mount(page,'it',true,options);await expect.poll(()=>page.evaluate(()=>window.fixtureHostLoaded)).toBe(true);
 await expect(page.locator('[data-cos-field-view],dialog,iframe')).toHaveCount(0);expect(await page.evaluate(()=>window.fixtureTokens)).toBe(0);
});

test('Owner Home Field View supports keyboard, browser Back and repeated entry without losing Owner access',async({page},testInfo)=>{
 const calls=await mount(page,'owner',true,{ownerHome:true});const frame=page.frameLocator('iframe');const entry=frame.getByRole('region',{name:'Field View shortcut'}).getByRole('button',{name:'Field View',exact:true});
 await expect(entry).toBeVisible();expect((await entry.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:testInfo.outputPath('owner-home-field-view.png'),fullPage:true});
 await entry.focus();await page.keyboard.press('Enter');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
 await page.evaluate(()=>history.back());await expect(entry).toBeVisible();await expect(frame.locator('.home-field-view')).toHaveCount(1);
 await entry.click();await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await frame.locator('.field-map-list>button').click();await expect.poll(()=>calls.some(c=>c.path.endsWith('/history'))).toBe(true);
 await page.evaluate(()=>history.back());await expect(entry).toBeVisible();expect(calls.every(c=>c.method==='GET')).toBe(true);
});

test('IT entry uses touch activation and the existing Tech Checks return',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,baseURL:origin});const page=await context.newPage();
 try{await mount(page);const entry=page.locator('[data-cos-field-view]');await entry.tap();const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(1);
  await frame.getByRole('navigation',{name:'Mobile Operations navigation'}).getByRole('button',{name:'Tech Checks',exact:true}).tap();
  await frame.getByRole('button',{name:'Return to my IT Tech Checks',exact:true}).tap();await expect(page.locator('dialog,iframe')).toHaveCount(0);await expect(entry).toBeFocused();
 }finally{await context.close();}
});


test('second verified IT identity keeps deep-link entry one-time through redraws and repeated clicks',async({page})=>{
 await mount(page,'it',true,{secondVerified:true,deepLink:true});const entry=page.locator('[data-cos-field-view]');
 await expect(page.frameLocator('iframe').locator('.field-map-list>button')).toHaveCount(1);
 await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(entry).toBeFocused();
 await page.evaluate(()=>window.renderITHome());await expect(entry).toBeVisible();await expect(page.locator('dialog,iframe')).toHaveCount(0);
 await entry.evaluate(button=>{button.click();button.click();});await expect(page.locator('dialog')).toHaveCount(1);await expect(page.locator('iframe')).toHaveCount(1);
 await page.keyboard.press('Escape');await expect(entry).toBeFocused();
});
