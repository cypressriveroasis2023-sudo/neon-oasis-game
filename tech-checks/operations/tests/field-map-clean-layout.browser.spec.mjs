// Isolated fixture only. All external traffic is blocked; counts and locations are synthetic.
import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {withReviewedResources} from './fixtures/reviewed-camera-fixtures.mjs';
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
  if(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dce5df"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#fff" stroke-width="8"/><text x="15" y="130" font-size="12" fill="#778877">Fixture map</text></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.calls.push(request);expect(request.method).toBe('GET');
  if(request.path==='/api/field-map'&&state.fail)return route.fulfill({status:503,headers,body:JSON.stringify({error:'Synthetic load failed'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner'}:request.path==='/api/field-map'?{items:customUnits,summary:{fieldUnits:customUnits.length,mappedUnits:customUnits.filter(u=>u.latitude!==null).length,unitGps:0,missingGps:customUnits.filter(u=>u.latitude===null).length},generatedAt:new Date(now).toISOString(),placementReviews:[{unitNumber:'SOLARSPOTTER REVIEW',reason:'Fixture placement needs identity review',placementAuditId:null}]}:request.path==='/api/camera-health/summary-v3'?withReviewedResources(snapshot(customUnits.slice(0,116).map((u,i)=>resource(i+1,u.unitNumber))),customUnits.slice(0,116).map((unit,i)=>({unit,ids:[i+1]}))):request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:new Date(now).toISOString()}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.addInitScript(()=>{if(parent!==window)history.replaceState({...history.state,cosFieldMapView:{...history.state?.cosFieldMapView,health:history.state?.cosFieldMapView?.health||'all'}},'');});
 await page.goto('/clean-fixture');const frame=page.frameLocator('iframe');await expect(frame.locator('.cos-fleet-dashboard')).toBeVisible();if(!fail)await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(Math.min(80,customUnits.length));return {frame,state};
}
test('canonical dashboard retains full fleet counts, bounded map, readable markers and explicit-only details',async({page},info)=>{
 const {frame,state}=await mount(page,{legacySelection:true});
 await expect(frame.locator('.cos-fleet-stats strong')).toHaveText(['319','—','—','116','0','107','309']);
 await expect(frame.locator('.cos-fleet-count-note')).toContainText('96 support units have 0 cameras');
 await expect(frame.getByRole('dialog')).toHaveCount(0);
 const canvas=frame.locator('.cos-fleet-map-canvas');await canvas.scrollIntoViewIfNeeded();
 const size=await canvas.boundingBox();expect(size.height).toBeLessThan(750);expect(size.width).toBeGreaterThan(150);
 const symbol=frame.locator('.cos-field-cluster,.cos-field-pin').first(),artworkSize=await symbol.evaluate(node=>node.classList.contains('cos-field-cluster')?'32px':'28px');await expect(symbol).toHaveCSS('width',artworkSize);await expect(symbol).toHaveCSS('height','28px');
 const touch=frame.locator('.cos-field-cluster-wrap,.cos-field-pin-wrap').first();await expect(touch).toHaveCSS('width','44px');await expect(touch).toHaveCSS('height','56px');
 await frame.locator('.cos-fleet-unit-row').first().click();await expect(frame.getByRole('dialog')).toContainText('Solar Spotter 1');
 await frame.getByRole('button',{name:'Close unit details',exact:true}).click();
 await frame.getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect(frame.getByRole('dialog')).toHaveCount(0);
 await frame.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:/Location verification/}).click();
 await expect(frame.getByRole('heading',{name:'Location verification · 309 units'})).toBeVisible();
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
 await page.screenshot({path:info.outputPath('unified-fleet-large-review.png')});
});
test('map-only fullscreen restores the dashboard and outer host on button, Escape and Back',async({page})=>{
 test.setTimeout(120000);const {frame,state}=await mount(page);const enter=frame.getByRole('button',{name:'Fullscreen fleet map',exact:true});
 for(const method of ['button','Escape','Back']){
  await enter.click();await expect(frame.locator('.cos-fleet-map-expanded')).toBeVisible();
  await expect(page.locator('#outer-navigation')).not.toBeVisible();await expect(frame.locator('.cos-fleet-filters')).not.toBeVisible();
  const box=await frame.locator('.cos-fleet-map-panel').boundingBox();expect(box.x).toBe(0);expect(box.y).toBe(0);expect(box.width).toBe(page.viewportSize().width);expect(box.height).toBe(page.viewportSize().height);
  if(method==='button')await frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true}).click();
  else if(method==='Escape')await frame.getByRole('button',{name:'Exit fullscreen fleet map'}).press('Escape');
  else await page.goBack({timeout:2000,waitUntil:'commit'}).catch(error=>{if(!String(error).includes('Timeout'))throw error;});
  await expect(frame.locator('.cos-fleet-map-expanded')).toHaveCount(0);await expect(page.locator('#outer-navigation')).toBeVisible();await expect(enter).toBeFocused();
 }
 expect(state.errors).toEqual([]);
});
test('a failed field read retains a basemap and fullscreen always has an exit',async({page})=>{
 const {frame}=await mount(page,{fail:true});await expect(frame.getByRole('alert').first()).toBeVisible();
 await frame.getByRole('button',{name:'Fullscreen fleet map',exact:true}).click();await expect(frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true})).toBeVisible();
 await frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true}).click();await expect(frame.locator('.cos-fleet-map-expanded')).toHaveCount(0);
});
test('every field family remains searchable with stale evidence and cannot inherit a confirmed outage',async({page})=>{
 const {frame,state}=await mount(page);await frame.getByLabel('Search units, customers, sites or addresses').fill('Solar Spotter 200');await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(1);
 await expect(frame.locator('.cos-fleet-unit-row [aria-label="camera: Unverified"]')).toBeVisible();expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});
test('TV-size fullscreen keeps the one map bounded at 1920 pixels and returns cleanly',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});const {frame,state}=await mount(page);
 await frame.getByRole('button',{name:'Fullscreen fleet map',exact:true}).click();
 const bounds=await frame.locator('.cos-fleet-map-panel').boundingBox();expect(bounds).toEqual({x:0,y:0,width:1920,height:1080});
 await page.screenshot({path:info.outputPath('unified-map-only-tv.png')});await frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true}).click();expect(state.errors).toEqual([]);
});
