import {test,expect} from '@playwright/test';
import {snapshot,resource,now} from './fixtures/camera-evidence-fixtures.mjs';

const origin='http://127.0.0.1:4173';
const stamp=new Date(now).toISOString();
const units=Array.from({length:3},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,unitNumber:`Solar Spotter ${index+1}`,modelName:'Solar Spotter',status:'field',currentLocationType:'field',address:`${index+1} Fixture Street`,latitude:index<2?29.5+index: null,longitude:index<2?-95+index:null,hasUnitGps:false,coordinateSource:index<2?'site':null,locationVerification:index<2?'owner_verified':'address_only',gpsRecordedAt:index<2?stamp:null,locationVerifiedAt:index<2?stamp:null}));
const field={items:units,summary:{fieldUnits:3,mappedUnits:2,unitGps:0,missingGps:1},generatedAt:stamp};
async function mount(page,{workspace='field-map'}={}){
 const state={calls:[],tiles:0,pending:[],hold:true,fail:false,errors:[]};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/progressive-map-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#${workspace}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-progressive-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url)){state.tiles++;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d5e5db"/><path d="M0 64H256M64 0V256" stroke="#fff" stroke-width="8"/></svg>'});}
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.calls.push(request);expect(request.method).toBe('GET');
  if(request.path==='/api/field-map'&&state.hold)await new Promise(resolve=>state.pending.push(resolve));
  if(request.path==='/api/field-map'&&state.fail)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic field read unavailable'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}:request.path==='/api/field-map'?field:request.path==='/api/camera-health/summary-v3'?snapshot([resource(1),resource(2)]):request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}:request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:stamp}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/progressive-map-fixture');
 const frame=page.frameLocator('iframe');
 await expect.poll(()=>state.pending.length).toBeGreaterThan(0);
 state.release=()=>{state.hold=false;state.pending.splice(0).forEach(resolve=>resolve());};
 return {frame,state};
}

test('basemap renders while field records wait, with no invented pins or empty fleet',async({page},info)=>{
 const {frame,state}=await mount(page);
 const canvas=frame.locator('.field-map-canvas');
 await expect(canvas).toBeVisible();await expect(canvas).toHaveClass(/leaflet-container/);
 await expect(frame.locator('.field-map-display-bar')).toContainText('Loading field locations…');
 await expect.poll(()=>state.tiles).toBeGreaterThan(0);
 await expect(canvas.locator('.leaflet-tile-loaded').first()).toBeVisible();
 await expect(frame.getByRole('status').filter({hasText:'Loading production field units'})).toBeVisible();
 await expect(frame.locator('.field-map-kpis article b')).toHaveText(['—','—','—','—','—']);
 await expect(frame.locator('.cos-field-pin,.cos-field-cluster')).toHaveCount(0);
 await expect(frame.getByText('No units match this filter.')).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'TV / fullscreen map'})).toBeDisabled();
 await canvas.evaluate(node=>node.dataset.persistentMap='yes');
 await page.screenshot({path:info.outputPath('basemap-before-field-records.png'),fullPage:true});
 state.release();
 await expect(frame.locator('.field-map-list>button')).toHaveCount(3);
 await expect(frame.locator('.cos-field-pin')).toHaveCount(2);
 await expect(canvas).toHaveAttribute('data-persistent-map','yes');
 await expect(frame.getByRole('button',{name:'TV / fullscreen map'})).toBeEnabled();
 expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('initial field failure preserves the basemap and retry fills the same canvas',async({page})=>{
 const {frame,state}=await mount(page);const canvas=frame.locator('.field-map-canvas');
 await expect(canvas).toHaveClass(/leaflet-container/);await canvas.evaluate(node=>node.dataset.persistentMap='yes');
 state.fail=true;state.release();
 await expect(frame.getByRole('alert')).toContainText('Field units could not be loaded. This does not mean the fleet is empty.');
 await expect(canvas).toBeVisible();await expect(frame.locator('.cos-field-pin,.cos-field-cluster')).toHaveCount(0);
 await expect(frame.locator('.field-map-kpis article b')).toHaveText(['—','—','—','—','—']);
 state.fail=false;await frame.getByRole('button',{name:'Retry map load'}).click();
 await expect(frame.locator('.field-map-list>button')).toHaveCount(3);await expect(frame.locator('.cos-field-pin')).toHaveCount(2);
 await expect(canvas).toHaveAttribute('data-persistent-map','yes');
 state.fail=true;await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.getByRole('alert')).toContainText('Map refresh failed. Showing the last successfully loaded units.');
 await expect(frame.locator('.field-map-list>button')).toHaveCount(3);await expect(canvas).toHaveAttribute('data-persistent-map','yes');
 expect(state.errors).toEqual([]);
});

test('Camera Health remains useful before and after the independent field read fails',async({page})=>{
 const {frame,state}=await mount(page,{workspace:'camera-health'});
 const health=frame.getByRole('region',{name:'Camera Health',exact:true});
 await expect(health.getByRole('button',{name:/Provider systems online/})).toContainText('2');
 await expect(health.getByText('Loading Camera Health…')).toHaveCount(0);
 state.fail=true;state.release();
 await expect(health.getByRole('alert')).toContainText('Field locations unavailable: Synthetic field read unavailable. Saved Camera Health observations load separately.');
 await expect(health.getByRole('button',{name:/Provider systems online/})).toContainText('2');
 state.fail=false;await health.getByRole('button',{name:'Reload saved results'}).click();
 await expect(health.getByText(/Field locations unavailable/)).toHaveCount(0);
 expect(state.errors).toEqual([]);
});
