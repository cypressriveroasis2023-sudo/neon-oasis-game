import {test,expect} from '../../operations/node_modules/@playwright/test/index.mjs';
import {mountTransfers,OWNER} from '../../operations/tests/helpers/transfer-fixture.mjs';
let f;
test.afterEach(async({page})=>{await page.close();await f?.close();f=null;});
test('Owner desk clicks preserve the form while legacy navigation still works',async({page})=>{
 const solar={equipment_key:'solar_spotter:039',family:'Solar Spotter',unit_tag:'039',sims:[],parts:[],battery_count:4};
 f=await mountTransfers(page,{role:'service',seedHandoff:true,legacyHandoff:true,seedItems:[solar],legacyReceiptCounts:[0,0,0,4]});
 const originals=(await f.db.query('select * from app_private.techcheck_transfer_events order by signed_at,id')).rows;
 const outbox=(await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n;
 await page.evaluate(async owner=>{
  fixture.actor=owner;fixture.role='owner';fixture.reroutes=0;show('owner');
  const view=document.getElementById('view-owner');view.dataset.ownerRoute='handoffs';
  view.innerHTML='<div id="ownerApp"><nav><button data-owner-route="today">Today</button></nav><main id="ownerRouteView"><header class="ownerAppPageHeader">Owner handoffs</header><p>Legacy ticket preparation</p></main></div>';
  // Reproduce bindOwnerAppRouter's bubbling selector against the containing
  // view as well as explicit navigation buttons. Desk clicks must never reach it.
  document.getElementById('ownerApp').addEventListener('click',event=>{
   const button=event.target.closest('[data-owner-route]');if(!button)return;
   event.preventDefault();event.stopPropagation();fixture.reroutes++;
   view.dataset.ownerRoute=button.dataset.ownerRoute;
   document.getElementById('ownerRouteView').innerHTML='<h1>Today</h1>';
  });
  await import('/tech-checks/owner-transfer-host.js');
 },OWNER);
 await page.getByRole('button',{name:'Complete as Owner',exact:true}).click();
 await expect(page.getByRole('form',{name:'Owner handoff completion'})).toBeVisible();
 await expect(page.getByLabel('Signed Service receipt').locator('option')).toHaveCount(4);
 await page.getByLabel('Owner resolution reason').fill('Truck replenishment — batteries tracked separately in daily truck inventory.');
 await page.getByRole('button',{name:'Complete handoff as Owner',exact:true}).click();
 expect(f.calls.filter(c=>c.name==='owner_resolve_techcheck_transfer_v1')).toHaveLength(0);
 await page.getByRole('button',{name:'View saved equipment photo',exact:true}).click();
 await expect(page.getByRole('link',{name:'Open saved equipment photo'})).toBeVisible();
 await page.getByLabel('I reviewed the saved equipment photo and confirm the exact unit identity',{exact:true}).check();
 await page.getByRole('button',{name:'Complete handoff as Owner',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Owner completion saved');
 expect(await page.evaluate(()=>fixture.reroutes)).toBe(0);
 const row=(await f.db.query('select * from app_private.techcheck_transfers')).rows[0];
 expect(row.state).toBe('accepted');expect(row.revision).toBe(6);expect(row.purpose).toBe('truck_replenishment');expect(row.manifest[0].battery_count).toBeNull();
 const events=(await f.db.query('select * from app_private.techcheck_transfer_events order by signed_at,id')).rows;
 expect(events.filter(e=>e.kind!=='owner_resolution')).toEqual(originals);
 expect(events.filter(e=>e.kind==='owner_resolution')).toHaveLength(1);expect(events.at(-1).actor_id).toBe(OWNER);
 expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n).toBe(outbox);
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await expect(page.locator('#ownerEquipmentTransfers')).toHaveCount(0);
 expect(await page.evaluate(()=>fixture.reroutes)).toBe(1);expect(f.errors).toEqual([]);
});
