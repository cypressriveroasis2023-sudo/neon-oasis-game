import {test,expect} from '@playwright/test';
import {mountTransfers,SERVICE,OTHER} from './helpers/transfer-fixture.mjs';
const photo={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
let f;test.afterEach(async()=>{await f?.close();f=null;});
async function sign(page,name){await page.getByRole('radio',{name:'Type signature',exact:true}).check();await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill(name);await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();}
async function fillUnit(page,tag='001',sim='00123456789012345670'){
 await page.getByLabel('Unit family / name 1',{exact:true}).fill('Sniper');await page.getByLabel('Unit number 1',{exact:true}).fill(tag);await page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true}).fill(sim);await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill('2');await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('SD card | 1');
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();
}
test('desktop IT opens Fleet Map plus Camera Health; unrelated workspaces stay denied',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});f=await mountTransfers(page);
 const frame=page.frameLocator('#cosITDailyFrame');
 await expect(frame.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 const nav=frame.locator('nav[aria-label="COS Operations"]');
 await expect(nav.getByRole('button')).toHaveCount(2);
 await expect(nav.getByRole('button',{name:'Fleet Dashboard',exact:true})).toHaveAttribute('aria-current','page');
 await expect(nav.getByRole('button',{name:'Camera Health',exact:true})).toBeVisible();
 await expect(page.locator('#legacy')).toBeHidden();
 await expect(frame.getByRole('button',{name:'Tech Checks',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('IT-desktop-fleet-map.png'),fullPage:true});
 for(const route of ['#unit-tracker','#daily-board','#victron-vrm']){
  await page.locator('#cosITDailyFrame').evaluate((el,hash)=>el.contentWindow.location.hash=hash,route);
  await expect.poll(()=>page.locator('#cosITDailyFrame').evaluate(el=>el.contentWindow.location.hash)).toBe('#fleet-dashboard');
  await expect(nav.getByRole('button')).toHaveCount(2);
 }
 expect(f.errors).toEqual([]);expect(f.calls.some(c=>c.path==='/api/unit-tracker')).toBe(false);
});
test('phone IT has check-out/check-in only and creates a recipient-scoped handoff without truck inventory',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toBeVisible();await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);await expect(page.locator('#legacy')).toBeHidden();await page.screenshot({path:info.outputPath('IT-phone-home.png'),fullPage:true});
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('sniper:001');await page.getByRole('button',{name:'Add unit to handoff'}).click();await fillUnit(page);
 for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();await sign(page,'Synthetic IT');await page.screenshot({path:info.outputPath('IT-phone-checkout.png'),fullPage:true});await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const state=await f.db.query('select * from app_private.techcheck_transfers');expect(state.rows).toHaveLength(1);expect(state.rows[0].service_actor).toBe(SERVICE);expect(state.rows[0].state).toBe('awaiting_service');expect(f.calls.some(c=>/truck_inventory/.test(c.name||''))).toBe(false);expect(f.errors).toEqual([]);
});
test('Service sees only its own handoffs; mismatched number and SIM are recorded as unresolved',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true});await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await expect(page.getByLabel('Unit number 1',{exact:true})).toHaveValue('');await fillUnit(page,'999','009999');await sign(page,'Synthetic Service');await page.screenshot({path:info.outputPath('Service-phone-verification.png'),fullPage:true});await page.getByRole('button',{name:'Sign & verify received equipment'}).click();await expect(page.getByText('Discrepancy — not accepted',{exact:true})).toBeVisible();
 const state=(await f.db.query('select state from app_private.techcheck_transfers')).rows[0];expect(state.state).toBe('discrepancy');await page.evaluate(actor=>changeActor(actor),OTHER);await expect(page.getByText('No handoffs in the current saved view.')).toBeVisible();await expect(page.getByRole('button',{name:'Verify equipment received'})).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('Service exact receipt is accepted; reloading cannot create a duplicate receipt',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true});await page.getByRole('button',{name:'Verify equipment received'}).click();await fillUnit(page);await sign(page,'Synthetic Service');await page.evaluate(()=>fixture.loseResponse=true);await page.getByRole('button',{name:'Sign & verify received equipment'}).click();await expect(page.getByRole('button',{name:'Retry same submission',exact:true})).toBeVisible();await page.getByRole('button',{name:'Retry same submission',exact:true}).click();await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();expect((await f.db.query('select * from app_private.techcheck_transfer_events')).rows).toHaveLength(2);
});
test('offline data and photos survive reopening, and a failed upload does not accept equipment',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true});await page.getByRole('button',{name:'Verify equipment received'}).click();await fillUnit(page);await sign(page,'Synthetic Service');await page.evaluate(()=>fixture.online=false);await page.getByRole('button',{name:'Sign & verify received equipment'}).click();await expect(page.getByRole('alert')).toContainText('Offline');expect((await f.db.query('select state from app_private.techcheck_transfers')).rows[0].state).toBe('awaiting_service');
 await page.reload();await page.getByRole('button',{name:'Verify equipment received'}).click();await expect(page.getByLabel('Unit number 1',{exact:true})).toHaveValue('001');await expect(page.locator('.tc-evidence img')).toBeVisible();await page.evaluate(()=>fixture.uploadFail=true);await page.getByRole('button',{name:'Sign & verify received equipment'}).click();await expect(page.getByRole('alert')).toContainText('upload failed');await page.evaluate(()=>fixture.uploadFail=false);await page.getByRole('button',{name:'Retry same submission',exact:true}).click();await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();
});
test('Service can explicitly record nothing received without auto-acceptance',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true});await page.getByRole('button',{name:'Verify equipment received'}).click();await page.getByLabel('I did not receive this item',{exact:true}).check();await sign(page,'Synthetic Service');await page.getByRole('button',{name:'Sign & verify received equipment'}).click();await expect(page.getByText('Discrepancy — not accepted',{exact:true})).toBeVisible();
});
test('changing an entry clears confirmation and layouts fit narrow phones',async({page})=>{
 await page.setViewportSize({width:320,height:800});f=await mountTransfers(page,{role:'service',seedHandoff:true});await page.getByRole('button',{name:'Verify equipment received'}).click();await fillUnit(page);await sign(page,'Synthetic Service');await page.getByLabel('Unit number 1',{exact:true}).fill('002');await expect(page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true})).not.toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByLabel('Unit number 1',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true})).toBeFocused();
});

test('receipt and original daily sign-off keep independent signature controls',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true});
 await page.getByRole('button',{name:'Verify equipment received'}).click();
 await page.evaluate(async()=>{const {createDailySignoff,newSignature}=await import('/tech-checks/service-signoff-ui.js');const host=document.createElement('section');host.id='original-daily-signature';document.getElementById('wlSvcTruckInventory').prepend(host);host.append(createDailySignoff({state:newSignature(),actorName:'Synthetic Service',onChange:()=>{},isBusy:()=>false}));});
 const original=page.locator('#original-daily-signature'),receipt=page.locator('[data-techcheck-service-transfers]');
 await original.getByRole('radio',{name:'Type signature',exact:true}).check();
 await receipt.getByRole('radio',{name:'Type signature',exact:true}).check();
 await expect(original.getByRole('radio',{name:'Type signature',exact:true})).toBeChecked();
 await receipt.getByRole('radio',{name:'Draw signature',exact:true}).check();
 await expect(original.getByRole('radio',{name:'Type signature',exact:true})).toBeChecked();
});
