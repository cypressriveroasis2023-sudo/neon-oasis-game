// Isolated fixture only. All external traffic is blocked; counts and locations are synthetic.
import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {snapshot,resource,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';
const units=Array.from({length:319},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,unitNumber:i<223?'Solar Spotter '+(i+1):'ST '+String(i-222).padStart(3,'0'),modelName:i<223?'Solar Spotter':'STANDS',status:'installed',currentLocationType:'site',address:'Synthetic address '+(i+1),site:'Fixture site',latitude:i<10?29.70+i*.05:null,longitude:i<10?-95.40+i*.02:null,locationVerification:i<10?'owner_verified':'address_only',gpsRecordedAt:i<10?fresh:null,locationVerifiedAt:i<10?fresh:null,coordinateSource:i<10?'site':null,hasUnitGps:false,readOnly:true}));
async function mount(page,{fail=false,legacySelection=false,customUnits=units}={}){
 const state={calls:[],fail,errors:[]};page.on('pageerror',e=>state.errors.push(e.message));
 await page.clock.install({time:new Date(now)});
 if(legacySelection)await page.addInitScript(()=>{if(parent!==window)history.replaceState({cosFieldMapView:{selectedId:'00000000-0000-4000-8000-000000000001'}},'');});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/clean-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0;background:#111b2a}header{height:35px;color:white}iframe{width:calc(100% - 16px);height:calc(100dvh - 60px);margin:8px;border:0;display:block}</style><header id="outer-navigation"><button>Outer navigation</button></header><main><iframe src="/#field-map" allow="fullscreen" allowfullscreen></iframe></main><script type="module">import {setFieldMapDisplay} from '/display-host.js';addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==f.contentWindow)return;if(e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin);if(e.data.type==='COS_FIELD_MAP_DISPLAY_MODE')setFieldMapDisplay(f,e.data.active);});</script>`});
  if(url===origin+'/display-host.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dce5df"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#fff" stroke-width="8"/><text x="15" y="130" font-size="12" fill="#778877">Fixture map</text></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.calls.push(request);expect(request.method).toBe('GET');
  if(request.path==='/api/field-map'&&state.fail)return route.fulfill({status:503,headers,body:JSON.stringify({error:'Synthetic load failed'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner'}:request.path==='/api/field-map'?{items:customUnits,summary:{fieldUnits:customUnits.length,mappedUnits:customUnits.filter(u=>u.latitude!==null).length,unitGps:0,missingGps:customUnits.filter(u=>u.latitude===null).length},generatedAt:new Date(now).toISOString(),placementReviews:[{unitNumber:'SOLARSPOTTER REVIEW',reason:'Fixture placement needs identity review',placementAuditId:null}]}:request.path==='/api/camera-health/summary-v3'?snapshot(customUnits.slice(0,116).map((u,i)=>resource(i+1,u.unitNumber))):request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:new Date(now).toISOString()}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/clean-fixture');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-workspace')).toBeVisible();if(!fail)await expect(frame.locator('.field-map-list>button')).toHaveCount(customUnits.length);return {frame,state};
}
test('complete counts, compact map-first view, review disclosure and explicit-only unit details',async({page},info)=>{
 const {frame,state}=await mount(page,{legacySelection:true});
 await expect(frame.locator('.field-map-kpis article b')).toHaveText(['319','116','0','107','96']);
 await expect(frame.locator('.field-map-kpis')).toContainText('UNKNOWN / STALE');await expect(frame.locator('.field-map-kpis')).toContainText('SUPPORT · 0 CAMERAS');
 await expect(frame.locator('.field-map-info')).not.toHaveAttribute('open');await expect(frame.locator('.router-map-note')).not.toBeVisible();await expect(frame.locator('.field-map-detail')).not.toBeVisible();
 const entryMap=await frame.locator('.field-map-center').boundingBox();expect(entryMap.y).toBeLessThan(page.viewportSize().height);if(page.viewportSize().width<=700)expect(page.viewportSize().height-80-entryMap.y).toBeGreaterThanOrEqual(240);await page.screenshot({path:info.outputPath('compact-map-entry.png')});
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();
 const boxes=await frame.locator('.field-map-layout').evaluate(el=>({map:el.querySelector('.field-map-center').getBoundingClientRect().top,list:el.querySelector('.field-map-list').getBoundingClientRect().top,width:innerWidth,scroll:document.documentElement.scrollWidth}));
 if(boxes.width<=700)expect(boxes.map).toBeLessThan(boxes.list);expect(boxes.scroll).toBeLessThanOrEqual(boxes.width+1);
 await page.screenshot({path:info.outputPath('compact-map.png')});
 await frame.locator('.field-map-list>button').first().click();await expect(frame.locator('.field-map-detail h2')).toHaveText('Solar Spotter 1');await frame.getByRole('button',{name:'Close unit details',exact:true}).click();await expect(frame.locator('.field-map-detail')).not.toBeVisible();
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-detail')).not.toBeVisible();
 await frame.locator('.field-map-info>summary').click();await expect(frame.getByRole('region',{name:'Placement records needing review'})).toContainText('Fixture placement needs identity review');await expect(frame.locator('.field-map-info')).toContainText('10 verified map pins');await expect(frame.locator('.field-map-info')).toContainText('Saved status refreshes every 15 minutes');
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
for(const fallback of [true,false])test(`map-only fullscreen ${fallback?'fallback':'native'} restores controls and supports Escape and Back`,async({page},info)=>{
 const {frame,state}=await mount(page);
 if(fallback)await frame.locator('body').evaluate(()=>{HTMLElement.prototype.requestFullscreen=undefined;});
 await frame.locator('.field-map-list>button').first().click();
 const initialStyle=await page.locator('iframe').getAttribute('style')||'';
 const enter=frame.getByRole('button',{name:'TV / fullscreen map',exact:true});
 for(const method of ['button','Escape','Back']){
  await enter.click();await expect(frame.locator('.field-map-workspace')).toHaveClass(/field-map-tv/);await expect(frame.getByRole('button',{name:'Exit TV view',exact:true})).toBeFocused();
  for(const selector of ['.field-map-display-bar','.field-map-kpis','.field-map-toolbar','.field-map-info','.field-map-list','.field-map-detail','.field-map-legend'])await expect(frame.locator(selector)).not.toBeVisible();
  await expect(page.locator('#outer-navigation')).not.toBeVisible();
  const map=await frame.locator('.field-map-center').boundingBox(),viewport=page.viewportSize();expect(map.x).toBeCloseTo(0,0);expect(map.y).toBeCloseTo(0,0);expect(map.width).toBe(viewport.width);expect(map.height).toBe(viewport.height);
  await expect(frame.locator('.leaflet-control-zoom-in')).toBeVisible();await expect(frame.getByRole('button',{name:'Fit map pins'})).toBeVisible();
  await frame.getByRole('button',{name:'Fit map pins'}).click();await page.clock.runFor(300);await expect.poll(()=>frame.locator('.field-map-center').evaluate(el=>{const controls=el.querySelector('.field-map-fullscreen-controls').getBoundingClientRect();return [...el.querySelectorAll('.cos-field-pin,.cos-field-cluster')].every(pin=>{const box=pin.getBoundingClientRect();return !(box.left<controls.right&&box.right>controls.left&&box.top<controls.bottom&&box.bottom>controls.top);});})).toBe(true);await frame.locator('.leaflet-control-zoom-in').click();await page.clock.runFor(500);
  const view=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);
  if(method==='button')await frame.getByRole('button',{name:'Exit TV view',exact:true}).click();else if(method==='Escape')await page.keyboard.press('Escape');else await frame.locator('body').evaluate(()=>history.back());
  await expect(frame.locator('.field-map-workspace')).not.toHaveClass(/field-map-tv/);await expect(enter).toBeFocused();await expect(page.locator('#outer-navigation')).toBeVisible();await expect(page.locator('iframe')).toHaveAttribute('style',initialStyle);
  const restored=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);expect(restored.zoom).toBe(view.zoom);expect(restored.center[0]).toBeCloseTo(view.center[0],3);expect(restored.center[1]).toBeCloseTo(view.center[1],3);
 }
 const saved=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);await frame.locator('body').evaluate(()=>location.hash='#camera-health');await expect(frame.locator('.camera-health-native')).toBeVisible();await frame.locator('body').evaluate(()=>history.back());await expect(frame.locator('.field-map-workspace')).toBeVisible();await expect.poll(()=>frame.locator('body').evaluate(()=>history.state.cosFieldMapView.zoom)).toBe(saved.zoom);
 await enter.click();await frame.getByRole('button',{name:'Fit map pins'}).click();await page.clock.runFor(500);await page.screenshot({path:info.outputPath(fallback?'map-only-fallback.png':'map-only-native.png')});await frame.getByRole('button',{name:'Exit TV view',exact:true}).click();expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});
test('failed initial load cannot enter an empty fullscreen without an exit',async({page})=>{const {frame,state}=await mount(page,{fail:true});await expect(frame.getByRole('alert')).toContainText('Field units could not be loaded');await expect(frame.getByRole('button',{name:'TV / fullscreen map'})).toBeDisabled();state.fail=false;await frame.getByRole('button',{name:'Retry map load'}).click();await expect(frame.getByRole('button',{name:'TV / fullscreen map'})).toBeEnabled();});

test('every field family stays searchable and mapped independently of unknown health',async({page})=>{
 const families=[['ST 001','STANDS'],['Sniper 21','SNIPERS'],['CAM V 31','CAM V & RSU'],['Recon 41','RECON'],['Solar Spotter 51','Solar Spotter'],['Spotter 61','Spotter'],['Ranger 71','Ranger'],['Helios 81','Helios']];
 const {frame,state}=await mount(page,{customUnits:families.map(([unitNumber,modelName],i)=>({...units[i],unitNumber,modelName}))});
 await expect(frame.locator('.field-map-kpis article').first().locator('b')).toHaveText('8');
 for(const [label] of families){await frame.getByLabel('Search field units').fill(label);await expect(frame.locator('.field-map-list>button')).toHaveCount(1);await expect(frame.locator('.cos-field-pin')).toHaveCount(1);await frame.locator('.field-map-list>button').click();await expect(frame.locator('.field-map-detail h2')).toHaveText(label);await expect(frame.getByRole('link',{name:'Open verified installation pin in Google Maps'})).toHaveAttribute('href',/^https:\/\/www.google.com\/maps/);await frame.getByRole('button',{name:'Close unit details'}).click();}
 await frame.getByLabel('Search field units').fill('');await expect(frame.locator('.field-map-list>button')).toHaveCount(8);expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});
test('late fullscreen completion and rapid re-entry do not strand normal UI in fullscreen',async({page})=>{
 const {frame}=await mount(page);
 await frame.locator('body').evaluate(()=>{let native=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>native});document.exitFullscreen=async()=>{native=null;document.dispatchEvent(new Event('fullscreenchange'));};HTMLElement.prototype.requestFullscreen=function(){const element=this;return new Promise(resolve=>{window.finishNativeFixture=()=>{native=element;document.dispatchEvent(new Event('fullscreenchange'));resolve();};});};});
 await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();
 await frame.locator('body').evaluate(()=>{document.querySelector('.field-map-fullscreen-exit').click();document.querySelector('.field-map-display-bar button').click();window.finishNativeFixture();});
 await expect(frame.locator('.field-map-workspace')).not.toHaveClass(/field-map-tv/);await expect.poll(()=>frame.locator('body').evaluate(()=>document.fullscreenElement===null)).toBe(true);await expect.poll(()=>frame.locator('body').evaluate(()=>Boolean(history.state?.cosFieldMapDisplay))).toBe(false);await expect(page.locator('#outer-navigation')).toBeVisible();
});

test('TV-size fallback shows only a full-bleed map and minimal controls',async({page},info)=>{await page.setViewportSize({width:1920,height:1080});const {frame,state}=await mount(page);await frame.locator('body').evaluate(()=>{HTMLElement.prototype.requestFullscreen=undefined;});await frame.getByRole('button',{name:'TV / fullscreen map',exact:true}).click();await expect(frame.locator('.field-map-display-bar')).not.toBeVisible();await expect(page.locator('#outer-navigation')).not.toBeVisible();const bounds=await frame.locator('.field-map-center').boundingBox();expect(bounds).toEqual({x:0,y:0,width:1920,height:1080});await page.screenshot({path:info.outputPath('map-only-tv-1920.png')});await frame.getByRole('button',{name:'Exit TV view',exact:true}).click();expect(state.errors).toEqual([]);});
