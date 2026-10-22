import {test,expect} from '@playwright/test';
import {mountTransfers} from './helpers/transfer-fixture.mjs';

const photo={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
let f;
test.afterEach(async()=>{await f?.close();f=null;});
async function sign(page){
  await page.getByRole('radio',{name:'Type signature',exact:true}).check();
  await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill('Synthetic Service');
  await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();
}
async function fillReceipt(page,{family='Sniper',batteries='1'}={}){
  await page.getByLabel('Unit family / name 1',{exact:true}).fill(family);
  await page.getByLabel('Unit number 1',{exact:true}).fill('001');
  await page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true}).fill('00123456789012345670');
  await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill(batteries);
  await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('SD card | 1');
  await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);
  await expect(page.locator('.tc-evidence img')).toBeVisible();
}

for(const width of [390,1440]){
  test('saved discrepancy stops repeat receiving and shows what needs review at '+width+'px',async({page},info)=>{
    await page.setViewportSize({width,height:900});
    f=await mountTransfers(page,{role:'service',seedHandoff:true});
    await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
    await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveValue('');
    await fillReceipt(page);
    await expect(page.getByRole('region',{name:'Receipt comparison'})).toContainText('IT sent 2; receipt records 1');
    await sign(page);
    await page.locator('form[aria-label="Equipment transfer form"]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
    await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Do not submit this handoff again.');
    await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Reload handoffs',exact:true}).click();
    await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('IT sent 2; receipt records 1');
    await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
    expect((await f.db.query("select count(*)::int n from app_private.techcheck_transfer_events where kind='receipt'")).rows[0].n).toBe(1);
    expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n).toBe(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);
    await page.screenshot({path:info.outputPath('receipt-saved-'+width+'.png'),fullPage:true});
  });
}

test('lost response for discrepancy survives reload and verifies only the same saved request',async({page})=>{
  f=await mountTransfers(page,{role:'service',seedHandoff:true});
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await fillReceipt(page);await sign(page);
  await page.evaluate(()=>fixture.loseResponse=true);
  await page.getByRole('button',{name:'Sign & verify received equipment',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry same submission',exact:true})).toBeVisible();
  const id=f.calls.find(call=>call.name==='submit_techcheck_transfer_v2').args.p_request_id;
  await page.reload();
  await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Verify saved submission',exact:true}).click();
  await page.getByRole('button',{name:'Retry same submission',exact:true}).click();
  await expect(page.getByRole('region',{name:'Saved Service receipt'})).toContainText('Receipt saved — needs review');
  await expect(page.getByRole('button',{name:'Verify saved submission',exact:true})).toHaveCount(0);
  expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2').map(call=>call.args.p_request_id)).toEqual([id,id]);
  expect((await f.db.query("select count(*)::int n from app_private.techcheck_transfer_events where kind='receipt'")).rows[0].n).toBe(1);
  expect((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_outbox')).rows[0].n).toBe(2);
  expect(f.errors).toEqual([]);
});

test('unsent stale receipt is explicitly discarded before reviewing the changed handoff',async({page})=>{
  f=await mountTransfers(page,{role:'service',seedHandoff:true});
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await fillReceipt(page);await sign(page);
  await page.evaluate(()=>fixture.online=false);
  await page.getByRole('button',{name:'Sign & verify received equipment',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Offline');
  await f.db.exec('update app_private.techcheck_transfers set revision=revision+1');
  await page.reload();
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Handoff changed',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Discard stale draft and review latest handoff',exact:true}).click();
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await expect(page.getByLabel('Unit number 1',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true})).toHaveValue('');
  expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2')).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('receipt comparison omits a case-only family difference but retains exact tag and quantity differences',async({page})=>{
  f=await mountTransfers(page,{role:'service',seedHandoff:true});
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await fillReceipt(page,{family:'sniper',batteries:'2'});
  const comparison=page.getByRole('region',{name:'Receipt comparison'});
  await expect(comparison).toContainText('Your entries match IT’s handoff.');
  await page.getByLabel('Unit number 1',{exact:true}).fill('1');
  await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill('0');
  await expect(comparison).toContainText('Unit number: IT sent 001; receipt records 1.');
  await expect(comparison).toContainText('Batteries / battery boxes: IT sent 2; receipt records 0.');
  await expect(comparison).not.toContainText('Unit family:');
  expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2')).toHaveLength(0);
});

test('frozen but unsaved receipt requires explicit stale-draft recovery after the handoff changes',async({page})=>{
  f=await mountTransfers(page,{role:'service',seedHandoff:true});
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await fillReceipt(page);await sign(page);
  await page.evaluate(()=>fixture.uploadFail=true);await page.getByRole('button',{name:'Sign & verify received equipment',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry same submission',exact:true})).toBeVisible();
  await f.db.exec('update app_private.techcheck_transfers set revision=revision+1');
  await page.evaluate(()=>fixture.uploadFail=false);await page.getByRole('button',{name:'Retry same submission',exact:true}).click();
  await expect(page.getByRole('button',{name:'Verify equipment received',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();await expect(page.getByRole('heading',{name:'Handoff changed',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Discard stale draft and review latest handoff',exact:true}).click();await page.getByRole('button',{name:'Verify equipment received',exact:true}).click();
  await expect(page.getByLabel('Unit number 1',{exact:true})).toHaveValue('');
  await expect(page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true})).not.toBeChecked();
  expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2')).toHaveLength(0);expect(f.errors).toEqual([]);
});
