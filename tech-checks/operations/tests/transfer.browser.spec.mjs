import {test,expect} from '@playwright/test';
import {mountTransfers,SERVICE,OTHER,passServiceChecks,setFamily} from './helpers/transfer-fixture.mjs';
const photo={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
let f;test.afterEach(async()=>{await f?.close();f=null;});
async function sign(page,name){await passServiceChecks(page);await page.getByRole('radio',{name:'Type signature',exact:true}).check();await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill(name);await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();}
async function fillUnit(page,tag='001',sim='00123456789012345670'){
 await setFamily(page,'Sniper');await page.getByLabel('Unit number 1',{exact:true}).fill(tag);await page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true}).fill(sim);await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill('2');await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('SD card | 1');
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();
}
test('desktop IT opens Fleet Map plus Camera Health; unrelated workspaces stay denied',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});f=await mountTransfers(page);
 const frame=page.frameLocator('#cosITDailyFrame');
 await expect(frame.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 const nav=frame.locator('nav[aria-label="COS Operations"]');
 await expect(nav.getByRole('button')).toHaveCount(6);
 await expect(nav.getByRole('button',{name:'Fleet Dashboard',exact:true})).toHaveAttribute('aria-current','page');
 await expect(nav.getByRole('button',{name:'Camera Health',exact:true})).toBeVisible();
 await expect(page.locator('#legacy')).toBeHidden();
 await expect(frame.getByRole('button',{name:'Tech Checks',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('IT-desktop-fleet-map.png'),fullPage:true});
 // The tracker and Victron are equipment and a tech opens them now, so only
 // the owner's board is still turned away here.
 for(const route of ['#daily-board']){
  await page.locator('#cosITDailyFrame').evaluate((el,hash)=>el.contentWindow.location.hash=hash,route);
  await expect.poll(()=>page.locator('#cosITDailyFrame').evaluate(el=>el.contentWindow.location.hash)).toBe('#fleet-dashboard');
  await expect(nav.getByRole('button')).toHaveCount(6);
 }
 expect(f.errors).toEqual([]);expect(f.calls.some(c=>c.path==='/api/unit-tracker')).toBe(false);
});
test('phone IT has check-out/check-in only and creates a recipient-scoped handoff without truck inventory',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toBeVisible();await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);await expect(page.locator('#legacy')).toBeHidden();await page.screenshot({path:info.outputPath('IT-phone-home.png'),fullPage:true});
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('sniper:001');await page.getByRole('button',{name:'Add unit to handoff'}).click();await fillUnit(page);
 for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();await sign(page,'Synthetic IT');await page.screenshot({path:info.outputPath('IT-phone-checkout.png'),fullPage:true});await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const state=await f.db.query('select * from app_private.techcheck_transfers');expect(state.rows).toHaveLength(1);expect(state.rows[0].service_actor).toBe(SERVICE);expect(state.rows[0].state).toBe('awaiting_service');expect(f.calls.some(c=>/truck_inventory/.test(c.name||''))).toBe(false);expect(f.errors).toEqual([]);
});
test('phone IT receives actionable extra-parts validation and can send N/A without altering custody rules',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);
 await page.getByLabel('Select equipment').selectOption('sniper:001');
 await page.getByRole('button',{name:'Add unit to handoff'}).click();
 await fillUnit(page);
 const parts=page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true});
 await parts.fill('Charging cable');
 for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();
 await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Additional parts, line 1');
 await expect(parts).toBeFocused();
 expect(f.calls.filter(c=>c.name==='submit_techcheck_transfer_v2')).toHaveLength(0);
 expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfers')).rows[0].n).toBe(0);
 await parts.fill('N/A');
 await expect(page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true})).not.toBeChecked();
 await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const transfer=(await f.db.query('select manifest from app_private.techcheck_transfers')).rows[0];
 expect(transfer.manifest[0].parts).toEqual([]);
 expect(f.errors).toEqual([]);
});
test('IT handoff displays required-field and checklist errors instead of silently ignoring submit',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);
 await page.getByLabel('Select equipment').selectOption('sniper:001');
 await page.getByRole('button',{name:'Add unit to handoff'}).click();
 await fillUnit(page);
 const batteries=page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true});
 await batteries.fill('');
 await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Batteries / battery boxes');
 await expect(batteries).toBeFocused();
 await batteries.fill('2');
 await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Finish the required equipment check');
 expect(f.calls.filter(c=>c.name==='submit_techcheck_transfer_v2')).toHaveLength(0);
 expect(f.errors).toEqual([]);
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

test('Service must answer every check before signing, and a Problem needs a note and goes to review',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await fillUnit(page);
 await expect(page.getByText('Check it yourself before you sign',{exact:true})).toBeVisible();
 const picks=page.locator('select[data-service-check]');expect(await picks.count()).toBeGreaterThan(3);
 // signing with the checks left blank is stopped on the first unanswered check
 await page.getByRole('radio',{name:'Type signature',exact:true}).check();await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill('Synthetic Service');await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();
 await page.getByRole('button',{name:'Sign & verify received equipment'}).click();
 await expect(picks.first()).toBeFocused();
 expect((await f.db.query("select * from app_private.techcheck_transfer_events where kind='receipt'")).rows).toHaveLength(0);
 // a Problem without a note is stopped too
 await passServiceChecks(page);await picks.first().selectOption('false');
 await page.getByRole('button',{name:'Sign & verify received equipment'}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Write in Notes what is wrong');
 expect((await f.db.query("select * from app_private.techcheck_transfer_events where kind='receipt'")).rows).toHaveLength(0);
 // with a note it is saved for review, with the failed check recorded
 await page.getByLabel('Transfer notes',{exact:true}).fill('Unit will not power on from 120V.');
 const confirm=page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true});if(!(await confirm.isChecked()))await confirm.check();
 await page.getByRole('button',{name:'Sign & verify received equipment'}).click();
 await expect(page.getByText('Discrepancy — not accepted',{exact:true})).toBeVisible();
 const [event]=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='receipt'")).rows;
 expect(event.snapshot.differences.filter(d=>String(d.field).startsWith('check:')).map(d=>d.field)).toEqual(['check:power_ok']);
 expect(event.snapshot.checks['sniper:001'].power_ok).toBe(false);
});

test('the database refuses a receipt with a blank check even if the screen is skipped',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true});
 const [t]=(await f.db.query('select id,revision,purpose,manifest from app_private.techcheck_transfers')).rows;
 await f.db.exec('reset role');await f.db.query("select set_config('test.actor',$1,false)",[SERVICE]);await f.db.exec('set role authenticated');
 const items=t.manifest.map(({equipment_key,family,unit_tag,sims,parts,battery_count,battery_configuration})=>({equipment_key,family,unit_tag,sims,parts,battery_count,battery_configuration}));
 await expect(f.db.query("select submit_techcheck_transfer_v2($1,$2,'receipt',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'[]'::jsonb,'',$8)",
  [crypto.randomUUID(),t.id,t.revision,SERVICE,JSON.stringify(items),JSON.stringify({'sniper:001':{}}),JSON.stringify({method:'typed',name:'Synthetic Service',confirmed:true}),t.purpose])).rejects.toThrow(/Answer every check for Sniper 001/);
 await f.db.exec('reset role');
});

test('IT picks a SIM from the drawer during a handoff, and that SIM leaves the drawer',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await f.db.query("insert into app_private.sim_drawer(sim_number,carrier) values('89852350825066019344','Smart SIM'),('89852350825066019369','Smart SIM')");
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('sniper:001');await page.getByRole('button',{name:'Add unit to handoff'}).click();
 await fillUnit(page,'001','');
 const pick=page.getByLabel('Pick a SIM from the drawer 1',{exact:true});
 await expect(pick.locator('option').first()).toHaveText('Pick a SIM from the drawer (2 in the drawer)');
 await pick.selectOption('89852350825066019344');
 await expect(page.getByLabel(/Exact SIM numbers.*1/)).toHaveValue('89852350825066019344');
 // a SIM already picked is not offered again
 await expect(page.getByLabel('Pick a SIM from the drawer 1',{exact:true}).locator('option')).toHaveCount(2);
 for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const cards=(await f.db.query('select sim_number,status,location from app_private.sim_drawer order by sim_number')).rows;
 expect(cards).toEqual([{sim_number:'89852350825066019344',status:'in_unit',location:'Sniper 001 → Synthetic Service'},{sim_number:'89852350825066019369',status:'in_drawer',location:null}]);
 expect(f.errors).toEqual([]);
});

test('a note that says something is still needed cannot go out with every check passed, unless IT confirms it is only information',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('sniper:001');await page.getByRole('button',{name:'Add unit to handoff'}).click();await fillUnit(page);
 for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();
 await page.getByLabel('Transfer notes',{exact:true}).fill('Need semitry sim.');
 await expect(page.getByText('Your note says something is still needed. Fix it before handing over, or confirm:')).toBeVisible();
 await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Your note says something is still needed');
 expect((await f.db.query('select * from app_private.techcheck_transfers')).rows).toHaveLength(0);
 await page.getByRole('checkbox',{name:'This note is only information — the equipment is ready',exact:true}).check();
 const confirm=page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true});if(!(await confirm.isChecked()))await confirm.check();
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const [event]=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='checkout'")).rows;
 expect(event.snapshot.checks._note_ready).toBe(true);
});

test('the database refuses a contradicting note on its own, and SIMs written differently are not a difference',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment'});
 const [t]=(await f.db.query('select id,revision,purpose,manifest from app_private.techcheck_transfers')).rows;
 const rules=(await f.db.query("select bool_fields from app_private.techcheck_transfer_rules where workflow_type='Sniper'")).rows[0].bool_fields;
 const checks={'sniper:001':Object.fromEntries(rules.filter(r=>!['delivery_batteries_charged_ok'].includes(r)).map(r=>[r,true]))};
 // same SIM, written with spaces and dashes
 const items=t.manifest.map(({equipment_key,family,unit_tag,sims,parts,battery_count,battery_configuration})=>({equipment_key,family:family.toUpperCase(),unit_tag,sims:sims.map(s=>' '+s.slice(0,4)+'-'+s.slice(4)+' '),parts,battery_count,battery_configuration}));
 const call=(notes,c)=>f.db.query("select submit_techcheck_transfer_v2($1,$2,'receipt',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'[]'::jsonb,$8,$9) r",
  [crypto.randomUUID(),t.id,t.revision,SERVICE,JSON.stringify(items),JSON.stringify(c),JSON.stringify({method:'typed',name:'Synthetic Service',confirmed:true}),notes,t.purpose]);
 await f.db.exec('reset role');await f.db.query("select set_config('test.actor',$1,false)",[SERVICE]);await f.db.exec('set role authenticated');
 try{
  await expect(call('Missing the SD card',checks)).rejects.toThrow(/Your note says something is wrong or missing/);
  const {rows:[{r}]}=await call('Missing the SD card',{...checks,_note_ready:true});
  expect(r.differences).toEqual([]);
  expect(r.state).toBe('accepted');
 }finally{await f.db.exec('reset role');}
});
