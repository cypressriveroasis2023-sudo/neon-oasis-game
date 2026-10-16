import { test, expect } from '@playwright/test';
import { mountServiceBasics } from './helpers/service-basics-fixture.mjs';

const units = {'Sniper':'SN-0001A','Ranger':'RA-002B','Spotter':'SP-003C','Solar Spotter':'SS-004D'};
const photo={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
async function photos(page){for(const input of await page.locator('[data-daily-photo]').all()){if((await input.getAttribute('data-daily-photo')).endsWith(':2'))continue;await input.setInputFiles(photo);await expect(input.locator('..').locator('img')).toBeVisible();}}
const sims = ['00123456789012345670','00123456789012345671','00123456789012345672'];
async function truck(page) {
  await page.locator('#wlSvcHome [data-wl-svc="inspect"]').click();
  for (let n=0;n<8;n++) await page.locator('#wlInspection [data-wl-answer="pass"]').click();
  await expect(page.locator('#wlInspection')).toContainText('ARE YOU TAKING A TRAILER TODAY?');
}
async function inventory(page) {
  await truck(page);
  await page.locator('[data-wl-trailer="no"]').click();
  await page.locator('[data-wl-submit-inspection]').click();
  await expect(page.getByRole('textbox',{name:'Sniper unit number',exact:true})).toBeVisible();
}
async function fillInventory(page) {
  for (const [type,value] of Object.entries(units)) await page.getByRole('textbox',{name:type+' unit number',exact:true}).fill(value);
  for (let n=0;n<3;n++) await page.getByRole('textbox',{name:'SIM card '+(n+1)+' number',exact:true}).fill(sims[n]);
  for (const [id,value] of Object.entries({wlTruckReconQty:25,wlTruckAgmQty:4,wlTruckLiTimeQty:2,wlTruck35AhQty:4})) await page.locator('#'+id).fill(String(value));
}

test.beforeEach(async({page})=>mountServiceBasics(page));

test('Service gets only the basic daily tools across refresh and redraw',async({page},testInfo)=>{
  const home=page.locator('#wlSvcHome');
  await expect(home.locator('button:visible')).toHaveCount(2);
  await expect(home.getByRole('button',{name:/Truck Inspection/})).toBeVisible();
  await expect(home.getByRole('button',{name:/Truck Inventory/})).toBeVisible();
  await expect(home).toContainText('Trailer inspection if you are taking a trailer');
  await expect(page.locator('#techMenuButton')).toBeHidden();
  await expect(page.locator('#tab-owner')).toBeHidden();
  await expect(page.locator('#tab-it')).toBeHidden();
  for(let n=0;n<3;n++) await page.evaluate(async()=>{document.getElementById('wlSvcHome').remove();await renderServiceHome();});
  await expect(home.locator('button:visible')).toHaveCount(2);
  await expect(home.locator('[data-cos-service-basics-copy]')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('service-basics-home.png'),fullPage:true});
});

test('NO trailer skips the seven trailer checks and continues directly to inventory',async({page})=>{
  await inventory(page);
  const calls=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='submit_morning_check'));
  expect(calls).toHaveLength(1);
  expect(Object.values(calls[0].args.p_truck_checks)).toEqual(Array(8).fill(true));
  expect(calls[0].args.p_taking_trailer).toBe(false);
  expect(Object.values(calls[0].args.p_trailer_checks)).toEqual(Array(7).fill(null));
});

test('YES trailer requires all seven checks; NO on a safety item cannot advance',async({page})=>{
  await truck(page);
  await page.locator('[data-wl-trailer="yes"]').click();
  await page.locator('[data-wl-answer="fail"]').click();
  await expect(page.locator('#wlInspection')).toContainText('STOP — FIX THIS BEFORE CONTINUING.');
  await expect(page.locator('#wlInspection')).toContainText('TRAILER CHECK · 1 OF 7');
  await expect(page.locator('[data-wl-submit-inspection]')).toHaveCount(0);
  for(let n=0;n<7;n++) await page.locator('[data-wl-answer="pass"]').click();
  await page.locator('[data-wl-submit-inspection]').click();
  await expect(page.getByRole('textbox',{name:'Sniper unit number',exact:true})).toBeVisible();
  const call=await page.evaluate(()=>fixture.calls.find(c=>c.name==='submit_morning_check'));
  expect(call.args.p_taking_trailer).toBe(true);
  expect(Object.values(call.args.p_trailer_checks)).toEqual(Array(7).fill(true));
});

test('inventory stays gated before inspection and missing unit or SIM is not ready',async({page})=>{
  await page.locator('[data-wl-service-truck-inventory]').click();
  await expect(page.locator('#wlSvcTruckInventory')).toContainText('INSPECTION REQUIRED FIRST');
  await expect(page.locator('[data-wl-truck-unit-entry]')).toHaveCount(0);
  await page.locator('#wlSvcTruckInventory [data-wl-home="svc"]').click();
  await inventory(page);await fillInventory(page);
  await page.getByRole('textbox',{name:'Sniper unit number',exact:true}).fill('');
  await page.getByRole('textbox',{name:'SIM card 3 number',exact:true}).fill('');
  await page.locator('[data-wl-save-truck-inventory]').click();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('[data-wl-truck-save-status]').textContent)).toContain('Enter all four');
  expect(await page.evaluate(()=>fixture.readiness.inventory_ready)).toBe(false);
});

test('one completion saves exact numbers, photos and returns home without another button',async({page},testInfo)=>{
  await inventory(page);await fillInventory(page);await photos(page);
  await expect(page.locator('[data-wl-submit-truck-inventory]')).toBeHidden();
  await page.screenshot({path:testInfo.outputPath('daily-inventory-photos.png'),fullPage:true});
  await page.getByRole('button',{name:'Complete & Send to Ops Manager',exact:true}).click();
  await expect(page.locator('#wlSvcHome [data-wl-service-truck-inventory]')).toContainText('Completed Today');
  await expect(page.locator('[data-daily-delivery-status]')).toContainText('delivery is pending');
  const saved=await page.evaluate(()=>fixture.calls.find(c=>c.name==='complete_service_daily_report_v1').args);
  expect(saved.p_units).toEqual(units);expect(Object.values(saved.p_sims)).toEqual(sims);expect(saved.p_photos).toHaveLength(10);
  expect(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='complete_service_daily_report_v1'))).toHaveLength(1);
});

test('short battery quantities keep the truck unready',async({page})=>{
  await inventory(page);await fillInventory(page);
  await page.locator('#wlTruck35AhQty').fill('3');
  await page.locator('[data-wl-save-truck-inventory]').click();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('[data-wl-truck-save-status]').textContent)).toContain('stock is short');
  expect(await page.evaluate(()=>fixture.readiness.inventory_ready)).toBe(false);
});

test('offline or rejected inspection preserves the draft without starting inventory',async({page})=>{
  await truck(page);await page.locator('[data-wl-trailer="no"]').click();
  await page.evaluate(()=>fixture.online=false);
  await page.locator('[data-wl-submit-inspection]').click();
  expect(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='submit_morning_check'))).toHaveLength(0);
  expect(await page.evaluate(()=>fixture.draft.truck)).toEqual(Array(8).fill(true));
  await page.evaluate(()=>{fixture.online=true;fixture.failMorning=true;});
  await page.locator('[data-wl-submit-inspection]').click();
  await expect.poll(()=>page.evaluate(()=>fixture.alerts.at(-1))).toBe('Synthetic inspection save failed');
  await expect(page.locator('#wlInspection')).toBeVisible();
  expect(await page.evaluate(()=>fixture.readiness.inspection_ready)).toBe(false);
});

test('failed inventory save preserves numbers and never claims ready',async({page})=>{
  await inventory(page);await fillInventory(page);await photos(page);
  await page.evaluate(()=>fixture.failSave=true);
  await page.locator('[data-wl-save-truck-inventory]').click();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('[data-wl-truck-save-status]').textContent)).toBe('Synthetic inventory save failed');
  await expect(page.getByRole('textbox',{name:'SIM card 1 number',exact:true})).toHaveValue(sims[0]);
  expect(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='submit_my_service_truck_inventory_check_v3'))).toHaveLength(0);
});

test('Owner and IT retain their existing tools and leaving Service restores attributes',async({page})=>{
  await inventory(page);
  const input=page.locator('[data-wl-truck-unit-entry="Sniper"]');
  await expect(input).toHaveAttribute('required','');
  await page.evaluate(()=>setIdentity('owner'));
  await expect(page.locator('body')).not.toHaveClass(/cos-service-basics/);
  await expect(input).not.toHaveAttribute('required','');
  await page.evaluate(()=>renderServiceHome());
  await expect(page.locator('#wlSvcHome .vision-ticket-entry')).toBeVisible();
  await expect(page.locator('#wlSvcHome [data-wl-service-return]')).toBeVisible();
  await page.evaluate(()=>{setIdentity('it');show('it');});
  await expect(page.locator('#view-it')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/cos-service-basics/);
});

test('mobile fields fit the screen and stay usable with a keyboard',async({page})=>{
  await inventory(page);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    const layout=await page.locator('#wlSvcTruckInventory').evaluate(card=>({scroll:document.documentElement.scrollWidth,width:innerWidth,fields:[...card.querySelectorAll('input:not([type="checkbox"])')].map(input=>{const r=input.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};})}));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    for(const field of layout.fields){expect(field.left).toBeGreaterThanOrEqual(0);expect(field.right).toBeLessThanOrEqual(layout.width);expect(field.height).toBeGreaterThanOrEqual(44);}
  }
  await page.getByRole('textbox',{name:'Sniper unit number',exact:true}).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox',{name:'Ranger unit number',exact:true})).toBeFocused();
});

test('missing photos blocks completion and failed upload preserves the evidence for retry',async({page})=>{
  await inventory(page);await fillInventory(page);
  await page.locator('[data-wl-save-truck-inventory]').click();
  await expect(page.locator('[data-wl-truck-save-status]')).toContainText('front and rear unit tag photos');
  expect(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='complete_service_daily_report_v1'))).toHaveLength(0);
  await photos(page);await page.evaluate(()=>fixture.uploadFailure=true);
  await page.locator('[data-wl-save-truck-inventory]').click();
  await expect(page.locator('[data-wl-truck-save-status]')).toContainText('Photo upload failed');
  await expect(page.locator('.cos-daily-evidence img:visible')).toHaveCount(10);
  await page.evaluate(()=>fixture.uploadFailure=false);await page.locator('[data-wl-save-truck-inventory]').click();
  await expect(page.locator('#wlSvcHome')).toBeVisible();
});

test('sign-in resets scroll, fills the viewport and supports keyboard submit',async({page},testInfo)=>{
  await page.evaluate(()=>{setIdentity(null);document.getElementById('authView').classList.remove('hidden');window.login=()=>{window.authCalls=(window.authCalls||0)+1;};});
  const auth=page.locator('#authView');await expect(auth).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/cos-auth-visible/);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.getByRole('textbox',{name:'Username',exact:true}).fill('synthetic.service');
  await page.getByRole('textbox',{name:'Username',exact:true}).press('Enter');await expect(page.locator('#loginPassword')).toBeFocused();
  await page.locator('#loginPassword').fill('synthetic-only');await page.locator('#loginPassword').press('Enter');
  expect(await page.evaluate(()=>authCalls)).toBe(1);
  const layout=await auth.evaluate(el=>({height:el.getBoundingClientRect().height,viewport:innerHeight,top:el.getBoundingClientRect().top,scroll:document.documentElement.scrollWidth,width:innerWidth}));
  expect(layout.height).toBeGreaterThanOrEqual(layout.viewport);expect(layout.top).toBeGreaterThanOrEqual(0);expect(layout.scroll).toBeLessThanOrEqual(layout.width);
  await page.screenshot({path:testInfo.outputPath('mobile-sign-in.png'),fullPage:true});
});

test('draft numbers and photos survive reopening inventory and are isolated on account change',async({page})=>{
  await inventory(page);await fillInventory(page);await photos(page);
  await page.locator('#wlSvcTruckInventory [data-wl-home="svc"]').click();
  await page.locator('#wlSvcHome [data-wl-service-truck-inventory]').click();
  await expect(page.locator('.cos-daily-evidence img:not([hidden])')).toHaveCount(10);
  await expect(page.getByRole('textbox',{name:'SIM card 1 number',exact:true})).toHaveValue(sims[0]);
  await page.evaluate(()=>{fixture.actor='synthetic-second-service';dispatchEvent(new CustomEvent('techcheck:data-refreshed'));});
  await expect(page.locator('.cos-daily-evidence img:not([hidden])')).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'SIM card 1 number',exact:true})).toHaveValue('');
});

test('lost completion response retries sealed evidence without reuploading',async({page})=>{
  await inventory(page);await fillInventory(page);await photos(page);await page.evaluate(()=>fixture.loseResponse=true);
  await page.locator('[data-wl-save-truck-inventory]').click();await expect(page.locator('[data-wl-truck-save-status]')).toContainText('Synthetic response lost');
  const count=await page.evaluate(()=>fixture.uploaded.length);
  await page.evaluate(()=>fixture.uploadFailure=true);
  await page.locator('[data-wl-save-truck-inventory]').click();await expect(page.locator('#wlSvcHome')).toBeVisible();
  expect(await page.evaluate(()=>fixture.uploaded.length)).toBe(count);
});
