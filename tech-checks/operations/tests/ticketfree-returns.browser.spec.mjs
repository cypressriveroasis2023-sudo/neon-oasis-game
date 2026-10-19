import {test,expect} from '@playwright/test';
import {mountServiceBasics} from './helpers/service-basics-fixture.mjs';

async function setup(page){
 await mountServiceBasics(page);
 await page.evaluate(()=>{
  const db=TechCheckContext.db,original=db.rpc;
  window.returnFixture={calls:[],returns:[],receipts:{},loseOnce:false,failRead:false,hold:false};
  db.rpc=async(name,args={})=>{
   const f=returnFixture;
   if(name==='cos_verified_fleet_capabilities_v1')return {data:{fleetRead:false}};
   if(!name.includes('ticketfree'))return original(name,args);
   f.calls.push({name,args:structuredClone(args)});
   if(name==='techcheck_ticketfree_context_v1'){
    if(f.hold)await new Promise(resolve=>f.release=resolve);
    if(f.failRead)return {error:{code:'P0001',message:'Saved return queue unavailable.'}};
    return {data:{version:1,actor_id:fixture.actor,role:fixture.role,pending_count:f.returns.filter(r=>r.state==='waiting_it').length,
     truck:[{family:'Spotter',unit_tag:'224',equipment_key:'spotter:224',status:f.returns.length?'used_restock_due':'assigned'}],
     equipment:[{equipment_key:'spotter:224',family:'Spotter',unit_tag:'224',name:'Spotter 224'},{equipment_key:'spotter:257HDC2',family:'Spotter',unit_tag:'257HDC2',name:'Spotter 257HDC2'}],returns:structuredClone(f.returns)}};
   }
   if(name==='submit_techcheck_ticketfree_return_v1'){
    if(!f.receipts[args.p_request_id]){
     f.returns.push({id:args.p_request_id,service_tech_name:'Synthetic Service',family:'Spotter',unit_tag:'257HDC2',returned_key:args.p_returned_key,
      used_key:args.p_used_key,used_family:'Spotter',used_tag:'224',notes:args.p_notes,photos:args.p_photos,state:'waiting_it',revision:1,submitted_at:new Date().toISOString()});
     f.receipts[args.p_request_id]={request_id:args.p_request_id,return_id:args.p_request_id,state:'waiting_it',revision:1};
    }
    if(f.loseOnce){f.loseOnce=false;return {error:{message:'Connection lost after saving'}};}
    return {data:f.receipts[args.p_request_id]};
   }
   if(name==='receive_techcheck_ticketfree_return_v1'){
    const r=f.returns.find(r=>r.id===args.p_return_id);r.state=args.p_disposition==='ready'?'checked_in':'repair';r.revision=2;r.received_at=new Date().toISOString();r.it_tech_name='Synthetic IT';r.intake_notes=args.p_notes;
    return {data:{request_id:args.p_request_id,return_id:r.id,state:r.state,revision:2}};
   }
   throw new Error('Unexpected ticket-free call');
  };
 });
 await expect(page.locator('[data-cos-ticketfree-returns]')).toHaveCount(1);
}
async function fillReturn(page){
 await page.getByRole('button',{name:'Return to IT',exact:true}).click();
 await page.getByLabel('Replacement used from my truck').selectOption('spotter:224');
 await page.getByRole('searchbox',{name:'Search returned equipment'}).fill('257HDC2');
 await page.getByRole('listbox',{name:'Equipment being returned to IT'}).selectOption('spotter:257HDC2');
 await page.getByLabel('Notes',{exact:true}).fill('Removed from site; returning for inspection.');
}
async function it(page){
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(async()=>{setIdentity('it');show('it');await import('/tech-checks/it-daily-host.js');});
 await page.getByRole('button',{name:/Returned by Service.*Check In/}).click();
 await page.getByRole('button',{name:'Check in this equipment'}).click();
}
const labels=['Physical condition','Accessories and mounting','Batteries','SD cards','Camera / electronics','Power functions'];

test('Service home exposes the new ticket-free action through redraws without restoring legacy jobs',async({page})=>{
 await setup(page);const home=page.locator('#wlSvcHome');
 await expect(home.locator('button:visible')).toHaveCount(3);
 for(let n=0;n<3;n++){await page.evaluate(()=>renderServiceHome());await expect(home.locator('[data-cos-ticketfree-returns]')).toHaveCount(1);}
 await fillReturn(page);
 const dialog=page.locator('dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('input[required]')).toHaveCount(0);
 await expect(dialog.getByText('No MHelpDesk ticket is required.',{exact:false})).toBeVisible();
 await expect(page.locator('#wlSvcHome [data-wl-service-return]')).toBeHidden();
});

test('Service sends a swap once, and IT checks it into Ready inventory independently of Fleet access',async({page})=>{
 await setup(page);await fillReturn(page);await page.getByRole('button',{name:'Send to IT',exact:true}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('Waiting for IT. Saved in COS.');
 const submitted=await page.evaluate(()=>returnFixture.calls.filter(c=>c.name==='submit_techcheck_ticketfree_return_v1'));
 expect(submitted).toHaveLength(1);expect(submitted[0].args).not.toHaveProperty('p_ticket_no');expect(submitted[0].args.p_returned_key).toBe('spotter:257HDC2');
 await it(page);await expect(page.getByRole('heading',{name:'Check in Spotter 257HDC2'})).toBeVisible();
 await page.getByRole('button',{name:'Complete IT check-in'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('physically received');
 expect(await page.evaluate(()=>returnFixture.calls.filter(c=>c.name==='receive_techcheck_ticketfree_return_v1').length)).toBe(0);
 for(const label of labels)await page.getByRole('combobox',{name:label,exact:true}).selectOption('true');
 await page.getByRole('checkbox',{name:'I have physically received and verified this unit.'}).check();
 await page.getByRole('combobox',{name:'Inventory destination'}).selectOption('ready');
 await page.getByRole('button',{name:'Complete IT check-in'}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('Checked in — Ready inventory. Saved in COS.');
 await expect(page.getByRole('heading',{name:'Waiting for IT (0)'})).toBeVisible();
 expect(await page.evaluate(()=>returnFixture.returns[0].state)).toBe('checked_in');
});

test('a failed condition cannot enter Ready stock and instead requires repair notes',async({page})=>{
 await setup(page);await fillReturn(page);await page.getByRole('button',{name:'Send to IT',exact:true}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Saved in COS');await it(page);
 for(const label of labels)await page.getByRole('combobox',{name:label,exact:true}).selectOption('true');
 await page.getByRole('combobox',{name:'Power functions',exact:true}).selectOption('false');
 await page.getByRole('checkbox',{name:'I have physically received and verified this unit.'}).check();
 await page.getByRole('combobox',{name:'Inventory destination'}).selectOption('ready');await page.getByRole('button',{name:'Complete IT check-in'}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('must go to repair');
 await page.getByRole('combobox',{name:'Inventory destination'}).selectOption('repair');await page.getByRole('button',{name:'Complete IT check-in'}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('Describe the problem');
 await page.getByLabel('Notes',{exact:true}).fill('Power supply fails under load.');await page.getByRole('button',{name:'Complete IT check-in'}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('Checked in — Needs repair. Saved in COS.');
});

test('an interrupted save retains the immutable request across dialog closure',async({page})=>{
 await setup(page);await fillReturn(page);await page.evaluate(()=>returnFixture.loseOnce=true);await page.getByRole('button',{name:'Send to IT',exact:true}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('same request is retained');
 await expect(page.getByLabel('Replacement used from my truck')).toBeDisabled();
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Return to IT',exact:true}).click();
 await page.getByRole('button',{name:'Retry and verify saved return'}).click();await expect(page.locator('.cos-ticketfree-status')).toContainText('Saved in COS');
 const calls=await page.evaluate(()=>returnFixture.calls.filter(c=>c.name==='submit_techcheck_ticketfree_return_v1'));
 expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await page.evaluate(()=>returnFixture.returns.length)).toBe(1);
});

test('logout removes an open private queue and late reads cannot restore it',async({page})=>{
 await setup(page);await page.evaluate(()=>returnFixture.hold=true);await page.getByRole('button',{name:'Return to IT',exact:true}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('Loading');await page.evaluate(()=>{logout();returnFixture.release();});
 await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('[data-cos-ticketfree-returns]')).toHaveCount(0);
});

test('queue errors are visible, not reported as an empty fleet; narrow phones remain usable',async({page})=>{
 await page.setViewportSize({width:320,height:740});await setup(page);await page.evaluate(()=>returnFixture.failRead=true);await page.getByRole('button',{name:'Return to IT',exact:true}).click();
 await expect(page.locator('.cos-ticketfree-status')).toContainText('Saved return queue unavailable');await expect(page.getByRole('heading',{name:'Waiting for IT (0)'})).toHaveCount(0);
 await page.evaluate(()=>returnFixture.failRead=false);await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('button',{name:'Send to IT',exact:true})).toBeVisible();
 const metrics=await page.locator('dialog').evaluate(d=>({width:d.getBoundingClientRect().width,viewport:innerWidth,scroll:d.scrollWidth,client:d.clientWidth}));expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);expect(metrics.scroll).toBeLessThanOrEqual(metrics.client+1);
 await page.screenshot({path:'test-results-ticketfree/service-return-320.png',fullPage:true});
});
