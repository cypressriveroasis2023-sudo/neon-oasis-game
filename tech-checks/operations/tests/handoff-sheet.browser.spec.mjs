import {test,expect} from '@playwright/test';
import {mountTransfers,SERVICE,passServiceChecks,setFamily} from './helpers/transfer-fixture.mjs';

// Walks the printed "COS Equipment Handoff — How To" sheet step by step, on a phone,
// with the real Tech Check screens and the handoff rules loaded in the test database.
// If a step on the sheet stops being true, this file fails.
const photo={name:'unit.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
let f;test.afterEach(async()=>{await f?.close();f=null;});
const typedSignature=async(page,name)=>{await page.getByRole('radio',{name:'Type signature',exact:true}).check();await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill(name);const c=page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true});if(!(await c.isChecked()))await c.check();};
const NOTE_OK='This note is only information — the equipment is ready';

test('page 1 (IT): every step on the sheet works as written',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await f.db.query("insert into app_private.sim_drawer(sim_number,carrier) values('89852350825066019344','Smart SIM 2.0')");
 await page.reload();
 // 1. Open Tech Check and tap Check Out / Hand Off
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();
 // 2. Pick what it is for: Truck replenishment or Installation
 const purpose=page.getByLabel('What is this equipment for?',{exact:true});
 await expect(purpose.locator('option')).toContainText(['Truck replenishment','Installation']);
 await purpose.selectOption('truck_replenishment');
 // 3. Pick the tech under Receiving Service technician
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);
 // 4. Pick the unit under Select equipment, then tap Add unit to handoff
 await page.getByLabel('Select equipment').selectOption('sniper:001');
 await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
 await setFamily(page,'Sniper');await page.getByLabel('Unit number 1',{exact:true}).fill('001');
 await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('N/A');
 // 5. SIM: use Pick a SIM from the drawer (fills the full number; no typing)
 await page.getByLabel('Pick a SIM from the drawer 1',{exact:true}).selectOption('89852350825066019344');
 await expect(page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true})).toHaveValue('89852350825066019344');
 // 6. Tick every check and take the unit photo. A check left unticked stops the handoff.
 const checks=await page.locator('fieldset input[type=checkbox]').all();expect(checks.length).toBeGreaterThan(3);
 for(const c of checks.slice(1))await c.check();
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();
 await typedSignature(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Finish the required equipment check');
 expect((await f.db.query('select * from app_private.techcheck_transfers')).rows).toHaveLength(0);
 await checks[0].check();
 // 7. Notes: a note that says something is still needed stops the handoff until fixed or confirmed
 await page.getByLabel('Transfer notes',{exact:true}).fill('Need semitry sim.');
 await typedSignature(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Your note says something is still needed');
 expect((await f.db.query('select * from app_private.techcheck_transfers')).rows).toHaveLength(0);
 await page.getByRole('checkbox',{name:NOTE_OK,exact:true}).check();
 // 8. Sign and tap Sign & send handoff → Awaiting Service verification
 await typedSignature(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 // The SIM left the drawer and went with the unit.
 expect((await f.db.query("select status,location from app_private.sim_drawer where sim_number='89852350825066019344'")).rows[0]).toEqual({status:'in_unit',location:'Sniper 001 → Synthetic Service'});
});

test('page 1 (IT): an empty SIM drawer says to ask James',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();
 await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('truck_replenishment');
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);
 await page.getByLabel('Select equipment').selectOption('sniper:001');await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
 await expect(page.getByLabel('Pick a SIM from the drawer 1',{exact:true}).locator('option').first()).toHaveText('The SIM drawer is empty — ask James to add cards');
});

test('page 2 (Service): received as listed — every step on the sheet works as written',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment'});
 // 1. Equipment received from IT → Verify equipment received
 await expect(page.getByText('Equipment received from IT').first()).toBeVisible();
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 // 2. Answer every check, Pass or Problem; a blank check stops signing
 await expect(page.getByText('Check it yourself before you sign',{exact:true})).toBeVisible();
 const picks=page.locator('select[data-service-check]');expect(await picks.count()).toBeGreaterThan(3);
 await expect(picks.first().locator('option')).toHaveText(['Choose Pass or Problem','Pass','Problem']);
 // 3. Got exactly what IT listed? Tick I received this equipment as listed
 await page.getByRole('checkbox',{name:'I received this equipment as listed',exact:true}).check();
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(picks.first()).toBeFocused();
 expect((await f.db.query("select * from app_private.techcheck_transfer_events where kind='receipt'")).rows).toHaveLength(0);
 await passServiceChecks(page);
 // 6. Sign and tap Sign & confirm received → received
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();
 expect((await f.db.query('select state from app_private.techcheck_transfers')).rows[0].state).toBe('accepted');
});

test('page 2 (Service): a Problem needs a note and goes to review; sign once',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment'});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await page.getByRole('checkbox',{name:'I received this equipment as listed',exact:true}).check();
 await passServiceChecks(page);await page.locator('select[data-service-check]').first().selectOption('false');
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Write in Notes what is wrong');
 await page.getByText('Add a note (optional)').click();
 await page.getByLabel('Transfer notes',{exact:true}).fill('Will not power on.');
 // a Problem also needs a photo that shows it
 await expect(page.getByText('You marked a Problem. Take a photo that shows it.',{exact:true})).toBeVisible();
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('required equipment photo');
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence:not(.tc-original-evidence) img')).toBeVisible();
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
 // Sign once: the button is gone after a receipt is saved.
 await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
 expect((await f.db.query('select state from app_private.techcheck_transfers')).rows[0].state).toBe('discrepancy');
});

test('page 2 (Service): note says something is wrong but every check passed',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment'});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await page.getByRole('checkbox',{name:'I received this equipment as listed',exact:true}).check();
 await passServiceChecks(page);
 await page.getByText('Add a note (optional)').click();
 await page.getByLabel('Transfer notes',{exact:true}).fill('Missing the SD card');
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('Your note says something is wrong or missing');
 await page.getByRole('checkbox',{name:NOTE_OK,exact:true}).check();
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();
});

test('page 2 (Service): something different or missing — unit type list, photo, did-not-receive',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment'});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 // 5. Something is different or missing → pick the unit type you actually got
 await page.getByRole('button',{name:'Something is different or missing',exact:true}).click();
 await expect(page.getByLabel('Unit family / name 1',{exact:true}).locator('option')).toHaveText(['Choose the unit type','Sniper','Ranger','Spotter','Solar Spotter','Recon 2','Helios','Something else (type it)']);
 await expect(page.getByRole('checkbox',{name:'I did not receive this item',exact:true})).toBeVisible();
 await setFamily(page,'Sniper');await page.getByLabel('Unit number 1',{exact:true}).fill('002');
 await page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true}).fill('00123456789012345670');
 await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('N/A');
 await passServiceChecks(page);
 await typedSignature(page,'Synthetic Service');
 // ...and take a photo of it: required
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.locator('.tc-submit-error')).toContainText('required equipment photo');
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence:not(.tc-original-evidence) img')).toBeVisible();
 await typedSignature(page,'Synthetic Service');
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
 const [e]=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='receipt'")).rows;
 expect(e.snapshot.differences.map(d=>d.field)).toContain('unit_tag');
});

test('page 2 (Service): installs use Sign & verify received equipment',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'installation'});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sign & verify received equipment',exact:true})).toBeVisible();
});
