import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {completedBoard} from '../durable-board/project.ts';
test('reopening restores server counts, retains failures, replaces one completed batch and exposes unit history',async({page})=>{
 const f=fieldProductFixture(),features={durableFleetBoard:false};
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,features,skipInitialFieldCount:true,advancingClock:true});
 const first=completedBoard(f.health,f.field,f.connections,null,f.now);
 let value={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:'completed-1',payload:first},refresh:{state:'completed'},history:[{id:'00000000-0000-4000-8000-000000000001',state:'completed',finished_at:first.fleet.readAt,counts:first.counts}]};
 const calls=[];
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const req=route.request().postDataJSON();
  if(!req.path.startsWith('/api/fleet-saved-board'))return route.fallback();calls.push(req);
  const data=req.path.includes('/history/')?{completedAt:first.fleet.readAt,units:first.units}:value;
  return route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:data});
 });
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 // Reproduce the real large-fleet phone case: compact counts survive locally
 // while the full presentation is absent. The server board must restore the
 // complete Fleet instead of blanking the cards to dashes.
 await app.locator('body').evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('cos-saved-fleet-presentation-v1:'))localStorage.removeItem(key);});
 features.durableFleetBoard=true;
 const before=state.calls.length;await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 const online=board.locator('.cos-equipment-total-helios .cos-total-status-online b');
 const offline=board.locator('.cos-equipment-total-helios .cos-total-status-offline b');
 await expect(online).toHaveText('1');await expect(board.getByRole('region',{name:'Saved fleet updates'})).toContainText('Closing the app keeps this record');
 expect(calls.some(c=>c.path==='/api/fleet-saved-board'&&c.method==='GET')).toBe(true);
 expect(calls.some(c=>c.method==='POST')).toBe(false);
 await page.clock.fastForward(9*60000);await expect(online).toHaveText('1');expect(calls.some(c=>c.method==='POST')).toBe(false);
 await page.clock.fastForward(2*60000);await expect(online).toHaveText('1');await expect.poll(()=>calls.some(c=>c.path==='/api/fleet-saved-board/refresh'&&c.method==='POST')).toBe(true);
 expect(state.calls.slice(before).filter(c=>['/api/field-map','/api/camera-health/summary-v3','/api/product-connections'].includes(c.path))).toHaveLength(0);
 value={...value,refresh:{state:'failed',error:'source_read_failed'}};
 await board.getByRole('button',{name:/Refresh data/}).click();await expect(board.getByRole('region',{name:'Saved fleet updates'})).toContainText('Update incomplete');await expect(online).toHaveText('1');
 // The replacement is a later real observation, not a future-dated board.
 await page.clock.fastForward(14*60000);
 const completedAt=await app.locator('body').evaluate(()=>Date.now());
 const stamp=new Date(completedAt).toISOString();const map=structuredClone(f.field),receipt=structuredClone(f.connections);map.uploadInventory.receivedAt=stamp;map.generatedAt=stamp;receipt.trackerVerifiedAt=stamp;
 for(const p of receipt.items)if(p.checkedAt)p.checkedAt=stamp;
 receipt.items.find(p=>p.productId==='1001').status='offline';
 const next=completedBoard(f.health,map,receipt,first,completedAt);value={...value,latest:{id:'completed-2',payload:next},refresh:{state:'completed'}};
 await expect(board.getByRole('button',{name:/Refresh data/})).toBeEnabled();await board.getByRole('button',{name:/Refresh data/}).click();await expect(offline).toHaveText('1');await expect(online).toHaveText('0');
 await page.reload();await expect(offline).toHaveText('1');await expect(online).toHaveText('0');
 await board.getByRole('region',{name:'Saved fleet updates'}).locator(':scope > summary').click();
 await board.getByText('Update history',{exact:true}).click();await board.getByRole('button',{name:'View units',exact:true}).click();await expect(board.getByRole('region',{name:'Saved unit statuses'})).toContainText('Helios 1');
 await app.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));await expect(board.getByRole('region',{name:'Saved fleet updates'})).toHaveCount(0);
 expect(calls.some(c=>c.method==='POST')).toBe(true);expect(state.errors).toEqual([]);
});
test('a completed board that can no longer be refreshed stays readable and is labelled with its own time',async({page})=>{
 const f=fieldProductFixture(),features={durableFleetBoard:false};
 const {app}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,features,skipInitialFieldCount:true,advancingClock:true});
 const first=completedBoard(f.health,f.field,f.connections,null,f.now);
 let value={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:'completed-1',payload:first},refresh:{state:'completed'},history:[{id:'00000000-0000-4000-8000-000000000001',state:'completed',finished_at:first.fleet.readAt,counts:first.counts}]};
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const req=route.request().postDataJSON();
  if(!req.path.startsWith('/api/fleet-saved-board'))return route.fallback();
  return route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:req.path.includes('/history/')?{completedAt:first.fleet.readAt,units:first.units}:value});
 });
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 features.durableFleetBoard=true;await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 const stat=name=>board.locator('.cos-fleet-stat-'+name+' strong').first();
 await expect(stat('online')).toHaveText('1');
 const shown={};for(const name of ['field','shop','total','online','offline','unknown'])shown[name]=await stat(name).textContent();
 // Every later update fails. Forty-five minutes pass with the app open, then it is reopened.
 value={...value,refresh:{state:'failed',error:'source_read_failed'}};
 await page.clock.fastForward(45*60000);
 for(const pass of ['open','reopened']){
  if(pass==='reopened')await page.reload();
  for(const name of Object.keys(shown))await expect(stat(name),pass+' '+name).toHaveText(shown[name]);
  await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b'),pass).toHaveText('1');
  const notice=board.getByRole('status',{name:'Last completed reading'});
  await expect(notice,pass).toContainText('not current');await expect(notice,pass).toContainText(/\d{1,2}:\d{2}/);
  await expect(board.locator('.cos-fleet-stat-online small'),pass).toContainText('not current');
 }
});
test('when no board can be read at all, the reading this browser saved is shown under its own time',async({page})=>{
 const f=fieldProductFixture(),features={durableFleetBoard:true};
 const {app}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,features,skipInitialFieldCount:true,advancingClock:true,productionOwnerUserId:'00000000-0000-4000-8000-000000000009'});
 const first=completedBoard(f.health,f.field,f.connections,null,f.now);
 const value={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:'completed-1',payload:first},refresh:{state:'completed'},history:[]};
 let down=false;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const req=route.request().postDataJSON();
  if(!req.path.startsWith('/api/fleet-saved-board'))return route.fallback();
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173'};
  return down?route.fulfill({status:503,headers,json:{error:'Saved fleet board unavailable'}}):route.fulfill({headers,json:req.path.includes('/history/')?{completedAt:first.fleet.readAt,units:first.units}:value});
 });
 await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 const stat=name=>board.locator('.cos-fleet-stat-'+name+' strong').first();
 await expect(stat('online')).toHaveText('1');
 const shown={};for(const name of ['online','offline','unknown'])shown[name]=await stat(name).textContent();
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cos-saved-fleet-reading-v1:')))).toBe(true);
 // The large saved presentation is absent (as on a phone) and the server board cannot be read.
 down=true;await page.clock.fastForward(45*60000);
 await app.locator('body').evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('cos-saved-fleet-presentation-v1:'))localStorage.removeItem(key);});
 await page.reload();
 await expect(board.locator('.cos-fleet-stat-online small')).toContainText(/Saved reading .*\d{1,2}:\d{2}.* · not current/);
 for(const name of Object.keys(shown))await expect(stat(name),name).toHaveText(shown[name]);
 for(const name of ['field','shop','total'])await expect(stat(name),name).toHaveText(/^\d+$/);
});
for(const outcome of ['succeeds','fails'])test('reopening with only the compact saved reading shows it at once while the saved-board request is unresolved, then the request '+outcome,async({page})=>{
 const f=fieldProductFixture(),features={durableFleetBoard:true};
 const {app}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,features,skipInitialFieldCount:true,advancingClock:true,productionOwnerUserId:'00000000-0000-4000-8000-00000000000a'});
 const first=completedBoard(f.health,f.field,f.connections,null,f.now);
 const value={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:'completed-1',payload:first},refresh:{state:'completed'},history:[]};
 let hold=null,release,pending=0;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();const req=route.request().postDataJSON();
  if(!req.path.startsWith('/api/fleet-saved-board'))return route.fallback();
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173'};
  if(hold){pending++;const result=await hold;if(result==='fails')return route.fulfill({status:503,headers,json:{error:'Saved fleet board unavailable'}});}
  return route.fulfill({headers,json:req.path.includes('/history/')?{completedAt:first.fleet.readAt,units:first.units}:value});
 });
 await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 const stat=name=>board.locator('.cos-fleet-stat-'+name+' strong').first();
 await expect(stat('online')).toHaveText('1');
 const shown={};for(const name of ['online','offline','unknown'])shown[name]=await stat(name).textContent();
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cos-saved-fleet-reading-v1:')))).toBe(true);
 // Reopen later with only the compact reading; the saved-board request does not answer yet.
 hold=new Promise(resolve=>{release=resolve;});
 await page.clock.fastForward(45*60000);
 await app.locator('body').evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('cos-saved-fleet-presentation-v1:'))localStorage.removeItem(key);});
 await page.reload();
 await expect.poll(()=>pending).toBeGreaterThan(0);
 const saved=async()=>{
  for(const name of Object.keys(shown))await expect(stat(name),name).toHaveText(shown[name]);
  for(const name of ['field','shop','total'])await expect(stat(name),name).toHaveText(/^\d+$/);
  for(const name of ['field','shop','total','online','offline','unknown'])await expect(board.locator('.cos-fleet-stat-'+name+' small'),name).toContainText(/Saved reading .*\d{1,2}:\d{2}.* at that time · not current/);
  await expect(board.locator('.cos-fleet-stat-field small')).not.toContainText('Current reconciled placement');
  await expect(board.locator('.cos-fleet-heading')).toContainText(/Saved reading .*\d{1,2}:\d{2}.* · not current/);
  await expect(board.locator('.cos-fleet-heading')).not.toContainText('No successful saved health read');
 };
 await saved();await expect(board.locator('.cos-fleet-heading')).toContainText('loading saved health');
 release(outcome);
 if(outcome==='fails'){await expect(board.locator('.cos-fleet-heading')).not.toContainText('loading saved health');await saved();}
 else{
  // The server's completed board replaces the compact reading and is labelled with its own time.
  await expect(board.locator('.cos-fleet-stat-online small')).toContainText(/Last completed reading .*\d{1,2}:\d{2}.* · not current/);
  await expect(stat('online')).toHaveText(shown.online);await expect(board.locator('.cos-fleet-heading')).not.toContainText('No successful saved health read');
 }
});
