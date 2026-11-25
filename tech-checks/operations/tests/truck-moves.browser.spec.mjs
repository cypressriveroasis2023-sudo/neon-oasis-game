import {test, expect} from '@playwright/test';
import {mountServiceBasics} from './helpers/service-basics-fixture.mjs';

// My truck on the phone: big buttons, one question per screen. A small fake server in the
// page follows the same rules as public.truck_*_v1, so every screen and every write is real.
const photo = {name: 'unit.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiqKKK8A/WwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=', 'base64')};

async function setup(page, {coming = [], fromIt = [], extras = {}} = {}) {
  await mountServiceBasics(page);
  await page.evaluate(({coming, fromIt, extras}) => {
    const f = window.truck = {calls: [], coming, fromIt, sent: [], recent: [], fail: null,
      units: {Sniper: '332', Ranger: '008', Spotter: '268', 'Solar Spotter': ''}, extras, required: {Sniper: 1, Ranger: 1, Spotter: 1, 'Solar Spotter': 1}};
    const shape = () => ({me: {id: fixture.actor, name: 'Josh Mireles'},
      kinds: Object.keys(f.units).map(type => ({type, required: f.required[type], have: (f.units[type] ? 1 : 0) + (f.extras[type] || []).length,
        slot: f.units[type] ? {tag: f.units[type]} : null, slot_used: false, extras: (f.extras[type] || []).map(tag => ({id: type + tag, tag}))})),
      coming: f.coming, sent: f.sent, recent: f.recent, from_it: f.fromIt, techs: [{id: 'abel-id', name: 'Abel Cervantes'}]});
    const db = TechCheckContext.db, original = db.rpc;
    db.rpc = async (name, args) => {
      if (!name.startsWith('truck_')) return original(name, args);
      f.calls.push({name, args: structuredClone(args)});
      if (f.fail) { const message = f.fail; f.fail = null; return {error: {message}}; }
      if (name === 'truck_give_v1') {
        f.sent.push({id: args.p_move, to: 'Abel Cervantes', to_id: args.p_to, from_id: fixture.actor, type: args.p_type, tag: args.p_tag, state: 'waiting'});
      } else if (name === 'truck_cancel_give_v1') {
        f.sent = f.sent.filter(m => m.id !== args.p_move);
      } else if (name === 'truck_take_v1') {
        const m = f.coming.find(x => x.id === args.p_move); f.coming = f.coming.filter(x => x !== m);
        if (args.p_accept) { if (f.units[m.type]) (f.extras[m.type] ||= []).push(m.tag); else f.units[m.type] = m.tag; }
        f.recent.unshift({...m, state: args.p_accept ? 'accepted' : 'refused', take_note: args.p_note, decided_at: new Date().toISOString()});
      } else if (name === 'truck_put_from_it_v1') {
        f.fromIt = f.fromIt.filter(x => !(x.type === args.p_type && x.tag === args.p_tag));
        if (f.units[args.p_type]) (f.extras[args.p_type] ||= []).push(args.p_tag); else f.units[args.p_type] = args.p_tag;
      }
      return {data: shape()};
    };
    db.storage.from = () => ({upload: async path => { (f.uploads ||= []).push(path); return {}; }, createSignedUrl: async () => ({data: {signedUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw='}})});
    window.dispatchEvent(new CustomEvent('techcheck:data-refreshed'));
  }, {coming, fromIt, extras});
}
const open = async page => { await page.getByRole('button', {name: /My truck/}).click(); await expect(page.getByRole('heading', {name: 'My truck'})).toBeVisible(); };
const writes = page => page.evaluate(() => truck.calls.filter(c => c.name !== 'truck_my_v1'));
const addPhoto = async (page, label) => { await page.getByLabel(label).setInputFiles(photo); await expect(page.getByText(/1 photo taken/)).toBeVisible(); };

test('My truck shows each type as a big count against the standard; a short type is called out', async ({page}) => {
  await setup(page, {extras: {Ranger: ['007']}});
  await open(page);
  await expect(page.getByLabel('Ranger: has 2 of 1')).toBeVisible();
  await expect(page.getByLabel('Solar Spotter: has 0 of 1')).toContainText('Short 1');
  await expect(page.getByLabel('Ranger: has 2 of 1')).toContainText('007 extra');
  // every action button is big enough for a thumb
  for (const b of await page.locator('.tm-dialog .tm-big').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(56);
});

test('giving a unit is four steps: unit, tech, photo, send; it stays on my truck until the other tech signs', async ({page}) => {
  await setup(page);
  await open(page);
  await page.getByRole('button', {name: 'Give a unit to another tech'}).click();
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await page.getByRole('button', {name: 'Ranger 008'}).click();
  await expect(page.getByText('Step 2 of 4')).toBeVisible();
  await page.getByRole('button', {name: '‹ Back'}).click();
  await page.getByRole('button', {name: 'Ranger 008'}).click();
  await page.getByRole('button', {name: 'Abel Cervantes'}).click();
  await expect(page.getByRole('heading', {name: 'Take a photo of Ranger 008'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Next'})).toHaveCount(0);           // no photo, no next
  await addPhoto(page, 'Photo of the unit you are giving');
  await page.getByRole('button', {name: 'Next'}).click();
  await page.getByLabel('Note for Abel Cervantes').fill('In the back bin');
  await page.getByRole('button', {name: 'Send to Abel'}).click();
  await expect(page.locator('.tm-status')).toHaveText('Sent. Abel has to check Ranger 008 and sign.');
  const [give] = await writes(page);
  expect(give.name).toBe('truck_give_v1');
  expect(give.args).toMatchObject({p_to: 'abel-id', p_type: 'Ranger', p_tag: '008', p_note: 'In the back bin'});
  expect(give.args.p_photos).toHaveLength(1);
  expect(give.args.p_photos[0]).toMatch(new RegExp('^synthetic-service/' + give.args.p_move + '/[a-f0-9]{64}\\.jpg$'));
  await expect(page.getByText('Ranger 008 → Abel Cervantes. Still on your truck until Abel signs.')).toBeVisible();
  await page.getByRole('button', {name: 'Cancel Ranger 008'}).click();
  await expect(page.locator('.tm-status')).toHaveText('Cancelled. Ranger 008 stays on your truck.');
});

test('a server refusal is shown in red with its next step, and nothing is lost', async ({page}) => {
  await setup(page);
  await open(page);
  await page.getByRole('button', {name: 'Give a unit to another tech'}).click();
  await page.getByRole('button', {name: 'Sniper 332'}).click();
  await page.getByRole('button', {name: 'Abel Cervantes'}).click();
  await addPhoto(page, 'Photo of the unit you are giving');
  await page.getByRole('button', {name: 'Next'}).click();
  await page.evaluate(() => { truck.fail = 'Sniper 332 is already on its way to someone. NEXT STEP: Open "Sent, waiting" and cancel that one first.'; });
  await page.getByRole('button', {name: 'Send to Abel'}).click();
  await expect(page.getByRole('alert')).toContainText('NEXT STEP');
  await expect(page.getByRole('button', {name: 'Send to Abel'})).toBeEnabled();       // still on the same step; tap again
  await page.getByRole('button', {name: 'Send to Abel'}).click();
  await expect(page.locator('.tm-status')).toHaveText('Sent. Abel has to check Sniper 332 and sign.');
  const gives = (await writes(page)).filter(c => c.name === 'truck_give_v1');
  expect(gives[0].args.p_move).toBe(gives[1].args.p_move);                          // the retry is the same send
});

test('taking a unit: look, three checks, photo, note, sign; then it is on my truck', async ({page}) => {
  await setup(page, {coming: [{id: 'move-1', from: 'Abel Cervantes', from_id: 'abel-id', type: 'Ranger', tag: '007', state: 'waiting', note: 'For the site swap', photos: ['abel-id/move-1/a.jpg']}]});
  await expect(page.getByRole('button', {name: /My truck — 1 to sign for/})).toBeVisible();
  await open(page);
  await page.getByRole('button', {name: 'Check it and sign'}).click();
  await expect(page.getByText('Abel wrote: For the site swap')).toBeVisible();
  await page.getByRole('button', {name: 'I have it in front of me'}).click();
  await expect(page.getByRole('button', {name: 'Next'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Yes, it matches'}).click();
  await page.getByRole('button', {name: 'No damage'}).click();
  await page.getByRole('button', {name: 'Something missing'}).click();
  await page.getByRole('button', {name: 'Next'}).click();
  await expect(page.getByText('Show the problem in the photo.')).toBeVisible();
  await addPhoto(page, 'Photo of the unit you are taking');
  await page.getByRole('button', {name: 'Next'}).click();
  await expect(page.getByRole('heading', {name: 'Write what is wrong'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Next'})).toBeDisabled();
  await page.getByLabel('Note').fill('Mount bracket missing');
  await page.getByRole('button', {name: 'Next'}).click();
  const sign = page.getByRole('button', {name: 'Sign and put it on my truck'});
  await expect(sign).toBeDisabled();
  await page.getByLabel('Type signature').check();
  await page.getByLabel('Type your full name').fill('Josh Mireles');
  await page.getByLabel('I confirm this report is accurate').check();
  await sign.click();
  await expect(page.locator('.tm-status')).toHaveText('Ranger 007 is on your truck.');
  await expect(page.getByLabel('Ranger: has 2 of 1')).toContainText('007 extra');
  const take = (await writes(page)).find(c => c.name === 'truck_take_v1');
  expect(take.args).toMatchObject({p_move: 'move-1', p_accept: true, p_checks: {number_matches: 'pass', no_damage: 'pass', all_parts: 'problem'},
    p_signature: {method: 'typed', name: 'Josh Mireles'}, p_note: 'Mount bracket missing'});
  expect(take.args.p_photos).toHaveLength(1);
});

test('a wrong unit number cannot be taken; the tech sends a reason instead', async ({page}) => {
  await setup(page, {coming: [{id: 'move-2', from: 'Abel Cervantes', from_id: 'abel-id', type: 'Ranger', tag: '007', state: 'waiting', photos: []}]});
  await open(page);
  await page.getByRole('button', {name: 'Check it and sign'}).click();
  await page.getByRole('button', {name: 'I have it in front of me'}).click();
  await page.getByRole('button', {name: 'No, different number'}).click();
  await expect(page.getByText("The number doesn't match, so don't take it.")).toBeVisible();
  await expect(page.getByRole('button', {name: 'Next'})).toHaveCount(0);
  await page.getByRole('button', {name: "Don't take it"}).click();
  await page.getByLabel('Why you are not taking it').fill('It says 017, not 007');
  await page.getByRole('button', {name: "Send: I'm not taking it"}).click();
  await expect(page.locator('.tm-status')).toHaveText("Sent. Ranger 007 stays on Abel's truck.");
  const take = (await writes(page)).find(c => c.name === 'truck_take_v1');
  expect(take.args).toMatchObject({p_move: 'move-2', p_accept: false, p_note: 'It says 017, not 007'});
});

test('a unit IT handed over goes on the truck with one tap', async ({page}) => {
  await setup(page, {fromIt: [{type: 'Solar Spotter', tag: '039', from: 'Teddy Hopper'}]});
  await open(page);
  await page.getByRole('button', {name: 'Put Solar Spotter 039 on my truck'}).click();
  await expect(page.locator('.tm-status')).toHaveText('Solar Spotter 039 is on your truck.');
  await expect(page.getByLabel('Solar Spotter: has 1 of 1')).toBeVisible();
  expect((await writes(page))[0]).toMatchObject({name: 'truck_put_from_it_v1', args: {p_type: 'Solar Spotter', p_tag: '039'}});
});
