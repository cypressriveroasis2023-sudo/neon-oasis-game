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
     f.returns.push({id:i.request_id,service_tech_name:'Synthetic Service',family,unit_tag:tag,returned_key:key,identity_state:key?'matched':'needs_review',used_key:i.used_key,used_family:'Ranger',used_tag:'002',notes:i.notes,photos:i.photos,state:'waiting_it',revision:1,submitted_at:new Date().toISOString()});
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
async function open(page){await page.getByRole('button',{name:'Return to IT',exact:true}).click();await expect(page.getByRole('heading',{name:'Return from my truck'})).toBeVisible();}
async function selectSite(page){await open(page);await page.getByRole('button',{name:'Removed from site',exact:true}).click();await page.getByRole('searchbox',{name:'Search returned equipment'}).fill('Spotter 257HDC2');await page.getByRole('checkbox',{name:'Return Spotter 257HDC2',exact:true}).check();}
async function asIT(page){await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(async()=>{setIdentity('it');show('it');await import('/tech-checks/it-daily-host.js');});await page.getByRole('button',{name:/Returned by Service.*Check In/}).click();}
const checks=['Physical condition','Accessories and mounting','Batteries','SD cards','Camera / electronics','Power functions'];
async function intake(page,disposition='ready'){for(const label of checks)await page.getByRole('combobox',{name:label,exact:true}).selectOption('true');await page.getByRole('checkbox',{name:'I have physically received and verified this unit.'}).check();await page.getByRole('combobox',{name:'Inventory destination'}).selectOption(disposition);}

test('all four screenshot truck cards are selectable, including the two without catalogue IDs',async({page},info)=>{
 await setup(page);await open(page);
 for(const name of ['Ranger 002','Sniper 001','Solar Spotter 005','Spotter 003'])await expect(page.getByRole('checkbox',{name:'Return '+name,exact:true})).toBeEnabled();
 await expect(page.getByRole('dialog').locator('select')).toHaveCount(0);
 await page.getByRole('button',{name:'Select all truck equipment'}).click();await expect(page.getByRole('heading',{name:'Sending to IT (4)'})).toBeVisible();
 await page.screenshot({path:info.outputPath('multi-select-truck.png'),fullPage:true});
 await page.getByRole('button',{name:'Send 4 units to IT'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('4 unit(s) sent to IT');
 const calls=await page.evaluate(()=>returnFixture.calls.filter(c=>c.name==='submit_techcheck_ticketfree_return_batch_v1'));
 expect(calls).toHaveLength(1);expect(calls[0].args.p_items).toHaveLength(4);expect(calls[0].args).not.toHaveProperty('p_ticket_no');
 await asIT(page);await expect(page.getByRole('heading',{name:'Waiting for IT (4)'})).toBeVisible();await expect(page.getByRole('button',{name:'Check in this equipment'})).toHaveCount(4);
});
test('complete catalogue is paginated, supports every family and searches past row 100 without a dropdown',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Removed from site',exact:true}).click();
 await expect(page.getByText('Showing 1–24 of 144 units',{exact:true})).toBeVisible();
 for(let n=0;n<5;n++)await page.getByRole('button',{name:'Next units'}).click();
 await expect(page.getByRole('checkbox',{name:'Return Sniper 176',exact:true})).toBeVisible();
 await page.getByRole('group',{name:'Equipment family'}).getByRole('button',{name:'Spotter',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Return Spotter 257HDC2',exact:true})).toBeVisible();
 await page.getByRole('group',{name:'Equipment family'}).getByRole('button',{name:'All families',exact:true}).click();
 await page.getByRole('searchbox').fill('Sniper 176');await page.getByRole('checkbox',{name:'Return Sniper 176',exact:true}).check();
 await page.getByRole('searchbox').fill('257HDC2');await page.getByRole('checkbox',{name:'Return Spotter 257HDC2',exact:true}).check();
 await expect(page.getByRole('heading',{name:'Sending to IT (2)'})).toBeVisible();await expect(page.getByRole('dialog').locator('select')).toHaveCount(0);
});
test('a field swap records the selected installed replacement and IT separately checks in the removed unit',async({page})=>{
 await setup(page);await selectSite(page);await page.locator('summary').getByText('Record replacement installed (optional)').click();
 await page.getByRole('radio',{name:'Install Ranger 002 for Spotter 257HDC2',exact:true}).check();
 await page.getByRole('button',{name:'Send 1 unit to IT'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 expect(await page.evaluate(()=>returnFixture.returns[0].used_key)).toBe('ranger:002');await asIT(page);await page.getByRole('button',{name:'Check in this equipment'}).click();
 await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('physically received');
 await intake(page);await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Checked in — Ready inventory');
});
test('an unmatched truck item is received for ID review, never silently created as Ready stock',async({page})=>{
 await setup(page);await open(page);await page.getByRole('checkbox',{name:'Return Sniper 001',exact:true}).check();await page.getByRole('button',{name:'Send 1 unit to IT'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');
 await asIT(page);await page.getByRole('button',{name:'Check in this equipment'}).click();
 await expect(page.getByRole('combobox',{name:'Inventory destination'}).locator('option')).toHaveCount(1);
 await intake(page,'review');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Received — Unit ID review');
});
test('failed condition checks require a repair destination and a note',async({page})=>{
 await setup(page);await selectSite(page);await page.getByRole('button',{name:'Send 1 unit to IT'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('1 unit(s) sent');await asIT(page);await page.getByRole('button',{name:'Check in this equipment'}).click();await intake(page);
 await page.getByRole('combobox',{name:'Power functions',exact:true}).selectOption('false');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('must go to repair');
 await page.getByRole('combobox',{name:'Inventory destination'}).selectOption('repair');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Describe');await page.getByLabel('Notes',{exact:true}).fill('Power failure.');await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Needs repair');
});
test('a lost batch response keeps the same selection and IDs across close and reopen',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Select all truck equipment'}).click();await page.evaluate(()=>returnFixture.loseOnce=true);await page.getByRole('button',{name:'Send 4 units to IT'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('same request is retained');
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await open(page);await page.getByRole('button',{name:'Retry saved returns'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('4 unit(s) sent');
 const calls=await page.evaluate(()=>returnFixture.calls.filter(c=>c.name==='submit_techcheck_ticketfree_return_batch_v1'));expect(calls).toHaveLength(2);expect(calls[0].args).toEqual(calls[1].args);expect(await page.evaluate(()=>returnFixture.returns.length)).toBe(4);
});
test('logout closes the queue and late reads do not leak a prior account selection',async({page})=>{
 await setup(page);await page.evaluate(()=>returnFixture.hold=true);await page.getByRole('button',{name:'Return to IT',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Loading');await page.evaluate(()=>{logout();returnFixture.release();});await expect(page.locator('dialog')).toHaveCount(0);
});
test('queue errors remain explicit and selection cards fit a 320px phone',async({page},info)=>{
 await page.setViewportSize({width:320,height:740});await setup(page);await page.evaluate(()=>returnFixture.failRead=true);await page.getByRole('button',{name:'Return to IT',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('unavailable');await page.evaluate(()=>returnFixture.failRead=false);await page.getByRole('dialog').getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Return Sniper 001',exact:true})).toBeEnabled();
 const m=await page.getByRole('dialog').evaluate(d=>({width:d.getBoundingClientRect().width,viewport:innerWidth,scroll:d.scrollWidth,client:d.clientWidth}));expect(m.width).toBeLessThanOrEqual(m.viewport);expect(m.scroll).toBeLessThanOrEqual(m.client+1);await page.screenshot({path:info.outputPath('truck-return-320.png'),fullPage:true});
});
