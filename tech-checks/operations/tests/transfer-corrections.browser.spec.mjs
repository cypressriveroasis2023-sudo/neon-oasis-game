import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mountCorrectionFixture,OWNER,IT,SERVICE,OTHER_IT,ORIGINAL_KEY,CORRECTED_KEY,PHOTO} from './helpers/transfer-correction-fixture.mjs';

let f;
test.afterEach(async()=>{await f?.close();f=null;});
const citedLabel='I am recording the technician’s documented confirmation and applying this correction as myself.';
const selfLabel='I physically checked these unit details and the matching photo.';
const writes=()=>f.calls.filter(c=>c.name==='submit_techcheck_transfer_correction_v1');
const savedStatus=page=>page.getByRole('status').filter({hasText:/^Correction saved\. Server readback verified/});
async function centralConfirmation(){
 const time=new Date(Math.ceil(new Date(f.originalEvent.signed_at).getTime()/1000)*1000);
 // The actual database clock must have reached this second: a confirmation
 // cannot be future-dated even when the test creates its original moments ago.
 await expect.poll(()=>Date.now()).toBeGreaterThanOrEqual(time.getTime());
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]));
 // Chromium normalizes zero seconds away, and Playwright requires that exact
 // normalized input value when filling a datetime-local control.
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`+(parts.second==='00'?'':':'+parts.second);
}
async function openCorrection(page,{self=false}={}){
 await page.getByRole('button',{name:self?'Correct this handoff':'Apply technician-confirmed correction',exact:true}).click();
 await expect(page.getByLabel('Reason for correction',{exact:true})).toBeVisible();
}
async function fillCorrection(page,{self=false,photo=true}={}){
 await page.getByLabel('Reason for correction',{exact:true}).fill('The technician confirmed the actual unit and provided a matching tag photograph.');
 await page.getByLabel('Corrected unit',{exact:true}).selectOption(CORRECTED_KEY);
 await page.getByLabel('Battery count',{exact:true}).fill('1');
 await page.getByLabel('SIM cards',{exact:true}).fill('');
 if(!self){
  await page.getByLabel('Technician confirmation date and time',{exact:true}).fill(await centralConfirmation());
  await page.getByLabel('Technician reply',{exact:true}).fill('I physically checked Solar Spotter 102. The matching photograph shows the unit tag. One battery; no SIM supplied by IT.');
  await page.getByLabel('Technician evidence link',{exact:true}).fill('https://drive.google.com/file/d/synthetic-confirmation/view');
 }
 if(photo){await page.getByLabel('Matching unit and tag photo',{exact:true}).setInputFiles(PHOTO);await expect(page.locator('.tc-evidence img')).toBeVisible();}
 await page.getByRole('checkbox',{name:self?selfLabel:citedLabel,exact:true}).check();
}
async function savedTransfer(who=OWNER){return (await f.rpc(who,'techcheck_transfer_correction_context_v1',{p_transfer_id:f.transferId})).transfers.find(t=>t.id===f.transferId);}
async function expectOriginalUnchanged(){
 expect((await f.db.query('select to_jsonb(e) as data from app_private.techcheck_transfer_events e where id=$1',[f.transferId])).rows[0].data).toEqual(f.originalEvent);
 expect((await f.db.query('select to_jsonb(o) as data from app_private.techcheck_transfer_outbox o where event_id=$1',[f.transferId])).rows[0].data).toEqual(f.originalOutbox);
 expect(f.paths.get(f.originalPath)).toEqual(PHOTO.buffer);
 expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events')).rows[0].n).toBe(1);
}

for(const width of [390,1440])test(`Owner applies cited technician evidence, preserves the original and verifies saved refresh at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});f=await mountCorrectionFixture(page);
 await openCorrection(page);
 await expect(page.getByRole('checkbox',{name:citedLabel,exact:true})).not.toBeChecked();
 await fillCorrection(page);
 await expect(page.getByLabel('Type your full name',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`owner-correction-review-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(savedStatus(page)).toBeVisible();
 const t=await savedTransfer();expect(t.revision).toBe(2);expect(t.state).toBe('awaiting_service');
 expect(t.manifest[0]).toMatchObject({equipment_key:CORRECTED_KEY,unit_tag:'102',sims:[],battery_count:1});
 const revision=t.corrections.at(-1);
 expect(revision.before[0].equipment_key).toBe(ORIGINAL_KEY);expect(revision.after[0].equipment_key).toBe(CORRECTED_KEY);
 expect(revision.applied_by.id).toBe(OWNER);expect(revision.original_technician.id).toBe(IT);
 expect(revision.confirmed_by).toMatchObject({id:IT,mode:'cited'});
 expect(revision.service_recipient.id).toBe(SERVICE);
 expect(revision.technician_reply).toContain('physically checked');
 expect((await f.db.query('select equipment_key from app_private.techcheck_transfer_reservations order by equipment_key')).rows).toEqual([{equipment_key:CORRECTED_KEY}]);
 expect((await f.db.query('select count(*)::int n from service_truck_units')).rows[0].n).toBe(0);
 await expectOriginalUnchanged();
 await info.attach('synthetic-saved-correction-readback',{contentType:'application/json',body:Buffer.from(JSON.stringify({
  environment:'Disposable local synthetic PGlite and browser fixture; no production record was changed',
  captured_at:new Date().toISOString(),viewport:width,acting_account:OWNER,
  submitted_request:writes()[0].args,saved_transfer:t,
  original_event_before:f.originalEvent,
  original_event_after:(await f.db.query('select to_jsonb(e) as data from app_private.techcheck_transfer_events e where id=$1',[f.transferId])).rows[0].data,
  original_outbox_unchanged:true,original_photo_bytes_unchanged:true,
  reservations:(await f.db.query('select equipment_key from app_private.techcheck_transfer_reservations order by equipment_key')).rows,
  service_truck_units_count:0,
 },null,2))});
 await page.reload();
 await expect(page.getByRole('heading',{name:'Handoff corrections',exact:true})).toBeVisible();
 await expect(page.locator('#correction-test-root')).toContainText('Synthetic Owner');
 await expect(page.locator('#correction-test-root')).toContainText('Synthetic IT');
 await expect(page.locator('#correction-test-root')).toContainText('Solar Spotter 101');
 await expect(page.locator('#correction-test-root')).toContainText('Solar Spotter 102');
 await page.getByText('Original signed submission — preserved',{exact:true}).click();
 await expect(page.getByRole('link',{name:'Open original signed handoff',exact:true})).toHaveAttribute('href','https://drive.google.com/file/d/synthetic-original-pdf/view');
 await page.screenshot({path:info.outputPath(`owner-correction-saved-${width}.png`),fullPage:true});
 expect(writes()).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unexpected).toEqual([]);
});

test('original IT records their own physical confirmation without an Owner or Service signature',async({page})=>{
 f=await mountCorrectionFixture(page,{actor:IT});await openCorrection(page,{self:true});
 await expect(page.getByLabel('Technician reply',{exact:true})).toHaveCount(0);
 await fillCorrection(page,{self:true});await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(savedStatus(page)).toBeVisible();
 const t=await savedTransfer(IT),c=t.corrections.at(-1);
 expect(c.applied_by.id).toBe(IT);expect(c.confirmed_by).toMatchObject({id:IT,mode:'self'});
 expect(t.state).toBe('awaiting_service');await expectOriginalUnchanged();expect(f.errors).toEqual([]);
});

test('Service and unverified IT never receive a correction form or write equipment',async({page})=>{
 for(const actor of [SERVICE,OTHER_IT]){
  f=await mountCorrectionFixture(page,{actor});
  await expect(page.getByRole('heading',{name:'Handoff corrections',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Apply technician-confirmed correction|Correct this handoff|Save correction/})).toHaveCount(0);
  expect(writes()).toHaveLength(0);expect((await savedTransfer()).revision).toBe(1);
  await f.close();f=null;await page.unrouteAll({behavior:'wait'});
 }
});

test('an unreleased correction backend does not enable applying changes',async({page})=>{
 f=await mountCorrectionFixture(page,{held:true});
 await expect(page.getByRole('heading',{name:'Handoff corrections',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Apply technician-confirmed correction|Correct this handoff|Save correction/})).toHaveCount(0);
 expect(writes()).toHaveLength(0);expect(f.paths.size).toBe(1);expect(f.errors).toEqual([]);
});

test('reason, cited reply and a matching photo are required and changing details clears confirmation',async({page})=>{
 f=await mountCorrectionFixture(page);await openCorrection(page);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();expect(writes()).toHaveLength(0);
 await fillCorrection(page,{photo:false});
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText(/photo/i);expect(writes()).toHaveLength(0);
 await page.getByLabel('Matching unit and tag photo',{exact:true}).setInputFiles(PHOTO);
 await expect(page.locator('.tc-evidence img')).toBeVisible();
 await page.getByRole('checkbox',{name:citedLabel,exact:true}).check();
 await page.getByLabel('Corrected unit',{exact:true}).selectOption('solar_spotter:103');
 await expect(page.getByRole('checkbox',{name:citedLabel,exact:true})).not.toBeChecked();
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();expect(writes()).toHaveLength(0);
 expect((await savedTransfer()).revision).toBe(1);await expectOriginalUnchanged();
});

test('a lost save response is retried using the same request without a duplicate revision',async({page})=>{
 f=await mountCorrectionFixture(page);await openCorrection(page);await fillCorrection(page);
 await page.evaluate(()=>fixture.loseResponse=true);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saving correction',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Discard rejected draft and review latest handoff',exact:true})).toHaveCount(0);
 expect((await savedTransfer()).revision).toBe(2);
 await page.getByRole('button',{name:'Retry saving correction',exact:true}).click();
 await expect(savedStatus(page)).toBeVisible();
 expect(writes()).toHaveLength(2);expect(writes()[1].args).toEqual(writes()[0].args);
 const t=await savedTransfer();expect(t.revision).toBe(2);expect(t.corrections).toHaveLength(1);
 await expectOriginalUnchanged();expect(f.errors).toEqual([]);
});

test('a write response is not reported saved until a fresh context read confirms it',async({page})=>{
 f=await mountCorrectionFixture(page);await openCorrection(page);await fillCorrection(page);
 await page.evaluate(()=>fixture.failContextAfterWrite=true);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saving correction',exact:true})).toBeVisible();
 await expect(savedStatus(page)).toHaveCount(0);
 expect((await savedTransfer()).revision).toBe(2);
 await page.evaluate(()=>{fixture.failContextAfterWrite=false;fixture.readbackFail=false;});
 await page.getByRole('button',{name:'Retry saving correction',exact:true}).click();
 await expect(savedStatus(page)).toBeVisible();
 expect((await savedTransfer()).corrections).toHaveLength(1);await expectOriginalUnchanged();
});

for(const corruption of ['provenance','photo'])test(`a saved readback with different ${corruption} stays uncertain and preserves the exact retry request`,async({page})=>{
 f=await mountCorrectionFixture(page);await openCorrection(page);await fillCorrection(page);
 await page.evaluate(value=>fixture.corruptReadback=value,corruption);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saving correction',exact:true})).toBeVisible();
 await expect(savedStatus(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Discard rejected draft and review latest handoff',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Corrected unit',{exact:true})).toHaveCount(0);
 expect((await savedTransfer()).revision).toBe(2);expect(writes()).toHaveLength(1);
 await page.evaluate(()=>fixture.corruptReadback=null);
 await page.getByRole('button',{name:'Retry saving correction',exact:true}).click();await expect(savedStatus(page)).toBeVisible();
 expect(writes()).toHaveLength(2);expect(writes()[1].args).toEqual(writes()[0].args);
 expect((await savedTransfer()).corrections).toHaveLength(1);await expectOriginalUnchanged();
});

test('another saved correction invalidates the open form and cannot be overwritten by a stale revision',async({page})=>{
 f=await mountCorrectionFixture(page);await openCorrection(page);await fillCorrection(page);
 const id=randomUUID(),path=OWNER+'/'+id+'/'+'b'.repeat(64)+'.jpg',key='solar_spotter:103';
 await f.db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[path]);
 await f.rpc(OWNER,'submit_techcheck_transfer_correction_v1',{
  p_request_id:id,p_transfer_id:f.transferId,p_expected_revision:1,
  p_items:[{equipment_key:key,family:'Solar Spotter',unit_tag:'103',sims:[],battery_count:1,parts:[]}],
  p_photos:[{equipment_key:key,kind:'unit',path},{equipment_key:key,kind:'tag',path}],
  p_reason:'Independent synthetic correction saved while the first form was open.',
  p_confirmation:{mode:'cited',confirmed:true,technician_id:IT,technician_confirmed_at:f.originalEvent.signed_at,technician_reply:'I verified Solar Spotter 103 and its matching unit tag.',evidence_reference:'https://drive.google.com/file/d/synthetic-concurrent-confirmation/view'},
 });
 await page.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText(/changed|stale|revision|reload/i);
 await expect(savedStatus(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Discard rejected draft and review latest handoff',exact:true})).toBeVisible();
 const t=await savedTransfer();expect(t.revision).toBe(2);expect(t.manifest[0].equipment_key).toBe(key);expect(t.corrections).toHaveLength(1);
 await expectOriginalUnchanged();
});

test('Service reviews the corrected manifest and can discard an older unsent receipt without accepting equipment',async({page})=>{
 f=await mountCorrectionFixture(page);
 const switchDesk=async actor=>page.evaluate(async who=>{
  fixtureDispose?.();changeActor(who);const root=document.getElementById('correction-test-root');root.className='';
  if(TechCheckContext.getRole()==='service'){
   const {mountTransferDesk}=await import('/tech-checks/transfers/desk.js');fixtureDispose=mountTransferDesk(root,TechCheckContext,{role:'service'});
  }else{
   const {mountCorrectionDesk}=await import('/tech-checks/transfers/corrections.js');fixtureDispose=mountCorrectionDesk(root,TechCheckContext);
  }
 },actor);
 await switchDesk(SERVICE);
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await page.getByLabel('Unit family / name 1',{exact:true}).fill('Solar Spotter');
 await page.getByLabel('Unit number 1',{exact:true}).fill('101');
 await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill('1');
 await expect.poll(()=>page.evaluate(async({actor,id})=>{
  const {deviceDraft}=await import('/tech-checks/transfers/client.js');return (await deviceDraft(actor+':receipt:'+id))?.items?.[0]?.unit_tag;
 },{actor:SERVICE,id:f.transferId})).toBe('101');
 await switchDesk(OWNER);await openCorrection(page);await fillCorrection(page);
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await expect(savedStatus(page)).toBeVisible();
 await switchDesk(SERVICE);
 await expect(page.getByRole('heading',{name:'Solar Spotter 102',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Handoff changed',exact:true})).toBeVisible();
 await expect(page.locator('#correction-test-root')).toContainText('Solar Spotter 102');
 await expect(page.getByRole('button',{name:'Sign & verify received equipment',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Discard stale draft and review latest handoff',exact:true}).click();
 await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Verify equipment received',exact:true})).toBeVisible();
 await expect(page.locator('fieldset').first()).toContainText('Solar Spotter 102');
 await expect(page.getByLabel('Unit family / name 1',{exact:true})).toHaveValue('');
 await expect(page.getByLabel('Unit number 1',{exact:true})).toHaveValue('');
 await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveValue('');
 await expect(page.getByRole('button',{name:'Sign & verify received equipment',exact:true})).toBeVisible();
 const serviceContext=await f.rpc(SERVICE,'techcheck_transfer_context_v1');
 expect(serviceContext.transfers.find(row=>row.id===f.transferId)).toMatchObject({revision:2,state:'awaiting_service',manifest:[{equipment_key:CORRECTED_KEY,unit_tag:'102'}]});
 expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v1')).toHaveLength(0);
 expect((await f.db.query('select count(*)::int n from service_truck_units')).rows[0].n).toBe(0);
 await expectOriginalUnchanged();expect(f.errors).toEqual([]);expect(f.unexpected).toEqual([]);
});

for(const width of [390,1440])test(`actual Owner route opens corrections and preserves a draft through legacy redraw and same-account auth at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});f=await mountCorrectionFixture(page,{entry:'owner'});
 await expect(page.locator('#cosOperationsFrame')).toBeVisible();
 await expect(page.locator('#cosOwnerHandoffCorrections')).toHaveCount(0);
 await page.frameLocator('#cosOperationsFrame').getByRole('button',{name:/^Check handoffs & returns/}).click();
 await expect(page.locator('#view-owner')).toHaveAttribute('data-owner-route','handoffs');
 const host=page.locator('#cosOwnerHandoffCorrections');
 await expect(host.getByRole('heading',{name:'Handoff corrections',exact:true})).toBeVisible();
 await openCorrection(page);await fillCorrection(page);
 await host.evaluate(node=>node.dataset.testMounted='retained');
 await page.evaluate(()=>{refreshData();confirmSameActor();});
 await expect(host).toHaveAttribute('data-test-mounted','retained');
 await expect(page.getByLabel('Reason for correction',{exact:true})).toHaveValue('The technician confirmed the actual unit and provided a matching tag photograph.');
 await expect(page.getByLabel('Corrected unit',{exact:true})).toHaveValue(CORRECTED_KEY);
 await expect(page.getByRole('checkbox',{name:citedLabel,exact:true})).toBeChecked();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`owner-actual-route-draft-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await expect(savedStatus(page)).toBeVisible();
 await page.reload();await expect(host).toContainText('Correction revision 2');
 expect((await savedTransfer()).state).toBe('awaiting_service');await expectOriginalUnchanged();
 await page.evaluate(()=>logout());await expect(host).toHaveCount(0);
 expect(f.errors).toEqual([]);expect(f.unexpected).toEqual([]);
});

for(const width of [390,1440])test(`actual IT daily host reaches corrections and protects its draft at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});f=await mountCorrectionFixture(page,{actor:IT,entry:'it'});
 const host=page.locator('#cosITDailyHost');await expect(host).toBeVisible();
 if(width<768){
  await expect(host.getByRole('heading',{name:'Check equipment. Hand it over.',exact:true})).toBeVisible();
  await host.getByRole('button',{name:'Correct this handoff',exact:true}).click();
 }else{
  await expect(page.locator('#cosITDailyFrame')).toBeAttached();
  await host.getByRole('button',{name:'Handoff corrections',exact:true}).click();
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 }
 await openCorrection(page,{self:true});await fillCorrection(page,{self:true});
 await page.getByLabel('Reason for correction',{exact:true}).evaluate(node=>node.dataset.testMounted='retained');
 const priorAccessChecks=await page.evaluate(()=>fixture.capabilityChecks);
 await page.evaluate(()=>{confirmSameActor();dispatchEvent(new Event('techcheck:data-refreshed'));});
 await expect.poll(()=>page.evaluate(()=>fixture.capabilityChecks)).toBeGreaterThan(priorAccessChecks);
 await expect(page.getByLabel('Reason for correction',{exact:true})).toHaveAttribute('data-test-mounted','retained');
 await expect(page.getByRole('checkbox',{name:selfLabel,exact:true})).toBeChecked();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>{window.syntheticViewportEvents=[];addEventListener('resize',()=>syntheticViewportEvents.push({width:innerWidth,height:innerHeight,phone:matchMedia('(max-width: 900px)').matches}));});
 await page.screenshot({path:info.outputPath(`it-actual-route-draft-${width}.png`),fullPage:true});
 await info.attach('synthetic-screenshot-viewport-events',{contentType:'application/json',body:Buffer.from(JSON.stringify(await page.evaluate(()=>syntheticViewportEvents)))});
 await expect(page.getByRole('button',{name:'Save correction',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save correction',exact:true}).click();await expect(savedStatus(page)).toBeVisible();
 expect((await savedTransfer(IT)).corrections[0].applied_by.id).toBe(IT);await expectOriginalUnchanged();
 await page.evaluate(()=>changeActor('00000000-0000-4000-8000-000000000103'));
 await expect(host).toHaveCount(0);await expect(page.getByRole('heading',{name:'Handoff corrections',exact:true})).toHaveCount(0);
 expect(f.errors).toEqual([]);expect(f.unexpected).toEqual([]);
});

test('an Owner preview persona cannot mount correction controls on the actual Owner route',async({page})=>{
 f=await mountCorrectionFixture(page,{entry:'owner'});
 await page.evaluate(()=>document.body.classList.add('owner-test-role-preview'));
 await page.frameLocator('#cosOperationsFrame').getByRole('button',{name:/^Check handoffs & returns/}).click();
 await expect(page.locator('#view-owner')).toHaveAttribute('data-owner-route','handoffs');
 await expect(page.locator('#cosOwnerHandoffCorrections')).toHaveCount(0);
 expect(writes()).toHaveLength(0);expect((await savedTransfer()).revision).toBe(1);
});
