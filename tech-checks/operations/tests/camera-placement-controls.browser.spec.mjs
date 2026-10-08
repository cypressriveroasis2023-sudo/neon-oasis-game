// Full-page synthetic fixtures. Every external request is blocked or fulfilled locally.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const origin = 'http://127.0.0.1:4173';
const mock = ({
  role = 'owner',
  org = 'ROOT',
  active = 'active',
  key = 'RANGER 022',
  placement = 'SHOP'
} = {}) => `window.calls=[];window.state={unitKey:${JSON.stringify(key)},placement:${JSON.stringify(placement)},siteLabel:'',streetAddress:'',auditId:null,canMove:true};window.fixture={id:11,unit_key:${JSON.stringify(key)},device_name:'Synthetic camera',device_type:'camera',monitoring_profile:'ranger',organization:${JSON.stringify(org)},source_status:'offline',source:'vigilant_control_center',source_last_seen_at:new Date().toISOString(),activation_state:${JSON.stringify(active)}};window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-owner'}}}})},functions:{invoke:async()=>({data:{}})},rpc:async(name,args)=>{calls.push({name,args});if(name==='owner_camera_unit_placement_state_v2'){if(window.holdRead)await new Promise(resolve=>window.releaseRead=resolve);return {data:{...state}};}if(name==='owner_set_camera_unit_placement_v2'){if(window.holdWrite)await new Promise(resolve=>window.releaseWrite=resolve);if(window.failWrite)return {error:{message:'Synthetic denied'}};state={...state,placement:args.p_placement,siteLabel:args.p_site_label,streetAddress:args.p_street_address,auditId:'synthetic-audit'};fixture.organization=state.placement==='SHOP'?'root':state.siteLabel;fixture.activation_state='active';fixture.activation_source='owner_location_override_v2';return {data:{ok:true,unit_key:args.p_unit_key,placement:args.p_placement,request_id:args.p_request_id,audit_id:state.auditId}};}return {error:{message:'Unexpected RPC'}};},from(table){const q={select(){return q},eq(){return q},ilike(){return q},order(){return q},limit(){return q},single(){return q},maybeSingle(){return q},then(done){return Promise.resolve({data:table==='profiles'?{active:true,role:${JSON.stringify(role)}}:table==='camera_devices'?window.fixture:table==='camera_health_current'?{}:[]}).then(done)}};return q;}})};`;
async function mount(page, opts) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({
    content: mock(opts)
  });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort('blockedbyclient');
    const path = resolve(repo, '.' + decodeURIComponent(u.pathname));
    if (path.startsWith(repo + '/') && existsSync(path)) return route.fulfill({
      path,
      contentType: {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpeg'
      }[extname(path)] || 'application/octet-stream'
    });
    return route.abort();
  });
  await page.goto(origin + '/tech-checks/camera-detail.html?id=11');
  await expect(page.locator('#content')).toBeVisible();
  expect(errors).toEqual([]);
  return errors;
}
const cases = [['full detail owner moves ROOT to FIELD with required address and same-unit link', async page => {
  await mount(page);
  await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');
  await expect(page.locator('#fieldMapLink')).toHaveAttribute('href', './?fieldUnit=RANGER%20022');
  await page.locator('#moveShopBtn').click();
  await expect(page.locator('.cos-placement-dialog')).toBeVisible();
  await page.getByLabel('Current job / site').fill('Synthetic Field');
  await page.getByLabel('Reason for move').fill('Synthetic placement test');
  await page.getByLabel('I confirm').check();
  await page.getByRole('button', {
    name: 'Save placement'
  }).click();
  expect(await page.evaluate(() => calls.filter(c => c.name === 'owner_set_camera_unit_placement_v2').length)).toBe(0);
  await page.getByLabel('Current installation address (street, city, state and ZIP)').fill('100 Synthetic Road');
  await page.getByRole('button', {
    name: 'Save placement'
  }).click();
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  await expect(page.locator('#moveShopBtn')).toHaveText('Move unit to Shop / ROOT');
  expect(await page.evaluate(() => calls.filter(c => c.name === 'owner_set_camera_unit_placement_v2').length)).toBe(1);
}], ['offline field can move to SHOP without health mutation', async page => {
  await mount(page, {
    org: 'Synthetic field',
    placement: 'FIELD'
  });
  await page.locator('#moveShopBtn').click();
  await expect(page.getByLabel('Current job / site')).not.toBeVisible();
  await page.getByLabel('Reason for move').fill('Return from job');
  await page.getByLabel('I confirm').check();
  await page.getByRole('button', {
    name: 'Save placement'
  }).click();
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');
  expect(await page.evaluate(() => fixture.source_status)).toBe('offline');
}], ['IT has no physical move button', async page => {
  await mount(page, {
    role: 'it'
  });
  await expect(page.locator('#moveShopBtn')).not.toBeVisible();
}], ['Cancel late read and repeat opens only current modal', async page => {
  await mount(page);
  await page.evaluate(() => holdRead = true);
  await page.locator('#moveShopBtn').click();
  await expect(page.locator('.cos-placement-dialog')).toBeVisible();
  await page.getByRole('button', {
    name: 'Cancel',
    exact: true
  }).click();
  await page.evaluate(() => {
    holdRead = false;
    releaseRead();
  });
  await page.locator('#moveShopBtn').click();
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => calls.filter(c => c.name === 'owner_set_camera_unit_placement_v2').length)).toBe(0);
}], ['Save blocks repeats/cancel then completes', async page => {
  await mount(page, {
    org: 'field',
    placement: 'FIELD'
  });
  await page.evaluate(() => holdWrite = true);
  await page.locator('#moveShopBtn').click();
  await page.getByLabel('Reason for move').fill('Return');
  await page.getByLabel('I confirm').check();
  await page.getByRole('button', {
    name: 'Save placement'
  }).click();
  await expect(page.getByRole('button', {
    name: 'Cancel',
    exact: true
  })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cos-placement-dialog')).toBeVisible();
  await page.evaluate(() => document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit', {
    cancelable: true
  })));
  expect(await page.evaluate(() => calls.filter(c => c.name === 'owner_set_camera_unit_placement_v2').length)).toBe(1);
  await page.evaluate(() => releaseWrite());
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
}], ['Rejected save does not falsely report success or repeat', async page => {
  await mount(page, {
    org: 'field',
    placement: 'FIELD'
  });
  await page.evaluate(() => failWrite = true);
  await page.locator('#moveShopBtn').click();
  await page.getByLabel('Reason for move').fill('Return');
  await page.getByLabel('I confirm').check();
  await page.getByRole('button', {
    name: 'Save placement'
  }).click();
  await expect(page.locator('.placement-feedback')).toContainText('Synthetic denied');
  await expect(page.getByRole('button', {
    name: 'Save placement'
  })).toBeDisabled();
  await page.getByRole('button', {
    name: 'Cancel',
    exact: true
  }).click();
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
}], ['An open site editor closes after audited placement is saved', async page => {
  await mount(page, {
    org: 'Synthetic field',
    placement: 'FIELD'
  });
  await page.locator('#editSiteBtn').click();
  await expect(page.locator('#siteEditWrap')).toBeVisible();
  await page.locator('#moveShopBtn').click();
  await page.getByLabel('Reason for move').fill('Return from job');
  await page.getByLabel('I confirm').check();
  await page.getByRole('button', {
    name: 'Save placement'
  }).click();
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  await expect(page.locator('#editSiteBtn')).not.toBeVisible();
  await expect(page.locator('#siteEditWrap')).not.toBeVisible();
}], ['SHOP organization receives Move to Field on standalone detail', async page => {
  await mount(page, {
    org: 'SHOP',
    placement: 'SHOP'
  });
  await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');
}], ['Stored inactive Sniper returns to Field only after confirmation', async page => {
  await mount(page, {key: 'SNIPER 312', org: 'Previous synthetic job', active: 'deactivated', placement: 'UNKNOWN'});
  await expect(page.locator('#shopActionTitle')).toHaveText('Unit is stored / inactive');
  await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');
  expect(await page.evaluate(() => fixture.activation_state)).toBe('deactivated');
  await page.locator('#moveShopBtn').click();
  await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Move to Field');
  expect(await page.evaluate(() => calls.filter(c => c.name === 'owner_set_camera_unit_placement_v2').length)).toBe(0);
  await page.getByLabel('Current job / site').fill('Current synthetic job');
  await page.getByLabel('Current installation address (street, city, state and ZIP)').fill('100 Synthetic Road');
  await page.getByLabel('Reason for move').fill('Owner confirmed physical deployment');
  await page.getByLabel('I confirm').check();
  await page.getByRole('button', {name: 'Save placement'}).click();
  await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => fixture.activation_state)).toBe('active');
  expect(await page.evaluate(() => fixture.source_status)).toBe('offline');
  expect(await page.evaluate(() => calls.find(c => c.name === 'owner_set_camera_unit_placement_v2').args.p_placement)).toBe('FIELD');
}], ['Retired deactivated field is not labeled Shop inventory', async page => {
  await mount(page, {
    org: 'RETIRED',
    active: 'deactivated',
    placement: 'UNKNOWN'
  });
  await expect(page.locator('#shopActionTitle')).not.toContainText('Unit is at Shop');
  await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');
}]];
for (const width of [390, 1440]) for (const [name, run] of cases) test('Standalone placement ' + width + ': ' + name, async ({
  page
}) => {
  await page.setViewportSize({
    width,
    height: 900
  });
  await run(page);
});

for (const [label, savedAddress] of [['empty', ''], ['current', '100 Synthetic Road, Test City, TX 77001']]) {
  test('Placement address uses neutral hint and preserves '+label+' state value', async ({page}) => {
    await mount(page);
    await page.evaluate(value => { state.streetAddress=value; }, savedAddress);
    await page.locator('#moveShopBtn').click();
    const address=page.getByLabel('Current installation address (street, city, state and ZIP)');
    await expect(address).toHaveValue(savedAddress);
    await expect(address).toHaveAttribute('placeholder','Street address, city, state and ZIP code');
    expect(await page.evaluate(() => calls.filter(c=>c.name==='owner_set_camera_unit_placement_v2').length)).toBe(0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    expect(await page.evaluate(() => state.streetAddress)).toBe(savedAddress);
  });
}
