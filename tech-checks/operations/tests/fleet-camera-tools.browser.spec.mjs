import {test,expect} from '@playwright/test';
import {mountFleet,fresh} from './fleet-dashboard-fixtures.mjs';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';
const health=snapshot([resource(12,'Helios 1',{connection:{publicIp:'8.8.8.8',ports:[80,443,8443]}})]);
for(const it of [false,true])test(`inline camera checks keep ${it?'IT':'Owner'} in the unit card`,async({page},info)=>{
 const {app,state}=await mountFleet(page,it,{health});const probes=[];let fail=false;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const call=route.request().postDataJSON();
  if(!call.path?.endsWith('/check'))return route.fallback();probes.push(call);
  return route.fulfill({status:fail?503:200,headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:fail?{error:'The connection check could not be completed. No new result is confirmed.'}:{deviceId:12,unitKey:'Helios 1',publicIp:'8.8.8.8',mode:call.body.mode,checkedAt:fresh,ports:[{port:80,reachable:true,latencyMs:12},{port:443,reachable:false,latencyMs:null}]}});
 });
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();const card=app.getByRole('dialog',{name:'Helios 1 unit intelligence'}),tools=card.getByRole('region',{name:'Camera connection tools'});
 await expect(tools.getByRole('button',{name:'Ping',exact:true})).toBeVisible();expect(probes).toHaveLength(0);
 await expect(tools).toContainText('8.8.8.8');await expect(tools).toContainText('80 · 443 · 8443');
 await tools.getByRole('button',{name:'Ping',exact:true}).click();await expect(tools.getByRole('status')).toContainText('Connection responded');
 expect(probes).toHaveLength(1);expect(probes[0]).toMatchObject({method:'POST',path:'/api/camera-health/devices/12/check',body:{unitKey:'Helios 1',publicIp:'8.8.8.8',ports:[80,443,8443],mode:'quick'}});
 await expect(card).toBeVisible();expect(page.context().pages()).toHaveLength(1);
 await tools.getByRole('button',{name:'Scan ports',exact:true}).click();await expect(tools.getByRole('status')).toContainText('443 · No response');expect(probes[1].body.mode).toBe('ports');
 await page.screenshot({path:info.outputPath('inline-camera-results.png')});fail=true;await tools.getByRole('button',{name:'Ping',exact:true}).click();await expect(tools.getByRole('alert')).toContainText('No new result is confirmed');await expect(tools.getByText('Connection responded',{exact:true})).toHaveCount(0);
 expect(state.errors).toEqual([]);
});
for(const it of [false,true])test(`every Fleet tab has the compact COS theme for ${it?'IT':'Owner'}`,async({page})=>{
 const {app}=await mountFleet(page,it);for(const [label,view] of [['Fleet health','fleet'],['Location verification','verify'],['Needs setup','setup'],['Data sources','sources'],['Map','map']]){
  if(it&&view==='setup'){await expect(app.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:label,exact:false})).toHaveCount(0);continue;}
  await app.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:label,exact:false}).click();
  const board=app.locator('.cos-fleet-board');await expect(board).toHaveAttribute('data-fleet-view',view);await expect(board.locator('.cos-fleet-clock')).toBeHidden();
  expect(await board.evaluate(n=>n.scrollWidth<=n.clientWidth+2)).toBe(true);
  if(view!=='map'){await expect(board.locator('.cos-fleet-tab-summary')).not.toHaveAttribute('open','');await board.locator('.cos-fleet-tab-summary>summary').click();await expect(board.locator('.cos-fleet-stat-field')).toBeVisible();}
 }
});
test('a failed health refresh keeps equipment and shows unavailable health totals',async({page})=>{
 const {app,state}=await mountFleet(page);state.fail=true;await app.getByRole('button',{name:'Refresh data'}).click();
 await expect(app.getByRole('alert').filter({hasText:'Health refresh unavailable'})).toBeVisible();await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('—');await expect(app.locator('.cos-fleet-stat-offline strong')).toHaveText('—');await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('3');
});
test('pending checks disable repeat taps and closing the card discards a late result',async({page})=>{
 const {app}=await mountFleet(page,false,{health});let release,received;const gate=new Promise(r=>release=r),started=new Promise(r=>received=r);let checks=0;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const call=route.request().postDataJSON();if(!call.path?.endsWith('/check'))return route.fallback();checks++;received();await gate;await route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{deviceId:12,unitKey:'Helios 1',publicIp:'8.8.8.8',mode:'quick',checkedAt:fresh,ports:[{port:80,reachable:true,latencyMs:1}]}}).catch(()=>{});
 });
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();const card=app.getByRole('dialog',{name:'Helios 1 unit intelligence'}),tools=card.getByRole('region',{name:'Camera connection tools'});await tools.getByRole('button',{name:'Ping',exact:true}).click();await started;
 await expect(tools.getByRole('button',{name:'Ping',exact:true})).toBeDisabled();await expect(tools.getByRole('button',{name:'Scan ports',exact:true})).toBeDisabled();expect(checks).toBe(1);
 await page.keyboard.press('Escape');release();await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();await expect(app.getByText('Connection responded',{exact:true})).toHaveCount(0);await expect(app.getByRole('button',{name:'Ping',exact:true})).toBeEnabled();
});
