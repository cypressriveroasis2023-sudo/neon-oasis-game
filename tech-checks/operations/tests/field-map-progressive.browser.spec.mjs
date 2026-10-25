import {test,expect} from '@playwright/test';
import {snapshot,resource,now} from './fixtures/camera-evidence-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

const origin='http://127.0.0.1:4173';
const stamp=new Date(now).toISOString();
const units=Array.from({length:3},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,unitNumber:`Solar Spotter ${index+1}`,modelName:'Solar Spotter',status:'field',currentLocationType:'field',address:`${index+1} Fixture Street`,latitude:index<2?29.5+index: null,longitude:index<2?-95+index:null,hasUnitGps:false,coordinateSource:index<2?'site':null,locationVerification:index<2?'owner_verified':'address_only',gpsRecordedAt:index<2?stamp:null,locationVerifiedAt:index<2?stamp:null}));
const field={items:units,summary:{fieldUnits:3,mappedUnits:2,unitGps:0,missingGps:1},generatedAt:stamp};
function reviewedPair(){
 const f=fieldProductFixture();
 const records=units.map((unit,i)=>({...f.upload.records[i],unitNumber:unit.unitNumber,category:unit.modelName,binding:{state:'linked',unitIds:[unit.id],candidateUnitIds:[],placementHeld:false}}));
 const items=units.map((unit,i)=>({...f.roster.items[i],unit,unitId:unit.id,unitNumber:unit.unitNumber,representedUnitIds:[unit.id]}));
 const uploadInventory={...f.upload,records,summary:{totalRecords:3,fieldRecords:3,shopRecords:0,unflaggedFieldRecords:3,unflaggedShopRecords:0,doNotUseRecords:0,missingRecords:0}};
 const fleetRoster={...f.roster,items,summary:{totalRecords:3,activeRecords:3,field:3,shop:0,review:0,excludedLifecycle:0,sourceOnlyRecords:0,linkedUnitRecords:3}};
 const health={...snapshot([resource(1,'Solar Spotter 1'),resource(2,'Solar Spotter 2')]),identityVersion:1,unitIdentities:units.slice(0,2).map((unit,i)=>({...f.health.unitIdentities[i],unitId:unit.id,unitNumber:unit.unitNumber,unitKeys:[unit.unitNumber]})),identityWarnings:[]};
 return {field:{...field,inventoryItems:units,uploadInventory,fleetRoster},health};
}
async function mount(page,{workspace='field-map',healthFail=false,canonical=false}={}){
 const reviewed=canonical?reviewedPair():null;
 const state={calls:[],tiles:0,pending:[],hold:true,fail:false,errors:[]};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/progressive-map-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#${workspace}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-progressive-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//.test(url)){state.tiles++;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d5e5db"/><path d="M0 64H256M64 0V256" stroke="#fff" stroke-width="8"/></svg>'});}
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.calls.push(request);expect(request.method).toBe('GET');
  if(request.path==='/api/field-map'&&state.hold)await new Promise(resolve=>state.pending.push(resolve));
  if(request.path==='/api/field-map'&&state.fail)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic field read unavailable'})});
  if(request.path==='/api/camera-health/summary-v3'&&healthFail)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic camera read unavailable'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}:request.path==='/api/field-map'?(reviewed?.field||field):request.path==='/api/camera-health/summary-v3'?(reviewed?.health||snapshot([resource(1,'Solar Spotter 1'),resource(2,'Solar Spotter 2')])):request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}:request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:stamp}:{items:[]};
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
 const canvas=frame.locator('.cos-fleet-map-canvas');
 await expect(canvas).toBeVisible();await expect(canvas).toHaveClass(/leaflet-container/);
 await expect(frame.getByRole('status').filter({hasText:'Loading the authenticated COS fleet'})).toBeVisible();
 await expect.poll(()=>state.tiles).toBeGreaterThan(0);
 await expect(canvas.locator('.leaflet-tile-loaded').first()).toBeVisible();
 await expect(frame.getByRole('status').filter({hasText:'Loading the authenticated COS fleet'})).toBeVisible();
 await expect(frame.locator('.cos-fleet-stats strong')).toHaveText(['—','—','—','—','—','—','—']);
 await expect(frame.locator('.cos-field-pin,.cos-field-cluster')).toHaveCount(0);
 await expect(frame.getByText('No units match this filter.')).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'Fullscreen fleet map'})).toBeEnabled();
 await canvas.evaluate(node=>node.dataset.persistentMap='yes');
 await page.screenshot({path:info.outputPath('basemap-before-field-records.png'),fullPage:true});
 state.release();
 await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(3);
 await expect(frame.getByLabel('Fleet status',{exact:true})).toHaveValue('all');
 await expect(frame.locator('.cos-fleet-unit-row').filter({hasText:'Solar Spotter 3'})).toContainText('Camera status unverified');
 await expect(frame.locator('.cos-field-pin')).toHaveCount(2);
 await expect(canvas).toHaveAttribute('data-persistent-map','yes');
 await expect(frame.getByRole('button',{name:'Fullscreen fleet map'})).toBeEnabled();
 expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('verified field locations remain available when the first camera read fails',async({page})=>{
 const {frame,state}=await mount(page,{healthFail:true});state.release();
 await frame.getByLabel('Fleet status',{exact:true}).selectOption('all');
 await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(3);await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(2);await expect(frame.locator('.cos-field-pin[data-health="online"],.cos-field-pin[data-health="offline"]')).toHaveCount(0);
 expect(state.calls.filter(r=>r.path==='/api/field-map')).toHaveLength(1);expect(state.calls.filter(r=>r.path==='/api/camera-health/summary-v3')).toHaveLength(1);expect(state.errors).toEqual([]);
});

test('initial field failure preserves the basemap and retry fills the same canvas',async({page})=>{
 const {frame,state}=await mount(page);const canvas=frame.locator('.cos-fleet-map-canvas');
 await expect(canvas).toHaveClass(/leaflet-container/);await canvas.evaluate(node=>node.dataset.persistentMap='yes');
 state.fail=true;state.release();
 await expect(frame.getByRole('alert')).toContainText('Synthetic field read unavailable');
 await expect(canvas).toBeVisible();await expect(frame.locator('.cos-field-pin,.cos-field-cluster')).toHaveCount(0);
 await expect(frame.locator('.cos-fleet-stats strong')).toHaveText(['—','—','—','—','—','—','—']);
 state.fail=false;await frame.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(3);await expect(frame.locator('.cos-field-pin')).toHaveCount(2);
 await expect(canvas).toHaveAttribute('data-persistent-map','yes');
 state.fail=true;await frame.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(frame.getByRole('alert')).toContainText('Synthetic field read unavailable');
 await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(3);await expect(canvas).toHaveAttribute('data-persistent-map','yes');
 expect(state.errors).toEqual([]);
});

test('Camera Health publishes only a complete paired snapshot and retries both sources together',async({page})=>{
 const {frame,state}=await mount(page,{workspace:'camera-health?diagnostics=1',canonical:true}),health=frame.getByRole('region',{name:'Camera Health',exact:true});
 await expect(health.getByText('Loading Camera Health…')).toBeVisible();await expect(health.locator('.camera-unit-kpis')).toHaveCount(0);
 state.fail=true;state.release();await expect(health.getByRole('alert')).toContainText('Synthetic field read unavailable');await expect(health.locator('.camera-unit-kpis')).toHaveCount(0);
 state.fail=false;state.hold=true;await health.getByRole('button',{name:'Reload saved results'}).click();
 await expect.poll(()=>state.pending.length).toBe(1);
 await expect.poll(()=>state.calls.filter(r=>r.path==='/api/camera-health/summary-v3').length).toBe(2);
 await expect(health.locator('.camera-unit-kpis')).toHaveCount(0);
 state.release();
 await expect(health.getByLabel('Shared field unit health totals').locator('b')).toHaveText(['3','2','0','1']);
 await health.getByRole('button',{name:'Camera units 3',exact:true}).click();
 const products=health.getByLabel('Field Product-ID camera units');
 await expect(products.locator('article')).toHaveCount(3);
 await expect(products.locator('article').filter({hasText:'Solar Spotter 3'})).toContainText('Health unverified');
 expect(state.calls.filter(r=>r.path==='/api/field-map')).toHaveLength(2);
 expect(state.calls.filter(r=>r.path==='/api/camera-health/summary-v3')).toHaveLength(2);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('paired legacy provider data without a reviewed Product-ID census keeps Field totals unavailable',async({page})=>{
 const {frame,state}=await mount(page,{workspace:'camera-health?diagnostics=1'});state.release();
 await expect(frame.getByLabel('Shared field unit health totals').locator('b')).toHaveText(['—','—','—','—']);
 await expect(frame.getByLabel('Camera Health unit cards').locator('article')).toHaveCount(3);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
