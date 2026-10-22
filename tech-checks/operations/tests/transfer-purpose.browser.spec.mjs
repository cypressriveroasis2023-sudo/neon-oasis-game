import {test,expect} from '@playwright/test';
import {mountTransfers,IT,SERVICE,OWNER} from './helpers/transfer-fixture.mjs';

const photo={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
const solar={equipment_key:'solar_spotter:039',family:'Solar Spotter',unit_tag:'039',sims:['00123456789012345670'],battery_count:null,battery_configuration:null,parts:[]};
const sniper={equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:[],battery_count:null,battery_configuration:null,parts:[]};
let f;
test.afterEach(async()=>{await f?.close();f=null;});
async function sign(page,name='Synthetic Service'){
 await page.getByRole('radio',{name:'Type signature',exact:true}).check();
 await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill(name);
 await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();
}
async function details(page,{family='Solar spotter',tag='039',sim=solar.sims[0],batteries=null}={}){
 await page.getByLabel('Unit family / name 1',{exact:true}).fill(family);
 await page.getByLabel('Unit number 1',{exact:true}).fill(tag);
 await page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true}).fill(sim);
 await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('N/A');
 if(batteries!==null)await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill(batteries);
}
async function asService(page){
 await page.evaluate(async actor=>{
  fixture.actor=actor;fixture.role='service';document.getElementById('appView').hidden=true;
  const root=document.createElement('section');root.id='purpose-service-test';document.body.append(root);
  const {mountTransferDesk}=await import('/tech-checks/transfers/desk.js');window.purposeServiceDispose=mountTransferDesk(root,TechCheckContext,{role:'service'});
 },SERVICE);
}

for(const width of [390,1440])test('truck receipt is one equipment confirmation with original IT photo at '+width+'px',async({page},info)=>{
 await page.setViewportSize({width,height:900});
 f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment',seedItems:[solar]});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await expect(page.getByText('Truck replenishment',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Unit number 1',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Equipment photo 1',{exact:true})).toHaveCount(0);
 await expect(page.getByAltText('Original IT handoff photo for Solar Spotter 039',{exact:true})).toBeVisible();
 await expect(page.getByText('Original IT handoff photo — provided by Synthetic IT',{exact:true})).toBeVisible();
 await expect(page.locator('.tc-expected')).not.toContainText('batter');
 await page.getByRole('checkbox',{name:'I received this equipment as listed',exact:true}).check();
 await sign(page);
 await page.screenshot({path:info.outputPath('simple-truck-receipt-'+width+'.png'),fullPage:true});
 await page.locator('form[aria-label="Equipment transfer form"]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Reload handoffs',exact:true}).click();
 await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
 const receipts=(await f.db.query("select snapshot,photos from app_private.techcheck_transfer_events where kind='receipt'")).rows;
 expect(receipts).toHaveLength(1);expect(receipts[0].photos).toEqual([]);
 expect(receipts[0].snapshot.actual[0].battery_count).toBeNull();expect(receipts[0].snapshot.differences).toEqual([]);
 expect(receipts[0].snapshot.original_evidence).toHaveLength(1);
 expect(receipts[0].snapshot.original_evidence[0].source_actor_id).toBe(IT);
 expect(receipts[0].snapshot.signature.signed_by).toBe(SERVICE);
 expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n).toBe(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('IT must choose a purpose and truck replenishment has no battery questions',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();
 const purpose=page.getByLabel('What is this equipment for?',{exact:true});await expect(purpose).toHaveValue('');
 await page.getByLabel('Select equipment').selectOption('solar_spotter:039');await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Choose the handoff purpose first');
 await purpose.selectOption('truck_replenishment');
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('solar_spotter:039');await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
 await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveCount(0);
 await expect(page.locator('fieldset').first()).not.toContainText('battery');
 await details(page,{family:'Solar Spotter'});for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const transfer=(await f.db.query('select purpose,manifest from app_private.techcheck_transfers')).rows[0];
 expect(transfer.purpose).toBe('truck_replenishment');expect(transfer.manifest[0].battery_count).toBeNull();expect(transfer.manifest[0].battery_configuration).toBeNull();
 expect(f.calls.some(call=>/truck_inventory/.test(call.name||''))).toBe(false);expect(f.errors).toEqual([]);
});

test('installation Solar Spotter requires four 12V110Ah batteries and delivery readiness',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('solar_spotter:039');await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
 await expect(page.getByText('Required installation package: 4 × 12V 110Ah per Solar Stand',{exact:true})).toBeVisible();
 await expect(page.getByText(/350Ah/)).toHaveCount(0);
 await details(page,{family:'Solar Spotter',batteries:'3'});for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();await expect(page.locator('.tc-submit-error')).toContainText('requires 4 × 12V 110Ah');
 expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2')).toHaveLength(0);
 await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill('4');await sign(page,'Synthetic IT');await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const event=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='checkout'")).rows[0].snapshot;
 expect(event.purpose).toBe('installation');expect(event.actual[0].battery_count).toBe(4);expect(event.actual[0].battery_configuration).toBe('agm_4x_12v_110ah');
 for(const field of ['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'])expect(event.checks[solar.equipment_key][field]).toBe(true);
 expect(f.errors).toEqual([]);
});

test('truck discrepancy asks for actual unit evidence, ignores battery counts, and stays saved once',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment',seedItems:[solar]});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await page.getByRole('button',{name:'Something is different or missing',exact:true}).click();
 await details(page,{tag:'040'});await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveCount(0);await sign(page);
 await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();await expect(page.locator('.tc-submit-error')).toContainText('required equipment photo');
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence:not(.tc-original-evidence) img')).toBeVisible();await sign(page);await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
 await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
 const event=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='receipt'")).rows[0].snapshot;
 expect(event.differences.map(diff=>diff.field)).toEqual(['unit_tag']);expect(event.actual[0].family).toBe('Solar spotter');expect(f.errors).toEqual([]);
});

test('one missing truck unit does not require a new photo for another unchanged unit',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment',seedItems:[sniper,solar]});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 const groups=page.locator('fieldset');await groups.nth(0).getByRole('checkbox',{name:'I received this equipment as listed',exact:true}).check();
 await groups.nth(1).getByRole('button',{name:'Something is different or missing',exact:true}).click();await groups.nth(1).getByRole('checkbox',{name:'I did not receive this item',exact:true}).check();
 await sign(page);await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
 const event=(await f.db.query("select snapshot,photos from app_private.techcheck_transfer_events where kind='receipt'")).rows[0];
 expect(event.photos).toEqual([]);expect(event.snapshot.original_evidence).toHaveLength(1);expect(event.snapshot.differences).toEqual([{equipment_key:solar.equipment_key,field:'item',expected:'Present',actual:'Missing'}]);
 expect(f.errors).toEqual([]);
});

test('an installation receipt can report an unknown wrong family without bypassing discrepancy review',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true,handoffPurpose:'installation',seedItems:[{...solar,battery_count:4,battery_configuration:'agm_4x_12v_110ah'}]});
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await details(page,{family:'Different camera',tag:'040',batteries:'0'});
 await expect(page.getByRole('region',{name:'Receipt comparison'})).toContainText('Unit family: IT sent Solar Spotter; receipt records Different camera');
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();await sign(page);await page.getByRole('button',{name:'Sign & verify received equipment',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
 const event=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='receipt'")).rows[0].snapshot;
 expect(event.differences.map(diff=>diff.field)).toEqual(['family','unit_tag','battery_count','battery_configuration']);expect(event.actual[0].battery_configuration).toBeNull();expect(f.errors).toEqual([]);
});

test('Service cannot classify an unlabelled legacy handoff',async({page})=>{
 f=await mountTransfers(page,{role:'service',seedHandoff:true,legacyHandoff:true});
 await expect(page.getByText('Purpose needs IT / Owner confirmation',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose handoff purpose',exact:true})).toHaveCount(0);
 expect(f.calls.filter(call=>call.name==='classify_techcheck_transfer_purpose_v1')).toHaveLength(0);
});

test('audited legacy purpose update preserves four receipts and asks Service for exactly one new confirmation',async({page})=>{
 await page.setViewportSize({width:390,height:844});const legacySolar={...solar,battery_count:1};delete legacySolar.battery_configuration;
 f=await mountTransfers(page,{role:'it',seedHandoff:true,legacyHandoff:true,seedItems:[legacySolar],legacyReceiptCounts:[0,0,0,4]});
 const before=(await f.db.query('select id,request,snapshot,photos from app_private.techcheck_transfer_events order by id')).rows;
 expect(before).toHaveLength(5);
 await page.getByRole('button',{name:'Choose handoff purpose',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('truck_replenishment');
 await expect(page.getByLabel('Installation battery quantity 1',{exact:true})).toHaveCount(0);
 await page.getByLabel('Reason for purpose update',{exact:true}).fill('Owner confirmed this equipment is truck replenishment.');await page.evaluate(()=>fixture.loseResponse=true);await page.getByRole('button',{name:'Save purpose & request confirmation',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry same purpose update',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Verify saved purpose update',exact:true}).click();await page.getByRole('button',{name:'Retry same purpose update',exact:true}).click();
 await expect(page.getByRole('button',{name:'Verify saved purpose update',exact:true})).toHaveCount(0);
 const updates=f.calls.filter(call=>call.name==='classify_techcheck_transfer_purpose_v1');expect(updates).toHaveLength(2);expect(updates[0].args).toEqual(updates[1].args);
 expect((await f.db.query("select count(*)::int n from app_private.techcheck_transfer_events where kind='purpose_amendment'")).rows[0].n).toBe(1);
 await asService(page);await expect(page.getByRole('region',{name:'Saved Service receipt'})).not.toContainText('Batteries / battery boxes');
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await page.getByRole('checkbox',{name:'I received this equipment as listed',exact:true}).check();await sign(page);await page.getByRole('button',{name:'Sign & confirm received',exact:true}).click();
 await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
 const after=(await f.db.query('select id,request,snapshot,photos from app_private.techcheck_transfer_events order by id')).rows;
 expect(after.filter(event=>before.some(old=>old.id===event.id))).toEqual(before);expect(after).toHaveLength(7);
 expect((await f.db.query('select count(*)::int n from service_truck_units')).rows[0].n).toBe(0);
 expect(f.errors).toEqual([]);
});

test('Owner opens equipment desk and completes legacy four-receipt replenishment with one audited resolution',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 f=await mountTransfers(page,{role:'service',seedHandoff:true,legacyHandoff:true,seedItems:[{...solar,battery_count:4}],legacyReceiptCounts:[0,0,0,4]});
 const before=(await f.db.query('select * from app_private.techcheck_transfer_events order by signed_at,id')).rows;
 const outbox=(await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n;
 await page.evaluate(async owner=>{fixture.actor=owner;fixture.role='owner';document.getElementById('appView').hidden=true;const root=document.createElement('section');document.body.append(root);const {mountTransferDesk}=await import('/tech-checks/transfers/desk.js');mountTransferDesk(root,TechCheckContext,{role:'it'});},OWNER);
 await page.getByRole('button',{name:'Complete as Owner',exact:true}).click();
 await expect(page.getByLabel('Owner handoff purpose')).toHaveValue('truck_replenishment');
 await expect(page.getByLabel('Signed Service receipt').locator('option')).toHaveCount(4);
 await page.getByLabel('Owner resolution reason').fill('Truck replenishment — batteries tracked separately in daily truck inventory.');
 await page.getByRole('button',{name:'Complete handoff as Owner',exact:true}).click();
 expect(f.calls.filter(c=>c.name==='owner_resolve_techcheck_transfer_v1')).toHaveLength(0);
 await page.getByRole('button',{name:'View saved equipment photo',exact:true}).click();
 await expect(page.getByRole('link',{name:'Open saved equipment photo'})).toBeVisible();
 await page.getByLabel('I reviewed the saved equipment photo and confirm the exact unit identity',{exact:true}).check();
 await page.getByRole('button',{name:'Complete handoff as Owner',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Owner completion saved');
 const saved=(await f.db.query('select * from app_private.techcheck_transfers')).rows[0];
 expect(saved.state).toBe('accepted');expect(saved.revision).toBe(6);expect(saved.purpose).toBe('truck_replenishment');expect(saved.manifest[0].battery_count).toBeNull();
 const events=(await f.db.query('select * from app_private.techcheck_transfer_events order by signed_at,id')).rows;
 expect(events.filter(e=>e.kind==='receipt')).toHaveLength(4);expect(events.filter(e=>e.kind==='owner_resolution')).toHaveLength(1);expect(events.filter(e=>e.kind!=='owner_resolution')).toEqual(before);expect(events.at(-1).actor_id).toBe(OWNER);
 expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n).toBe(outbox);
 expect(f.errors).toEqual([]);
});
