import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {repo,html} from './helpers/service-ticket-fixture.mjs';
const origin='http://127.0.0.1:4173';
const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.html':'text/html'};
async function mount(page){
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort('blockedbyclient');if(url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:html});const path=resolve(repo,'.'+decodeURIComponent(url.pathname));if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:types[extname(path)]||'application/octet-stream'});return route.abort('blockedbyclient');});
 await page.goto('/tech-checks/');await expect(page.locator('#wlSvcHome')).toBeVisible();await expect(queue(page)).toContainText('MHelpDesk #1001');
}
const queue=page=>page.locator('#cosServiceAssignmentQueue');
const notes=page=>page.locator('#cosServiceTicketInstructions');
async function find(page,ticket='1001'){await page.evaluate(()=>showServiceJobLookup());await page.locator('#wlServiceJobSearch').fill(ticket);await page.locator('[data-wl-service-find-job]').click();}

test('actual Service Home discovers mine and department tickets without work details or start actions',async({page},testInfo)=>{
 await mount(page);await page.evaluate(()=>{
  fixture.rows[1].assignee_user_id=null;fixture.rows[1].assignment_scope='department';
  fixture.rows[2].assignee_user_id='another-service';fixture.rows[3].assigned_role='it';
 });await queue(page).getByRole('button',{name:'Refresh assignments'}).click();
 await expect(queue(page)).toContainText('MHelpDesk #1001');await expect(queue(page)).toContainText('Assigned to you');await expect(queue(page)).toContainText('MHelpDesk #1002');await expect(queue(page)).toContainText('Department queue');await expect(queue(page)).not.toContainText('1003');await expect(queue(page)).not.toContainText('1004');await expect(queue(page)).toContainText('2026-10-10');await expect(queue(page)).not.toContainText('Helios');await expect(queue(page)).not.toContainText('Original');await expect(queue(page).locator('button')).toHaveCount(1);await expect(queue(page).locator('a,input,select')).toHaveCount(0);
 await expect(page.locator('#wlSvcHome [data-wl-service-open-job]')).toBeVisible();expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
 const bounds=await queue(page).boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width);await page.screenshot({path:testInfo.outputPath('service-ticket-queue.png'),fullPage:true});
 await page.locator('#wlSvcHome [data-wl-service-open-job]').click();await expect(queue(page)).toHaveCount(0);await expect(page.locator('#wlServiceJobSearch')).toHaveValue('');await expect(notes(page)).toHaveCount(0);
});

for(const [index,route] of ['service','delivery','swap','pickup'].entries())test('actual '+route+' pre-start lookup preserves literal original instructions and unit type',async({page},testInfo)=>{
 await mount(page);await find(page,String(1001+index));await expect(notes(page)).toContainText('Original '+route+' work.');await expect(notes(page)).toContainText('Recorded equipment / unit instructions');await expect(notes(page)).toContainText('Helios unit type');await expect(notes(page)).toContainText('<img src=x onerror=window.fixtureInjected=true>');
 for(const [label,field] of [['Work','job_description'],['Notes / delivery instructions','notes'],['Recorded equipment / unit instructions','unit_summary']])expect(await notes(page).locator('h4').filter({hasText:label}).evaluate(node=>node.nextElementSibling.textContent)).toBe(await page.evaluate(({index,field})=>fixture.rows[index][field],{index,field}));
 expect(await notes(page).locator('img,script').count()).toBe(0);expect(await page.evaluate(()=>window.fixtureInjected)).toBeUndefined();expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
 if(['delivery','swap'].includes(route)){await expect(page.locator('#wlServiceJobSearchMsg')).toContainText('WAITING FOR IT HANDOFF');await expect(page.locator('#wlServiceJobSearchMsg')).toContainText('YOU CANNOT START YET.');await expect(page.locator('[data-wl-service-take-job]')).toHaveCount(0);}else await expect(page.locator('[data-wl-service-take-job]')).toBeVisible();
 await expect(notes(page)).not.toContainText('No equipment');const bounds=await notes(page).boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width);await page.screenshot({path:testInfo.outputPath('service-'+route+'-original-instructions.png'),fullPage:true});
});

test('department instructions remain available before claim; another assignee cannot supply them',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.rows[0].assignee_user_id=null;fixture.rows[0].assignment_scope='department';});await find(page);await expect(notes(page)).toContainText('Original service work.');await expect(page.locator('#wlServiceJobSearchMsg')).toContainText('AVAILABLE TO THE SERVICE TEAM');expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
 await page.evaluate(()=>{fixture.rows[0].assignee_user_id='someone-else';});await notes(page).getByRole('button',{name:'Refresh instructions'}).click();await expect(notes(page)).toContainText('No active Service assignment');await expect(notes(page)).not.toContainText('Original service work.');
 await find(page);await expect(page.locator('#wlServiceJobSearchMsg')).toContainText('NO SERVICE JOB FOUND');await expect(notes(page)).toHaveCount(0);
});

test('Service instructions require unique exact markers and never follow the ticket into later screens',async({page})=>{
 await mount(page);await find(page);await expect(notes(page)).toContainText('Original service work.');
 for(const selector of ['.wl-service-ticket-number','.wl-service-ticket-site']){
  await page.evaluate(selector=>{const marker=document.querySelector('#wlServiceJobSearchMsg '+selector);marker.after(marker.cloneNode(true));},selector);await expect(notes(page)).toHaveCount(0);await find(page);await expect(notes(page)).toContainText('Original service work.');
 }
 await page.locator('#wlServiceJobSearch').fill('1002');await expect(notes(page)).toHaveCount(0);await find(page);await expect(notes(page)).toContainText('Original service work.');
 await page.evaluate(()=>showReceiveLookup());await expect(page.locator('#wlTicketInput')).toBeVisible();await expect(notes(page)).toHaveCount(0);expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
});

test('loading, failure and empty queue states remain distinct; redraw rereads the actual Service Home',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.queueMode='pending';});await queue(page).getByRole('button',{name:'Refresh assignments'}).click();await expect(queue(page)).toContainText('Loading Service assignments');await expect(queue(page)).not.toContainText('MHelpDesk #1001');await page.evaluate(()=>{fixture.pending.splice(0).forEach(done=>done());fixture.queueMode='failure';});await expect(queue(page)).toContainText('MHelpDesk #1001');await queue(page).getByRole('button',{name:'Refresh assignments'}).click();await expect(queue(page)).toContainText('could not be verified');await expect(queue(page)).not.toContainText('No active assignments');
 await page.evaluate(()=>{fixture.queueMode='success';fixture.rows=[];});await queue(page).getByRole('button',{name:'Refresh assignments'}).click();await expect(queue(page)).toContainText('No active assignments are available');await page.evaluate(()=>showSvcHome());await expect(queue(page)).toContainText('No active assignments are available');await expect(queue(page)).toHaveCount(1);await expect(page.locator('#wlSvcHome [data-wl-service-open-job]')).toBeVisible();expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
});

test('Close, Back and browser history discard late Service responses and recheck on returning',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.mode='pending';});await find(page);await expect(notes(page)).toContainText('Loading saved');await notes(page).getByRole('button',{name:'Close instructions'}).click();await page.evaluate(()=>{fixture.pending.splice(0).forEach(done=>done());fixture.mode='success';});await expect(notes(page)).not.toContainText('Original service');await notes(page).getByRole('button',{name:'Show ticket instructions'}).click();await expect(notes(page)).toContainText('Original service');
 await page.evaluate(()=>{fixture.mode='pending';});await notes(page).getByRole('button',{name:'Refresh instructions'}).click();await expect(notes(page)).toContainText('Loading saved');await page.locator('#wlSvcLookup [data-wl-home]').click();await expect(notes(page)).toHaveCount(0);await expect(queue(page)).toBeVisible();await page.evaluate(()=>{fixture.pending.splice(0).forEach(done=>done());fixture.mode='success';});await expect(notes(page)).toHaveCount(0);
 await find(page,'1002');await expect(notes(page)).toContainText('Original delivery');await page.evaluate(()=>{history.pushState({},'','#other-view');document.getElementById('view-svc').classList.add('hidden');dispatchEvent(new PopStateEvent('popstate'));});await expect(notes(page)).toHaveCount(0);await page.goBack();await page.evaluate(()=>{document.getElementById('view-svc').classList.remove('hidden');dispatchEvent(new PopStateEvent('popstate'));});await expect(notes(page)).toContainText('Original delivery');expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
});

test('logout, login change, Owner preview and page restoration cannot retain old Service data',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.queueMode='pending';});await queue(page).getByRole('button',{name:'Refresh assignments'}).click();await expect(queue(page)).toContainText('Loading Service');await page.evaluate(()=>setFixtureIdentity(null));await expect(queue(page)).toHaveCount(0);await page.evaluate(()=>{fixture.pending.splice(0).forEach(done=>done());fixture.queueMode='success';setFixtureIdentity('second-service');});await expect(queue(page)).toContainText('No active assignments are available');
 await page.evaluate(()=>{fixture.rows[0].assignee_user_id='second-service';});await find(page);await expect(notes(page)).toContainText('Original service');await page.evaluate(()=>{fixture.role='owner';fixture.effective='service';document.body.classList.add('owner-test-role-preview');dispatchEvent(new CustomEvent('techcheck:view-changed'));});await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>{document.body.classList.remove('owner-test-role-preview');setFixtureIdentity('second-service');});await expect(notes(page)).toContainText('Original service');
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>{fixture.rows[1].assignee_user_id='second-service';return findFixtureTicket('1002');});await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await expect(notes(page)).toContainText('Original delivery');await expect(notes(page)).not.toContainText('Original service');expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
});

test('Service queue fails closed on malformed, foreign and duplicate rows but preserves genuine empty results',async({page})=>{
 await mount(page);
 for(const kind of ['malformed','foreign','mixed','duplicate','invalid-scope']){
  await page.evaluate(kind=>{const own=structuredClone(fixture.rows[0]),foreign={...own,id:'foreign',ticket_no:'PRIVATE-WRONG-ROW',assignee_user_id:'other'};fixture.queueRows=kind==='invalid-scope'?[{...own,assignment_scope:'person'}]:kind==='malformed'?[null]:kind==='foreign'?[foreign]:kind==='mixed'?[own,foreign]:[own,{...own,ticket_no:'DUPLICATE-PRIVATE'}];},kind);
  await queue(page).getByRole('button',{name:'Refresh assignments'}).click();await expect(queue(page)).toContainText('could not be verified');await expect(queue(page)).not.toContainText('No active assignments');await expect(queue(page)).not.toContainText('MHelpDesk #');await expect(queue(page)).not.toContainText('PRIVATE');
 }
 await page.evaluate(()=>{fixture.queueRows=[];});await queue(page).getByRole('button',{name:'Refresh assignments'}).click();await expect(queue(page)).toContainText('No active assignments are available');await expect(queue(page)).not.toContainText('could not be verified');expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
});

test('actual Service lookup and queue support 81–128 character tickets and reject overlength identities',async({page})=>{
 await mount(page);
 for(const length of [81,128,129]){
  const ticket='T'.repeat(length);await page.evaluate(async ticket=>{fixture.rows[0].ticket_no=ticket;await showSvcHome();},ticket);
  if(length<=128)await expect(queue(page)).toContainText('MHelpDesk #'+ticket);else {await expect(queue(page)).toContainText('could not be verified');await expect(queue(page)).not.toContainText('No active assignments');}
  await find(page,ticket);await expect(page.locator('.wl-service-ticket-number')).toHaveText('#'+ticket);
  if(length<=128){await expect(notes(page)).toContainText('Original service');await expect(notes(page)).toContainText('MHelpDesk #'+ticket);}else await expect(notes(page)).toHaveCount(0);
 }
 expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
});
