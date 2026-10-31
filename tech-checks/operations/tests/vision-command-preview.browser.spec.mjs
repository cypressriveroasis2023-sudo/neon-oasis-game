import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

async function labelScreenshot(app){
 await app.locator('body').evaluate(body=>{const label=document.createElement('div');label.textContent='DESIGN REVIEW · SYNTHETIC TEST DATA · NOT LIVE OPERATIONS';label.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99999;text-align:center;padding:5px;background:#093451;color:white;font:11px Arial;pointer-events:none';body.append(label);});
}
test('Owner preview uses saved Product IDs, survives navigation and clears stale briefing on failure',async({page},info)=>{
 const fixture=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{field:fixture.field,health:fixture.health,productConnections:fixture.connections});
 const focus=app.getByRole('region',{name:'Owner fleet focus'});
 const brief=app.getByRole('dialog',{name:'Your fleet, at a glance.'});
 await expect(focus).toBeVisible();
 await labelScreenshot(app);
 await app.locator('.cos-fleet-heading').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('vision-fleet-synthetic.png')});
 for(let i=0;i<2;i++){
  await focus.getByRole('button',{name:'Owner briefing ↗'}).click();
  await expect(brief).toBeVisible();
  await expect(brief.locator('dd')).toHaveText(['7','1','8']);
  await expect(brief).toContainText('not individual camera-channel or video acceptance counts');
  await expect(brief).toContainText('Reported work remains separate from confirmed approval.');
  if(i===0){await page.screenshot({path:info.outputPath('vision-briefing-synthetic.png')});await page.keyboard.press('Escape');}
  else await brief.getByRole('button',{name:'Back to fleet'}).click();
  await expect(brief).not.toBeVisible();
  await expect(focus.getByRole('button',{name:'Owner briefing ↗'})).toBeFocused();
  await focus.getByRole('button',{name:/Trace a status to its source/}).click();
  await expect(app.getByRole('heading',{name:'Fleet command center'})).toBeVisible();
  await app.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:'Map',exact:true}).click();
 }
 await app.locator('body').evaluate(()=>history.pushState(history.state,'',location.href));
 await focus.getByRole('button',{name:'Owner briefing ↗'}).click();
 await app.locator('body').evaluate(()=>history.back());
 await expect(brief).not.toBeVisible();
 await app.getByLabel('Search units, customers, sites or addresses').fill('no-such-unit');
 await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(0);
 await app.getByRole('button',{name:'Clear fleet search',exact:true}).click();
 state.fail=true;
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('—');
 await focus.getByRole('button',{name:'Owner briefing ↗'}).click();
 await expect(brief).toContainText('Current health is unavailable.');
 await expect(brief.locator('dd')).toHaveText(['7','1','8']);
 await brief.getByRole('button',{name:'Close owner briefing'}).click();
 state.fail=false;
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(app.locator('.cos-fleet-stat-online strong')).not.toHaveText('—');
 await focus.getByRole('button',{name:'Owner briefing ↗'}).click();
 await app.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect(app.getByRole('dialog')).toHaveCount(0);
 await expect(focus).toHaveCount(0);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

test('unavailable census stays unavailable; unit evidence closes and IT has no Owner briefing',async({page},info)=>{
 const {app,state}=await mountFleet(page);
 await app.getByRole('button',{name:'Owner briefing ↗'}).click();
 const briefing=app.getByRole('dialog',{name:'Your fleet, at a glance.'});
 await expect(briefing.locator('dd')).toHaveText(['Unavailable','Unavailable','Unavailable']);
 await briefing.getByRole('button',{name:'Close owner briefing'}).click();
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
 const details=app.getByRole('dialog',{name:'Helios 1 unit intelligence'});
 await expect(details).toBeVisible();
 await labelScreenshot(app);
 await page.screenshot({path:info.outputPath('vision-evidence-synthetic.png')});
 await page.keyboard.press('Escape');
 await expect(details).toHaveCount(0);
 const size=await app.locator('.cos-vision-preview').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
 expect(size.scroll).toBeLessThanOrEqual(size.client+2);
 expect(state.errors).toEqual([]);
 const it=await mountFleet(page,true);
 await expect(it.app.getByRole('button',{name:'Owner briefing ↗'})).toHaveCount(0);
 await expect(it.app.getByRole('region',{name:'Owner fleet focus'})).toHaveCount(0);
});
