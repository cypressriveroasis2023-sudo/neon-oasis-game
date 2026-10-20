import {test,expect} from '@playwright/test';
import {mountServiceBasics} from './helpers/service-basics-fixture.mjs';
async function setup(page){
 await mountServiceBasics(page);
 await page.evaluate(()=>{
  const db=TechCheckContext.db,original=db.rpc;
  window.returnFixture={calls:[],returns:[],receipts:{},loseOnce:false,failRead:false,hold:false,truck:[
   {family:'Ranger',unit_tag:'002',equipment_key:'ranger:002',status:'assigned'},
   {family:'Sniper',unit_tag:'001',equipment_key:null,status:'assigned'},
   {family:'Solar Spotter',unit_tag:'005',equipment_key:'solar_spotter:005',status:'assigned'},
   {family:'Spotter',unit_tag:'003',equipment_key:null,status:'assigned'}]};
  db.rpc=async(name,args={})=>{
   const f=returnFixture;if(name==='cos_verified_fleet_capabilities_v1')return {data:{fleetRead:false}};
   if(!name.includes('ticketfree'))return original(name,args);f.calls.push({name,args:structuredClone(args)});
   if(name==='techcheck_ticketfree_context_v1'){
    if(f.hold)await new Promise(resolve=>f.release=resolve);if(f.failRead)return {error:{code:'P0001',message:'Saved return queue unavailable.'}};
    return {data:{version:1,actor_id:fixture.actor,role:fixture.role,pending_count:f.returns.filter(r=>r.state==='waiting_it').length,truck:structuredClone(f.truck),
     equipment:[...Array.from({length:140},(_,n)=>({family:'Recon',unit_tag:String(n).padStart(3,'0'),name:'Recon '+String(n).padStart(3,'0'),equipment_key:'recon:'+n})),
      {family:'Sniper',unit_tag:'176',name:'Sniper 176',equipment_key:'sniper:176'},
      {family:'Spotter',unit_tag:'257HDC2',name:'Spotter 257HDC2',equipment_key:'spotter:257HDC2'},
      {family:'Ranger',unit_tag:'002',name:'Ranger 002',equipment_key:'ranger:002'},
      {family:'Solar Spotter',unit_tag:'005',name:'Solar Spotter 005',equipment_key:'solar_spotter:005'}],returns:structuredClone(f.returns)}};
   }
   if(name==='submit_techcheck_ticketfree_return_batch_v1'){
    for(const i of args.p_items)if(!f.receipts[i.request_id]){
     const key=i.returned_key,truck=f.truck.find(t=>key?t.equipment_key===key:t.family===i.unlinked_family&&t.unit_tag===i.unlinked_tag);
     const family=truck?.family||i.unlinked_family||(key.startsWith('sniper:')?'Sniper':'Spotter'),tag=truck?.unit_tag||i.unlinked_tag||key.split(':')[1];
     f.returns.push({id:i.request_id,service_tech_name:'Synthetic Service',family,unit_tag:tag,returned_key:key,identity_state:key?'matched':'needs_review',used_key:i.used_key,used_family:'Ranger',used_tag:'002',source_mode:i.used_key?'swap':truck?'truck_return':'field_return',notes:i.notes,photos:i.photos,state:'waiting_it',revision:1,submitted_at:new Date().toISOString()});
     f.receipts[i.request_id]={request_id:i.request_id,return_id:i.request_id,state:'waiting_it',revision:1};
     if(truck)truck.status='used_restock_due';if(i.used_key){const u=f.truck.find(t=>t.equipment_key===i.used_key);if(u)u.status='used_restock_due';}
    }
    if(f.loseOnce){f.loseOnce=false;return {error:{message:'Connection lost after saving'}};}
    return {data:{version:1,results:args.p_items.map(i=>f.receipts[i.request_id])}};
   }
   if(name.startsWith('receive_techcheck_ticketfree_')){
    const r=f.returns.find(r=>r.id===args.p_return_id);r.state=args.p_disposition==='review'?'identity_review':args.p_disposition==='ready'?'checked_in':'repair';r.revision=2;r.received_at=new Date().toISOString();r.it_tech_name='Synthetic IT';r.intake_notes=args.p_notes;
    return {data:{request_id:args.p_request_id,return_id:r.id,state:r.state,revision:2}};
   }
   throw new Error('Unexpected ticket-free call '+name);
  };
 });
 await expect(page.locator('[data-cos-ticketfree-returns]')).toHaveCount(1);
}
async function open(page){await page.getByRole('button',{name:'Equipment swaps & returns',exact:true}).click();await expect(page.getByRole('heading',{name:'What are you doing?'})).toBeVisible();}
async function chooseUsed(page,name='Ranger 002',index=0){await page.getByRole('button',{name:/^I installed from my truck:/}).nth(index).click();await page.getByRole('button',{name:'Select '+name,exact:true}).click();}
async function chooseReturn(page,name='Spotter 257HDC2',index=0){await page.getByRole('button',{name:/^I am bringing back:/}).nth(index).click();await page.getByRole('searchbox',{name:'Search equipment'}).fill(name);await page.getByRole('button',{name:'Select '+name,exact:true}).click();}
async function swap(page){await open(page);await page.getByRole('button',{name:'Swap equipment',exact:true}).click();await chooseUsed(page);await chooseReturn(page);}
async function pickup(page){await open(page);await page.getByRole('button',{name:'Pick up equipment',exact:true}).click();await chooseReturn(page);}
async function asIT(page){await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(async()=>{setIdentity('it');show('it');await import('/tech-checks/it-daily-host.js');});await page.getByRole('button',{name:/Returned by Service.*Check In/}).click();}
const checks=['Physical condition','Accessories and mounting','Batteries','SD cards','Camera / electronics','Power functions'];
async function intake(page,disposition='ready'){for(const label of checks)await page.getByRole('combobox',{name:label,exact:true}).selectOption('true');await page.getByRole('checkbox',{name:'I have physically received and verified this unit.'}).check();await page.getByRole('combobox',{name:'Inventory destination'}).selectOption(disposition);}
const writes=()=>returnFixture.calls.filter(c=>c.name==='submit_techcheck_ticketfree_return_batch_v1');

test('approved Service home has two big choices and a quiet unused return, with no inventory grid or filters',async({page},info)=>{
 await setup(page);await open(page);
 for(const name of ['Swap equipment','Pick up equipment']){const b=page.getByRole('button',{name,exact:true});await expect(b).toBeVisible();expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(150);}
 await expect(page.getByRole('button',{name:'Return unused equipment',exact:true})).toBeVisible();
 await expect(page.getByRole('searchbox')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByRole('group',{name:'Equipment family'})).toHaveCount(0);
 expect(await page.evaluate(writes)).toHaveLength(0);await page.screenshot({path:info.outputPath('approved-service-home.png'),fullPage:true});
});

test('approved swap form pairs two large selections and IT receives one clear receipt card',async({page},info)=>{
 await setup(page);await swap(page);
 await expect(page.getByRole('heading',{name:'Record a swap'})).toBeVisible();await expect(page.getByText('Ranger 002 leaves truck stock',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Notes',{exact:true})).not.toBeVisible();expect(await page.evaluate(writes)).toHaveLength(0);
 await page.screenshot({path:info.outputPath('approved-swap-form.png'),fullPage:true});
 await page.getByRole('button',{name:'Save swap',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 expect(await page.evaluate(()=>returnFixture.returns[0].used_key)).toBe('ranger:002');expect(await page.evaluate(()=>returnFixture.truck.find(t=>t.equipment_key==='ranger:002').status)).toBe('used_restock_due');
 await asIT(page);await expect(page.getByRole('heading',{name:'Equipment coming back'})).toBeVisible();await expect(page.getByText('Return from swap',{exact:true})).toBeVisible();await expect(page.getByText('Installed: Ranger 002',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Receive & inspect',exact:true})).toHaveCount(1);await page.screenshot({path:info.outputPath('approved-it-return-card.png'),fullPage:true});
 await page.getByRole('button',{name:'Receive & inspect',exact:true}).click();await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('physically received');
 await intake(page);await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Checked in — Ready inventory');
});

test('pickup uses one unit selection and never consumes truck stock',async({page})=>{
 await setup(page);await pickup(page);await expect(page.getByRole('button',{name:/^I installed from my truck:/})).toHaveCount(0);
 await page.getByRole('button',{name:'Save pickup',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 expect(await page.evaluate(()=>returnFixture.truck.every(t=>t.status==='assigned'))).toBe(true);expect(await page.evaluate(()=>returnFixture.returns[0].source_mode)).toBe('field_return');
 await asIT(page);await expect(page.getByText('Pickup from site',{exact:true})).toBeVisible();
});

test('unused return keeps all four truck entries returnable, including unmatched IDs',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Return unused equipment',exact:true}).click();
 for(const name of ['Ranger 002','Sniper 001','Solar Spotter 005','Spotter 003'])await expect(page.getByRole('checkbox',{name:'Return '+name,exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Select all truck equipment'}).click();await page.getByRole('button',{name:'Save return',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('4 unit(s) sent');
 const calls=await page.evaluate(writes);expect(calls).toHaveLength(1);expect(calls[0].args.p_items).toHaveLength(4);expect(calls[0].args).not.toHaveProperty('p_ticket_no');
 await asIT(page);await expect(page.getByRole('button',{name:'Receive & inspect',exact:true})).toHaveCount(4);
});

test('unit chooser searches all families beyond row 100 and preserves exact suffix identities',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Pick up equipment',exact:true}).click();await page.getByRole('button',{name:/^I am bringing back:/}).click();
 await expect(page.getByText('1–12 of 142',{exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'Search equipment'}).fill('257HDC2');await expect(page.getByRole('button',{name:'Select Spotter 257HDC2',exact:true})).toBeVisible();
 await page.getByRole('searchbox').fill('Sniper 176');await page.getByRole('button',{name:'Select Sniper 176',exact:true}).click();await expect(page.getByRole('button',{name:'I am bringing back: Sniper 176',exact:true})).toBeVisible();
});

test('saving a swap without its installed unit is explicit and performs no write',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Swap equipment',exact:true}).click();await chooseReturn(page);
 await page.getByRole('button',{name:'Save swap',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Select the equipment used from your truck');expect(await page.evaluate(writes)).toHaveLength(0);
 await chooseUsed(page);await page.getByRole('button',{name:'Save swap',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
});

test('installed choice is own truck only, holds unknown IDs, and removes used stock after save',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Swap equipment',exact:true}).click();await page.getByRole('button',{name:/^I installed from my truck:/}).click();
 await expect(page.getByRole('button',{name:'Select Sniper 001',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Select Sniper 176',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Select Ranger 002',exact:true}).click();await chooseReturn(page);await page.getByRole('button',{name:'Save swap',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 await page.getByRole('button',{name:'Swap equipment',exact:true}).click();await page.getByRole('button',{name:/^I installed from my truck:/}).click();await expect(page.getByRole('button',{name:'Select Ranger 002',exact:true})).toHaveCount(0);
});

test('multiple pickups remain one atomic batch with individual IT receipts',async({page})=>{
 await setup(page);await pickup(page);await page.getByText('Notes, photos & more',{exact:true}).click();await page.getByRole('button',{name:'Add another unit',exact:true}).click();await page.getByRole('searchbox').fill('Sniper 176');await page.getByRole('button',{name:'Select Sniper 176',exact:true}).click();
 await page.getByRole('button',{name:'Save pickup',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('2 unit(s) sent');expect(await page.evaluate(writes)).toHaveLength(1);expect(await page.evaluate(()=>returnFixture.truck.every(t=>t.status==='assigned'))).toBe(true);
});

test('multiple swaps pair different truck units and never reuse one replacement',async({page})=>{
 await setup(page);await swap(page);await page.getByText('Notes, photos & more',{exact:true}).click();await page.getByRole('button',{name:'Add another swap',exact:true}).click();await page.getByRole('searchbox').fill('Sniper 176');await page.getByRole('button',{name:'Select Sniper 176',exact:true}).click();
 await page.getByRole('button',{name:/^I installed from my truck:/}).nth(1).click();await expect(page.getByRole('button',{name:'Select Ranger 002',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Select Solar Spotter 005',exact:true}).click();
 await page.getByRole('button',{name:'Save swap',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('2 unit(s) sent');expect(await page.evaluate(()=>returnFixture.returns.map(r=>r.used_key))).toEqual(['ranger:002','solar_spotter:005']);
});

test('unmatched truck equipment goes to IT identity review and never silently becomes Ready',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Return unused equipment',exact:true}).click();await page.getByRole('checkbox',{name:'Return Sniper 001',exact:true}).check();await page.getByRole('button',{name:'Save return',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 await asIT(page);await page.getByRole('button',{name:'Receive & inspect',exact:true}).click();await expect(page.getByRole('combobox',{name:'Inventory destination'}).locator('option')).toHaveCount(1);await intake(page,'review');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Received — Unit ID review');
});

test('failed inspection remains repair-held and requires an explanation',async({page})=>{
 await setup(page);await pickup(page);await page.getByRole('button',{name:'Save pickup',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');await asIT(page);await page.getByRole('button',{name:'Receive & inspect',exact:true}).click();await intake(page);
 await page.getByRole('combobox',{name:'Power functions',exact:true}).selectOption('false');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('must go to repair');await page.getByRole('combobox',{name:'Inventory destination'}).selectOption('repair');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Describe');await page.getByLabel('Notes',{exact:true}).fill('Power failure');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Needs repair');
});

test('lost save response retains original IDs and retries from the simple screen once',async({page})=>{
 await setup(page);await swap(page);await page.evaluate(()=>returnFixture.loseOnce=true);await page.getByRole('button',{name:'Save swap',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('same request is retained');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Equipment swaps & returns',exact:true}).click();await expect(page.getByRole('heading',{name:'Verify saved return'})).toBeVisible();await page.getByRole('button',{name:'Retry saved returns',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 const calls=await page.evaluate(writes);expect(calls).toHaveLength(2);expect(calls[0].args).toEqual(calls[1].args);expect(await page.evaluate(()=>returnFixture.returns.length)).toBe(1);
});

test('logout ignores late account reads and closes private selections',async({page})=>{
 await setup(page);await page.evaluate(()=>returnFixture.hold=true);await page.getByRole('button',{name:'Equipment swaps & returns',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Loading');await page.evaluate(()=>{logout();returnFixture.release();});await expect(page.locator('dialog')).toHaveCount(0);
});

test('errors stay explicit and the approved choices and swap form fit 320px',async({page},info)=>{
 await page.setViewportSize({width:320,height:740});await setup(page);await page.evaluate(()=>returnFixture.failRead=true);await page.getByRole('button',{name:'Equipment swaps & returns',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('unavailable');await page.evaluate(()=>returnFixture.failRead=false);await page.getByRole('dialog').getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('heading',{name:'What are you doing?'})).toBeVisible();await page.getByRole('button',{name:'Swap equipment',exact:true}).click();await chooseUsed(page);await chooseReturn(page);
 const m=await page.getByRole('dialog').evaluate(d=>({width:d.getBoundingClientRect().width,viewport:innerWidth,scroll:d.scrollWidth,client:d.clientWidth}));expect(m.width).toBeLessThanOrEqual(m.viewport);expect(m.scroll).toBeLessThanOrEqual(m.client+1);await page.screenshot({path:info.outputPath('approved-swap-320.png'),fullPage:true});
});

test('an existing mixed return draft survives the simpler layout without changing its IDs or pairings',async({page})=>{
 await setup(page);await page.evaluate(async()=>{
  const {deviceDraft}=await import('/tech-checks/transfers/client.js');
  await deviceDraft('ticketfree:submit:'+fixture.actor,{kind:'submit',id:crypto.randomUUID(),tab:'site',notes:'Retained before redesign',photos:[],request:null,items:[
   {id:'11111111-1111-4111-8111-111111111111',source:'site',equipment_key:'sniper:176',family:'Sniper',unit_tag:'176',usedKey:'ranger:002',reason:'swap'},
   {id:'22222222-2222-4222-8222-222222222222',source:'site',equipment_key:'spotter:257HDC2',family:'Spotter',unit_tag:'257HDC2',usedKey:'',reason:'pickup'}]});
 });
 await page.getByRole('button',{name:'Equipment swaps & returns',exact:true}).click();await expect(page.getByRole('heading',{name:'Review returns'})).toBeVisible();expect(await page.evaluate(writes)).toHaveLength(0);
 await page.getByRole('button',{name:'Save return',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('2 unit(s) sent');
 const calls=await page.evaluate(writes);expect(calls[0].args.p_items.map(i=>i.request_id)).toEqual(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);expect(calls[0].args.p_items.map(i=>i.used_key)).toEqual(['ranger:002',null]);expect(calls[0].args.p_items.every(i=>i.notes==='Retained before redesign')).toBe(true);
});
