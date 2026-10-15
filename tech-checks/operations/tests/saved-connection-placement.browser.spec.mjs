import {test,expect} from '@playwright/test';
import {port,resource,snapshot,now,fresh,withStatus} from './fixtures/camera-evidence-fixtures.mjs';
test('fresh connection survives inactive inventory; refresh and aging never change placement',async({page},testInfo)=>{
 const origin='http://127.0.0.1:4173',id='11111111-1111-4111-8111-111111111111',writes=[];
 const unit={id,unitNumber:'Sniper 901',modelName:'SNIPERS',status:'field',currentLocationType:'field',readOnly:true,address:'123 Synthetic St',site:'Synthetic site',customer:'Synthetic customer',latitude:null,longitude:null,hasUnitGps:false,locationVerification:'address_only'};
 const row={...resource(9901,'SNIPER 901',{type:'Sniper'}),scope:'inactive',activationState:'deactivated',organization:'root',evidence:undefined,serviceEvidence:port({active:false})};
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/saved-connection-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#camera-health?diagnostics=1&unit=${id}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();if(request.method!=='GET'){writes.push(request);return route.fulfill({status:400,headers,body:JSON.stringify({error:'No synthetic writes'})});}
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner',features:{fieldLocationVerification:true}}
   :request.path==='/api/field-map'?{items:[unit],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:new Date(now).toISOString()}
   :request.path==='/api/camera-health/summary-v3'?snapshot([row])
   :request.path==='/api/equipment'?{items:[unit],models:[]}
   :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:new Date(now).toISOString()}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/saved-connection-fixture');const frame=page.frameLocator('iframe');
 await expect(frame.locator('.camera-unit-state')).toHaveText('IP / PORT ONLINE');
 await expect(frame.locator('.camera-unit-detail')).toContainText('PLACEMENT CONFLICT');
 await expect(frame.locator('.camera-unit-detail')).toContainText('INACTIVE');
 await expect(frame.locator('.camera-health-native')).toContainText('Last reported service result: ONLINE');
 await frame.getByRole('button',{name:'Reload saved results',exact:true}).click();await expect(frame.locator('.camera-unit-state')).toHaveText('IP / PORT ONLINE');
 await page.screenshot({path:testInfo.outputPath('saved-online-placement-conflict.png')});
 await page.clock.fastForward(16*60*1000);await expect(frame.locator('.camera-unit-state')).toHaveText('IP / PORT UNKNOWN');
 await expect(frame.locator('.camera-health-native')).toContainText('Last reported service result: ONLINE');expect(writes).toHaveLength(0);expect(row.activationState).toBe('deactivated');expect(row.serviceEvidence.observedAt).toBe(fresh);
});


test('Fleet keeps reachable Shop Snipers 308 and 317 visible for review and outside Field outage totals',async({page})=>{
 const {mountFleet}=await import('./fleet-dashboard-fixtures.mjs');
 const units=[308,317,901].map((number,index)=>({id:'11111111-1111-4111-8111-'+String(index+1).padStart(12,'0'),unitNumber:(index===2?'Helios ':'Sniper ')+number,modelName:index===2?'Helios':'Snipers',status:index===2?'field':'available',currentLocationType:index===2?'field':'shop',placement:index===2?'FIELD':'SHOP',address:'Synthetic saved location',site:'Synthetic site'}));
 const field={items:[units[2]],inventoryItems:units,summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:fresh};
 const health=snapshot([resource(308,'Sniper 308',{type:'Sniper',scope:'shop',activationState:'deactivated',evidence:undefined,serviceEvidence:port({active:false})}),resource(317,'Sniper 317',{type:'Sniper',scope:'shop',activationState:'deactivated',evidence:undefined,serviceEvidence:port({active:false})}),withStatus(resource(901,'Helios 901'),'offline')]);
 const {app,state}=await mountFleet(page,false,{field,health});await expect(app.locator('.cos-fleet-stat-offline strong')).toHaveText('1');await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(1);
 await app.getByLabel('Fleet placement').selectOption('shop');await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(2);await expect(app.locator('.cos-dashboard-marker')).toHaveCount(0);
 for(const number of [308,317]){await app.locator('.cos-fleet-unit-row').filter({hasText:'Sniper '+number}).click();const dialog=app.getByRole('dialog');await expect(dialog).toContainText('PLACEMENT REVIEW: SHOP / ROOT + service reachable');await expect(dialog).toContainText('camera video is not verified');await dialog.getByRole('button',{name:'Close unit details'}).click();}
 await app.getByLabel('Fleet placement').selectOption('field');await expect(app.locator('.cos-fleet-stat-offline strong')).toHaveText('1');expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
