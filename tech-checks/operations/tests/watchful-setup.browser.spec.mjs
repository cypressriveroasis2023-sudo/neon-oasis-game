import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {start} from './watchful-setup-e2e/server.mjs';

// The whole job on a phone, against the real rules: a Service tech checks a Spotter from start to
// "sent to the office", IT signs it off, then IT imports Watchful's last-event list.
let server;
const shots = process.env.WS_SHOTS || '';
if (shots) mkdirSync(shots, {recursive: true});
let n = 0;
const snap = async (page, name) => { if (shots) await page.screenshot({path: `${shots}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: false}); };
const photo = {name: 'photo.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQElEQVR42u3OMQ0AAAgDIN8/9K3hHFkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBnA5BAAAG5d4mMAAAAAElFTkSuQmCC', 'base64')};

test.beforeAll(async () => { server = await start(); });
test.afterAll(async () => { await server?.close(); });

test('a Service tech takes a Spotter from start to the office, IT signs it off', async ({page}) => {
  test.setTimeout(180000);
  await page.goto(server.url + '/?as=josh');
  await page.getByRole('button', {name: /Watchful setup check/}).click();
  const dlg = page.locator('dialog.ws-dialog');
  await expect(dlg.getByRole('heading', {name: 'Watchful setup check'})).toBeVisible();
  await snap(page, 'home');
  await dlg.getByRole('button', {name: /Start a check on a unit/}).click();
  await dlg.getByLabel('Unit number').fill('236');
  await dlg.getByRole('button', {name: /Spotter 236HD/}).click();
  await snap(page, 'type');
  await dlg.getByRole('button', {name: /Spotter \(NVR trailer\).*COS says/}).click();
  await dlg.getByLabel('Site name').fill('District West Phase 3');
  await dlg.getByRole('button', {name: 'Next'}).click();
  await dlg.getByRole('button', {name: /New install/}).click();
  await expect(dlg.getByText('COS has this recorder on file as')).toBeVisible();
  await snap(page, 'recorder');
  await dlg.getByRole('button', {name: /Yes, the label says ALI-NR040F-1/}).click();
  for (let i = 0; i < 4; i++) {
    await dlg.getByRole('button', {name: 'Pick the model'}).first().click();
    if (i === 0) await snap(page, 'camera-model');
    await dlg.getByRole('button', {name: 'ALI-FB21-A'}).click();
  }
  await snap(page, 'cameras');
  await dlg.getByRole('button', {name: /Next: check the list/}).click();
  await snap(page, 'confirm');
  await dlg.getByRole('button', {name: /Yes, build the checklist/}).click();
  await expect(dlg.getByRole('button', {name: /Do the next step/})).toBeVisible();
  await snap(page, 'checklist');

  // keep doing "the next thing" until the walk test comes up
  const walkTitle = dlg.getByRole('heading', {name: 'Walk test', exact: true});
  let shotItem = false, shotPhoto = false, shotHours = false;
  for (let guard = 0; guard < 200 && !(await walkTitle.isVisible()); guard++) {
    const next = dlg.getByRole('button', {name: /Do the next step/});
    const done = dlg.getByRole('button', {name: /✓ Done — it is set like this/});
    const take = dlg.locator('label.ws-photo', {hasText: 'Take the photo'});
    const option = dlg.locator('button.ws-pick').first();
    if (await take.isVisible()) { if (!shotPhoto) { await snap(page, 'photo-needed'); shotPhoto = true; } await take.locator('input').setInputFiles(photo); }
    else if (await done.isVisible()) { if (!shotItem) { await snap(page, 'step'); shotItem = true; } await done.click(); }
    else if (await option.isVisible()) { if (!shotHours) { await snap(page, 'step-choice'); shotHours = true; } await option.click(); }
    else if (await next.isVisible()) await next.click();
    await expect(dlg.locator('.ws-status')).not.toHaveText(/Saving|Uploading|Loading/, {timeout: 15000});
  }
  await expect(walkTitle).toBeVisible();
  await snap(page, 'walk-start');
  await dlg.locator('label.ws-photo', {hasText: 'Test mode is ON'}).locator('input').setInputFiles(photo);
  await expect(dlg.getByText(/Test mode on —/)).toBeVisible();
  for (let ch = 1; ch <= 4; ch++) {
    await dlg.getByRole('button', {name: `Test Spotter 236HD ch${ch}`}).click();
    if (ch === 1) {
      await snap(page, 'walk-camera');
      await dlg.getByRole('button', {name: /Nothing after 5 minutes/}).click();
      await expect(dlg.getByText(/Try again/)).toBeVisible();
    }
    await dlg.getByRole('button', {name: /Watchful got the event/}).click();
    if (ch === 1) await snap(page, 'event-time');
    await dlg.locator('label.ws-photo', {hasText: 'Screenshot the event'}).locator('input').setInputFiles(photo);
    await expect(dlg.getByText(`✓ Spotter 236HD ch${ch} passed.`)).toBeVisible();
  }
  await snap(page, 'walk-all-passed');
  await dlg.locator('label.ws-photo', {hasText: 'Test mode is OFF'}).locator('input').setInputFiles(photo);
  await expect(dlg.getByText(/Every step is done/)).toBeVisible();
  await snap(page, 'send');
  await dlg.getByRole('button', {name: 'Send to the office'}).click();
  await expect(dlg.getByText(/Sent to the office/)).toBeVisible();

  // IT does the office check
  await page.goto(server.url + '/?as=teddy');
  await expect(page.getByRole('button', {name: /Watchful setup check — 1 to sign off/})).toBeVisible({timeout: 15000});
  await page.getByRole('button', {name: /Watchful setup check/}).click();
  await dlg.getByRole('button', {name: 'Check it'}).click();
  await snap(page, 'office');
  await dlg.getByLabel('Cameras sending events').fill('3');
  await dlg.getByLabel('Cameras in Watchful').fill('4');
  await dlg.locator('label.ws-photo', {hasText: 'Screenshot of that card'}).locator('input').setInputFiles(photo);
  await dlg.getByRole('button', {name: /Sign off/}).click();
  await expect(dlg.locator('.ws-status')).toHaveText(/don't match/);
  await snap(page, 'office-mismatch');
  await dlg.getByLabel('Cameras sending events').fill('4');
  await dlg.getByRole('button', {name: /Sign off/}).click();
  await expect(dlg.getByText(/is signed off and live/)).toBeVisible();
  await snap(page, 'signed-off');
});

test('IT imports the Watchful list and matches a name; nothing reads "offline"', async ({page}) => {
  await page.goto(server.url + '/?as=teddy');
  await page.getByRole('button', {name: /Watchful setup check/}).click();
  const dlg = page.locator('dialog.ws-dialog');
  await dlg.getByRole('button', {name: /Quiet cameras/}).click();
  await dlg.getByRole('button', {name: /Import the Watchful last-event list/}).click();
  const day = d => { const t = new Date(Date.now() - d * 864e5); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + '/' + t.getUTCFullYear() + ' 10:00 AM'; };
  const csv = ['site,unit,camera,last event',
    `District West Phase 3,Spotter 236HD,Spotter 236HD ch1,${day(9)}`, `District West Phase 3,Spotter 236HD,Spotter 236HD ch2,${day(6.5)}`,
    `District West Phase 3,Spotter 236HD,Spotter 236HD ch3,${day(1)}`, `District West Phase 3,Spotter 236HD,Spotter 236HD - Cam 004,${day(1)}`].join('\n');
  await dlg.getByLabel('CSV file').setInputFiles({name: 'watchful.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)});
  await snap(page, 'import');
  await dlg.getByRole('button', {name: 'Import'}).click();
  await expect(dlg.getByText(/Imported 4 rows: 3 matched, 1 to match by hand/)).toBeVisible();
  await expect(dlg.getByRole('button', {name: /Quiet 1/})).toBeVisible();
  await snap(page, 'quiet');
  await dlg.getByRole('button', {name: /1 Watchful name to match/}).click();
  await dlg.getByRole('button', {name: 'Match it'}).click();
  await snap(page, 'match');
  await dlg.getByRole('button', {name: /Spotter 236HD ch4 — Spotter 236HD/}).click();
  await expect(dlg.getByRole('button', {name: /Watchful name/})).toHaveCount(0);
  await expect(dlg).not.toContainText(/offline|outage/i);
  await dlg.getByRole('button', {name: /I'm on it/}).first().click();
  await dlg.getByLabel(/For example/).fill('Josh heading out Monday');
  await dlg.getByRole('button', {name: 'Save'}).click();
  await expect(dlg.getByText(/Josh heading out Monday/)).toBeVisible();
  await snap(page, 'quiet-acked');
});

test('a Helios fills its cameras and speaker from COS; a model not on the list asks for the label', async ({page}) => {
  await page.goto(server.url + '/?as=josh');
  await page.getByRole('button', {name: /Watchful setup check/}).click();
  const dlg = page.locator('dialog.ws-dialog');
  await dlg.getByRole('button', {name: /Start a check on a unit/}).click();
  await dlg.getByLabel('Unit number').fill('helios 005');
  await dlg.getByRole('button', {name: /Helios 005/}).first().click();
  await dlg.getByRole('button', {name: /Helios.*COS says/}).click();
  await dlg.getByRole('button', {name: 'Next'}).click();
  await dlg.getByRole('button', {name: /New install/}).click();
  await expect(dlg.getByText('Model: ALI-PZ40-UZAI-D  ✓ from COS')).toBeVisible();
  await expect(dlg.getByText(/Model: model not read/)).toBeVisible();
  await snap(page, 'helios-cameras');
  await dlg.getByRole('button', {name: /Next: check the list/}).click();
  await dlg.getByRole('button', {name: /Yes, build the checklist/}).click();
  await expect(dlg.getByRole('button', {name: /Do the next step/})).toBeVisible();
  // a Solar Spotter whose camera model is not on the list
  await page.goto(server.url + '/?as=josh');
  await page.getByRole('button', {name: /Watchful setup check/}).click();
  await dlg.getByRole('button', {name: /Start a check on a unit/}).click();
  await dlg.getByLabel('Unit number').fill('029');
  await dlg.getByRole('button', {name: /SolarSpotter 029/}).click();
  await dlg.getByRole('button', {name: /Solar Spotter \(SS\).*COS says/}).click();
  await dlg.getByRole('button', {name: 'Next'}).click();
  await dlg.getByRole('button', {name: /New install/}).click();
  await dlg.getByRole('button', {name: /This unit has no recorder/}).click();
  await expect(dlg.getByText(/ALI-FB81-LUA-D \(not on the list, label photo needed\)/)).toBeVisible();
  await dlg.getByRole('button', {name: /Next: check the list/}).click();
  await expect(dlg.locator('.ws-status')).toHaveText(/take a photo of the model label/i);
  await snap(page, 'not-on-file');
});

test('before the database change is applied, no button shows at all', async ({page}) => {
  await page.goto(server.url + '/?as=josh&nobackend=1');
  await page.waitForFunction(() => window.harnessReady === true);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', {name: /Watchful setup check/})).toHaveCount(0);
});
