import {test,expect} from '@playwright/test';
import {mountTransfers,SERVICE} from './helpers/transfer-fixture.mjs';
test('guided checkout searches identities and preserves recipient across steps',async({page},testInfo)=>{
 const fixture=await mountTransfers(page,{guided:true});
 try{
  await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();
  await expect(page.locator('[data-transfer-progress]')).toContainText('Choose equipment and recipient');
  await expect(page.getByRole('button',{name:'Sign & send handoff'})).toBeHidden();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('What is this equipment for?');
  await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('truck_replenishment');
  await page.getByLabel('Receiving Service technician',{exact:true}).selectOption(SERVICE);
  await page.getByLabel('Search saved equipment',{exact:true}).fill('sniper:001');
  await expect(page.locator('select[aria-label="Select equipment"] option[value="ranger:002"]')).toHaveAttribute('hidden','');
  await page.getByLabel('Select equipment',{exact:true}).selectOption('sniper:001');
  await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('[data-transfer-progress]')).toContainText('Check Sniper 001');
  await expect(page.getByLabel('Receiving Service technician',{exact:true})).toBeHidden();
  await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Previous step',exact:true}).click();
  await expect(page.getByLabel('Receiving Service technician',{exact:true})).toHaveValue(SERVICE);
  await page.screenshot({path:testInfo.outputPath('cos-guided-transfer.png'),fullPage:true});
  expect(fixture.calls.filter(call=>/^submit_/.test(call.name||''))).toHaveLength(0);
  expect(fixture.unexpected).toEqual([]);expect(fixture.errors).toEqual([]);
 }finally{await fixture.close();}
});
test('guided receipt reviews exact SIM and remains awaiting receipt until signed',async({page},testInfo)=>{
 const fixture=await mountTransfers(page,{guided:true,role:'service',seedHandoff:true,handoffPurpose:'truck_replenishment'});
 try{
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('[data-transfer-progress]')).toContainText('Check Sniper 001');
  await page.getByLabel('I received this equipment as listed',{exact:true}).check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('[data-transfer-progress]')).toContainText('Review and sign');
  await expect(page.getByRole('region',{name:'Review transfer'})).toContainText('00123456789012345670');
  await expect(page.getByRole('button',{name:'Sign & confirm received',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('cos-guided-transfer.png'),fullPage:true});
  expect(fixture.calls.filter(call=>/^submit_/.test(call.name||''))).toHaveLength(0);
  await page.getByRole('radio',{name:'Type signature',exact:true}).check();
  await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill('Synthetic Service');
  await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();
  await page.locator('form[aria-label="Equipment transfer form"]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await expect(page.getByText('Received by Service',{exact:true})).toBeVisible();
  const receipts=(await fixture.db.query("select snapshot from app_private.techcheck_transfer_events where kind='receipt'")).rows;
  expect(receipts).toHaveLength(1);expect(receipts[0].snapshot.signature.signed_by).toBe(SERVICE);
  expect(fixture.unexpected).toEqual([]);expect(fixture.errors).toEqual([]);
 }finally{await fixture.close();}
});
