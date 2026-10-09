import {test,expect} from '@playwright/test';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';
const now='2026-10-09T05:00:00Z',fresh='2026-10-09T04:59:00Z',old='2026-10-07T01:00:00Z',id='a0000000-0000-4000-8000-000000000001',key='RII-901 Synthetic area';
async function mount(page,{stale=false}={}){
 const unit={id,unitNumber:'Recon II 901',modelName:'RECON II',readOnly:true,status:'field',currentLocationType:'field',address:'100 Synthetic Road',site:'Synthetic site',customer:'Synthetic customer',latitude:null,longitude:null,locationVerification:'address_only',hasUnitGps:false};
 const rows=Array.from({length:6},(_,i)=>resource(i+1,key,{name:'Synthetic detector '+(i+1),type:'Reconeyez detector',evidence:{kind:'provider',source:'Reconeyez',resource:'detector',active:true,status:'online',observedAt:stale||i>=4?old:fresh,lastOnlineAt:old},batteryEvidence:{source:'Reconeyez',percent:22,percentObservedAt:old,status:'low',statusObservedAt:old}}));
 const state={writes:[],warnings:[],identity:{unitId:id,unitNumber:unit.unitNumber,kind:'reconeyez_area',deviceIds:rows.map(r=>String(r.id)),unitKeys:[key],proof:'a'.repeat(64),providerArea:{detectorCount:6,inventoryObservedAt:fresh,bridgeLastEventAt:fresh}}};
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/recon-area-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#camera-health?unit=${id}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.hostname==='127.0.0.1')return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();if(body.method!=='GET'){state.writes.push(body);return route.fulfill({status:400,headers,body:'{}'});}
  const data=body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fleetAccess:true,fieldLocationVerification:true}}
   :body.path==='/api/field-map'?{items:[unit],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:now}
   :body.path==='/api/camera-health/summary-v3'?{...snapshot(rows),refreshedAt:now,identityVersion:1,unitIdentities:[],reconProviderIdentityVersion:1,reconProviderUnitIdentities:state.warnings.length?[]:[state.identity],identityWarnings:state.warnings}
   :body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/recon-area-fixture');const frame=page.frameLocator('iframe');await expect(frame.locator('.camera-unit-detail h3')).toHaveText(unit.unitNumber);await expect(frame.locator('.camera-device-cards article')).toHaveCount(6);return {frame,state};
}
test('provider-area, bridge contact and six detector battery observations remain separate on desktop and mobile',async({page},info)=>{
 const {frame,state}=await mount(page);await expect(frame.locator('.camera-unit-state')).toContainText('MIXED / PARTLY VERIFIED');
 const group=frame.getByRole('region',{name:'Reviewed Reconeyez provider-area association'});await expect(group).toContainText('4 of 6 detector records recently online');await expect(group).toContainText('2 unverified');await expect(group).toContainText('6 reported detectors');await expect(group).toContainText('one uniquely identified bridge');await expect(group).toContainText('does not prove physical radio pairing');await expect(group).toContainText('Bridge event last received');
 await expect(frame.getByRole('region',{name:'Recon battery health'})).toHaveCount(6);await expect(frame.getByRole('region',{name:'Recon battery health'}).first()).toContainText('22%');await expect(frame.getByRole('region',{name:'Recon battery health'}).first()).toContainText('LOW');
 expect(await frame.locator('body').evaluate(el=>el.scrollWidth>innerWidth+1)).toBe(false);await frame.locator('.camera-unit-detail').screenshot({path:info.outputPath('recon-area-bridge-separation.png')});expect(state.writes).toEqual([]);
});
test('fresh bridge cannot green stale detectors; revoked membership keeps field record and raw provider records visible',async({page})=>{
 const {frame,state}=await mount(page,{stale:true});await expect(frame.locator('.camera-unit-state')).toContainText('UNVERIFIED');
 state.warnings=[{unitId:id,reason:'Provider-area detector membership changed.',deviceIds:['1','2','3','4','5','6'],unitKeys:[key]}];await frame.getByRole('button',{name:'Reload saved results',exact:true}).click();await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Recon II 901');await expect(frame.locator('.camera-unit-detail')).toContainText('Provider-area detector membership changed.');
 await frame.locator('body').evaluate(()=>{location.hash='camera-health';});await expect(frame.locator('.camera-overview-card')).toHaveCount(2);const raw=frame.getByRole('button',{name:'Open '+key+' unit details',exact:true});await raw.click();const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(detail.locator('.camera-device-cards article')).toHaveCount(6);await expect(detail).toContainText('EQUIPMENT LINK UNVERIFIED');await detail.getByRole('button',{name:'Back to units',exact:true}).click();await expect(raw).toBeFocused();expect(state.writes).toEqual([]);
});
