import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {itHomeFixture} from './it-home-fixture.mjs';
const origin=process.env.COS_TRACKER_TEST_ORIGIN||'http://127.0.0.1:4173',dist=resolve(process.env.COS_TRACKER_TEST_DIST||fileURLToPath(new URL('../dist',import.meta.url)));
const host=readFileSync(new URL('../../verified-it-fleet-host.js',import.meta.url),'utf8'),workbook='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
async function mount(page,{role='it',linked=true,feature=true,held=false,...options}={}){
 const state={calls:[],errors:[]};let release;const hold=new Promise(r=>release=r);state.release=release;page.on('pageerror',e=>state.errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin&&url.pathname==='/tracker-home')return route.fulfill({contentType:'text/html',body:itHomeFixture(role,linked,options)});
  if(url.href===origin+'/fleet-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:host+'\nwindow.fixtureHostLoaded=true;'});
  if(url.href===origin+'/field-map-display-host.js')return route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
  if(url.origin===origin&&url.pathname.startsWith('/resources/fonts/'))return route.fulfill({path:new URL('../../resources/fonts/'+url.pathname.split('/').pop(),import.meta.url).pathname});
  if(url.origin===origin&&url.pathname==='/techcheck-eye-favicon-32.png')return route.fulfill({path:new URL('../../techcheck-eye-favicon-32.png',import.meta.url).pathname});
  if(url.origin===origin){const pathname=url.pathname.replace(/^\/operations\/dist/,'')||'/',path=resolve(dist,pathname==='/'?'index.html':'.'+decodeURIComponent(pathname));if(path.startsWith(dist+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff','.png':'image/png'}[extname(path)]||'application/octet-stream'});return route.abort();}
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort();
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.calls.push(request);if(held&&request.path==='/api/session')await hold;
  const data=request.path==='/api/session'?{authorized:true,legacyOwner:false,role:'IT',name:'Synthetic IT',features:{fleetAccess:true,unitTracker:feature,importedUnitAddressEdit:false}}:request.path==='/api/unit-tracker'?{contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:workbook,connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,availability:'unavailable',sources:[],requests:[],sourcesHeld:0,sourcesTruncated:false,requestsTruncated:false}:request.path==='/api/field-map'?{items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:'2026-10-09T04:00:00Z'}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/tracker-home');await expect.poll(()=>page.evaluate(()=>window.fixtureHostLoaded)).toBe(true);return state;
}
for(const secondVerified of [false,true])test('verified IT '+(secondVerified?'second':'first')+' Home has one tracker entry with exact close focus and safe default-off workspace',async({page},info)=>{
 const state=await mount(page,{secondVerified}),entry=page.locator('#wlItHome [data-cos-unit-tracker]');await expect(entry).toBeVisible();await expect(page.locator('[data-cos-field-view]')).toBeVisible();
 for(let n=0;n<2;n++){await page.evaluate(()=>window.renderITHome());await expect(entry).toBeVisible();await expect(page.locator('[data-cos-unit-tracker]')).toHaveCount(1);await entry.evaluate(button=>{button.click();button.click();});await expect(page.locator('dialog')).toHaveCount(1);const frame=page.frameLocator('iframe');await expect(frame.getByRole('region',{name:'Unit Tracker workspace'})).toBeVisible();await expect(frame.getByRole('button',{name:'+ Add unit request'})).toBeDisabled();await expect(frame).not.toBeNull();if(n===0)await page.screenshot({path:info.outputPath('verified-it-unit-tracker.png')});await page.keyboard.press('Escape');await expect(page.locator('iframe,dialog')).toHaveCount(0);await expect(entry).toBeFocused();}
 expect(state.calls.every(call=>call.method==='GET'&&['/api/session','/api/field-map','/api/unit-tracker'].includes(call.path))).toBe(true);expect(state.errors).toEqual([]);
});
for(const options of [{role:'service'},{linked:false},{active:false},{archived:true},{effectiveRole:'owner'}])test('restricted account '+JSON.stringify(options)+' receives no tracker entry or new session request',async({page})=>{const state=await mount(page,options);await expect(page.locator('[data-cos-unit-tracker]')).toHaveCount(0);expect(state.calls).toEqual([]);expect(await page.evaluate(()=>window.fixtureTokens)).toBe(0);});
test('older backend keeps Field View but hides unsupported tracker entry',async({page})=>{const state=await mount(page,{feature:false});await expect(page.locator('[data-cos-field-view]')).toBeVisible();await expect.poll(()=>state.calls.length).toBe(1);await expect(page.locator('[data-cos-unit-tracker]')).toHaveCount(0);});
test('late capability response after role change cannot restore tracker button or frame',async({page})=>{const state=await mount(page,{held:true});await expect.poll(()=>state.calls.length).toBe(1);await page.evaluate(()=>{window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');});state.release();await expect(page.locator('[data-cos-unit-tracker],[data-cos-field-view],dialog,iframe')).toHaveCount(0);});
test('role loss closes an open tracker and removes both Home entries',async({page})=>{await mount(page);await page.locator('[data-cos-unit-tracker]').click();await expect(page.frameLocator('iframe').getByRole('region',{name:'Unit Tracker workspace'})).toBeVisible();await page.evaluate(()=>{window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');});await expect(page.locator('[data-cos-unit-tracker],[data-cos-field-view],dialog,iframe')).toHaveCount(0);});
