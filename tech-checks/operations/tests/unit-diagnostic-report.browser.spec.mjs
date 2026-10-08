import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resource,port,snapshot,withStatus,fresh,now} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_DIAGNOSTIC_TEST_ORIGIN||'http://127.0.0.1:4173';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const site='55555555-5555-4555-8555-555555555555',customer='66666666-6666-4666-8666-666666666666';
async function mount(page,{selected=false,oldApi=false,hostile=false}={}){
 const state={requests:[],writes:[],fail:false,hold:false,release:null};
 const units=ids.map((id,i)=>({id,unitNumber:['Ranger 1','Ranger 2','Sniper 3','Solar Stand 72 044'][i],modelName:i===2?'SNIPERS':i===3?'SOLAR STANDS 72':'Ranger',status:'installed',currentLocationType:'site',installedSiteId:site,customer:'Synthetic customer',site:'Synthetic site',address:'100 Synthetic Road'}));
 const rows=[withStatus(resource(101,'Ranger 1',{name:hostile?'Front <img src=x onerror="window.reportXss=true"> {"password":"hidden-password"} //private.test/path?token=hidden-token user@example.com':'Front camera',connection:{publicIp:'203.0.113.50',ports:[80,443,554]},source_metadata:{password:'raw-metadata-secret'},serviceEvidence:port({lastOnlineAt:'2026-10-05T12:00:00Z'})}),'offline'),withStatus(resource(102,'Ranger 2',{name:'Older camera'}),'offline','2026-10-05T12:00:00Z')];
 const health={...snapshot(rows),...(oldApi?{evidenceVersion:1,inventory:undefined}:{})};
 await page.clock.install({time:new Date(now)});
 await page.addInitScript(()=>{window.copiedReports=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.rejectClipboard)throw new Error('Synthetic clipboard denial');window.copiedReports.push(text);}}});});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/native-report-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#camera-health${selected?'?unit='+ids[0]:''}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/')&&/open-sans-(?:bold|regular|semibold)\.woff$/.test(url))return route.fulfill({contentType:'font/woff',body:await readFile(new URL('../../resources/fonts/'+url.split('/').at(-1),import.meta.url))});
  if(url.startsWith(origin+'/'))return route.continue();
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.requests.push(request);
  if(request.method!=='GET'){state.writes.push(request);return route.fulfill({status:400,headers,body:JSON.stringify({error:'Synthetic writes disabled'})});}
  if(request.path==='/api/camera-health/summary-v3'){
   if(state.hold)await new Promise(resolve=>state.release=resolve);
   if(state.fail)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider unavailable'})});
  }
  const data=request.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fleetAccess:true}}
   :request.path==='/api/camera-health/summary-v3'?health
   :request.path==='/api/field-map'?{items:units,summary:{fieldUnits:units.length,mappedUnits:0,unitGps:0,missingGps:units.length},generatedAt:new Date(now).toISOString()}
   :request.path==='/api/equipment'?{items:units,models:[]}
   :request.path==='/api/customers'?{items:[{id:customer,name:'Synthetic customer',status:'active'}]}
   :request.path==='/api/sites'?{items:[{id:site,name:'Synthetic site',status:'active',customerId:customer,customer:'Synthetic customer'}]}
   :request.path==='/api/owner/control-data'?{sites:[{id:site,name:'Synthetic site',customer_id:customer,customers:{name:'Synthetic customer'}}],truckChecks:[],itTechnicians:[],serviceTechnicians:[]}
   :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:new Date(now).toISOString()}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin+'/native-report-fixture');const frame=page.frameLocator('iframe'),child=page.frames().find(child=>child.parentFrame());
 await expect(frame.getByRole('heading',{name:'Camera Health',exact:true,level:2})).toBeVisible();
 if(selected)await expect(frame.getByRole('region',{name:'Unit diagnostic report'})).toBeVisible();else await expect(frame.locator('.camera-overview-card')).toHaveCount(oldApi?2:3);
 return {frame,child,state};
}
test('report copy/download is scoped, sanitized and keyboard/mobile accessible',async({page},info)=>{
 const {frame,child,state}=await mount(page,{hostile:true});
 expect(await frame.locator('.camera-overview-card').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining('Solar Stand')]));
 const opener=frame.getByRole('button',{name:'Open Ranger 1 unit details'});await opener.focus();await page.keyboard.press('Enter');
 const dialog=frame.getByRole('dialog',{name:'Camera Health unit details'}),report=dialog.getByRole('region',{name:'Unit diagnostic report'});
 await expect(report.getByRole('link',{name:'Verify unit in diagnostics'})).toHaveAttribute('href','../../camera-health.html?q=Ranger%201');
 await report.getByText('Review report text',{exact:true}).click();const text=await report.getByLabel('Unit diagnostic report text').inputValue();
 expect(text).toContain('Current trusted provider result: OFFLINE');expect(text).toContain('Current saved service result: Service endpoint reachable');expect(text).toContain('Observed per-port results: Unavailable');
 for(const secret of ['hidden-password','hidden-token','private.test','user@example.com','raw-metadata-secret','203.0.113.50','<img'])expect(text).not.toContain(secret);
 await report.getByRole('button',{name:'Copy report',exact:true}).click();await expect(report.getByRole('status')).toContainText('Report copied');expect(await child.evaluate(()=>copiedReports.at(-1))).toBe(text);
 const filePromise=page.waitForEvent('download');await report.getByRole('button',{name:'Download report',exact:true}).click();const file=await filePromise;expect(file.suggestedFilename()).toBe('cos-ranger-1-diagnostic.txt');expect(await readFile(await file.path(),'utf8')).toBe(text);
 await report.scrollIntoViewIfNeeded();const bounds=await dialog.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
 await page.screenshot({path:info.outputPath('native-unit-diagnostic-report.png'),fullPage:true});expect(await child.evaluate(()=>Boolean(window.reportXss))).toBe(false);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 await frame.getByRole('button',{name:'Open Ranger 2 unit details'}).click();await frame.getByText('Review report text',{exact:true}).click();const next=await frame.getByLabel('Unit diagnostic report text').inputValue();expect(next).toContain('Older camera');expect(next).not.toContain('Front camera');expect(next).toContain('current status unverified');expect(state.writes).toEqual([]);
});
test('gray inventory-only units keep verification/report access without inventing port results',async({page})=>{
 const {frame,state}=await mount(page);await frame.getByRole('button',{name:'Open Sniper 3 unit details'}).click();const report=frame.getByRole('region',{name:'Unit diagnostic report'});await report.getByText('Review report text',{exact:true}).click();const text=await report.getByLabel('Unit diagnostic report text').inputValue();expect(text).toContain('Inventory-only resource');expect(text).toContain('No exact current resource match');expect(text).not.toContain('Current trusted provider result: ONLINE');await expect(report.getByRole('link',{name:'Verify unit in diagnostics'})).toBeVisible();expect(state.writes).toEqual([]);
});
test('failed reads and old DTOs cannot revive trusted reports; clipboard denial has usable fallback',async({page})=>{
 const {frame,child,state}=await mount(page,{selected:true});const report=frame.getByRole('region',{name:'Unit diagnostic report'});await child.evaluate(()=>window.rejectClipboard=true);await report.getByRole('button',{name:'Copy report',exact:true}).click();await expect(report.getByRole('status')).toContainText('Clipboard unavailable');await report.getByText('Review report text',{exact:true}).click();await expect(report.getByLabel('Unit diagnostic report text')).toHaveValue(/Current trusted provider result: OFFLINE/);
 state.fail=true;await frame.getByRole('button',{name:'Reload saved results',exact:true}).click();await expect(frame.getByRole('alert').filter({hasText:'Current camera state cannot be verified'})).toBeVisible();await expect(report.getByLabel('Unit diagnostic report text')).toHaveValue(/Unavailable \/ unverified response/);expect(await report.getByLabel('Unit diagnostic report text').inputValue()).not.toContain('Current trusted provider result: OFFLINE');expect(state.writes).toEqual([]);
});
test('support-equipment report stays zero-camera and legacy observations remain unverified',async({page})=>{
 const {frame,child,state}=await mount(page,{selected:true,oldApi:true});await frame.getByText('Review report text',{exact:true}).click();await expect(frame.getByLabel('Unit diagnostic report text')).toHaveValue(/Unavailable \/ unverified response/);
 await child.evaluate(id=>{location.hash='camera-health?unit='+id;},ids[3]);await expect(frame.getByRole('region',{name:'Selected field unit Camera Health'})).toContainText('SUPPORT EQUIPMENT · 0 CAMERAS');await frame.getByText('Review report text',{exact:true}).click();const text=await frame.getByLabel('Unit diagnostic report text').inputValue();expect(text).toContain('SUPPORT EQUIPMENT · 0 CAMERAS');expect(text).not.toContain('Current trusted provider result');expect(state.writes).toEqual([]);
});
test('owner draft receives scoped report through existing context without creating a ticket',async({page})=>{
 const {frame,state}=await mount(page,{selected:true});await frame.getByRole('button',{name:'Create ticket',exact:true}).click();await expect(frame.getByLabel('Description / instructions')).toHaveValue(/COS UNIT DIAGNOSTIC REPORT/);const text=await frame.getByLabel('Description / instructions').inputValue();expect(text).toContain('Unit: Ranger 1');expect(text).not.toContain('Older camera');await frame.getByLabel('Description / instructions').fill('Keep my own instructions');await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();await expect(frame.getByRole('heading',{name:'Camera Health',exact:true,level:2})).toBeVisible();expect(state.writes).toEqual([]);
});
test('slow report reads preserve owner edits and canceled navigation cannot attach an old report',async({page})=>{
 const {frame,child,state}=await mount(page,{selected:true});state.hold=true;await frame.getByRole('button',{name:'Create ticket',exact:true}).click();await expect.poll(()=>Boolean(state.release)).toBe(true);await frame.getByLabel('Description / instructions').fill('User-entered repair instructions');state.hold=false;state.release();await expect(frame.getByRole('region',{name:'Selected unit context'})).toContainText('Review them before saving');await expect(frame.getByLabel('Description / instructions')).toHaveValue('User-entered repair instructions');
 await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();await expect(frame.getByRole('heading',{name:'Camera Health',exact:true,level:2})).toBeVisible();await child.evaluate(id=>{location.hash='camera-health?unit='+id;},ids[1]);await expect(frame.getByRole('region',{name:'Selected field unit Camera Health'})).toContainText('Ranger 2');state.hold=true;state.release=null;await frame.getByRole('button',{name:'Create ticket',exact:true}).click();await expect.poll(()=>Boolean(state.release)).toBe(true);await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();state.hold=false;state.release();await expect(frame.getByRole('region',{name:'Selected field unit Camera Health'})).toContainText('Ranger 2');expect(state.writes).toEqual([]);
});
