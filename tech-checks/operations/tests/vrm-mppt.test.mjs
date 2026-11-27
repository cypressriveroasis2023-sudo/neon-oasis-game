import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseMppt, parsePlacements, readVrmExtras, readVrmMppt, mpptFresh, mpptFlags, mpptLine, peerYield, solarDays} from '../src/vrmMppt.ts';
import {heliosPlacement, victronNeedsAttention, withMhelpPlacement} from '../src/victronAttention.ts';
import {heliosSpots} from '../src/vrmWeather.ts';
import {hadRoomYesterday} from '../src/vrmHistory.ts';
import {safeVrmMppt, safeVrmPlacement} from '../../supabase/functions/cos-vrm-mppt-read/read.ts';

const local = (day, hour, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const NOW = local(26, 11), S = Math.round(NOW / 1000);
const unit = (id, over = {}) => ({installationId: id, name: 'HELIOS 00' + (id % 10), observedAt: S - 120, yieldToday: 0.42, yieldYesterday: 0.88, peakToday: 350, peakYesterday: 361, panelVolts: 32.4, errorCode: 0, ...over});
// Every installation and reading here is synthetic.

test('server projection and app parser accept the same shape and refuse anything odd', () => {
  const body = {units: [unit(1), unit(2, {yieldToday: null, panelVolts: null})]};
  assert.deepEqual(safeVrmMppt(body, NOW).units.map(u => u.installationId), [1, 2]);
  const map = parseMppt(safeVrmMppt(body, NOW), NOW);
  assert.equal(map.get(1).yieldYesterday, 0.88); assert.equal(map.get(2).panelVolts, null);
  for (const bad of [{units: [unit(1), unit(1)]}, {units: [unit(1, {errorCode: 'x'})]}, {units: [unit(1, {panelVolts: 9999})]}, {units: [unit(1, {observedAt: S + 99999})]}, {units: 'no'}, null]) {
    assert.throws(() => safeVrmMppt(bad, NOW)); assert.equal(parseMppt(bad, NOW), null);
  }
  assert.throws(() => safeVrmMppt({units: [{...unit(1), name: 'Shop bench'}]}, NOW));
});

test('reading: one POST with the caller token; any failure means no panel line', async () => {
  let seen;
  // The reader checks timestamps against the real clock.
  const ok = async (url, init) => { seen = {url, init}; return Response.json({units: [unit(1, {observedAt: Math.round(Date.now() / 1000) - 120})]}); };
  const map = await readVrmMppt(ok, 'synthetic-token');
  assert.equal(map.size, 1);
  assert.equal(seen.url, 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-mppt-read');
  assert.equal(seen.init.headers.Authorization, 'Bearer synthetic-token'); assert.equal(seen.init.body, '{"action":"read"}');
  assert.equal(await readVrmMppt(async () => new Response('', {status: 403}), 't'), null);
  assert.equal(await readVrmMppt(async () => { throw new Error('offline'); }, 't'), null);
  assert.equal(await readVrmMppt(ok, null), null);
});

test('only a charger that is reporting now is shown; an unplugged unit shows nothing', () => {
  const m = parseMppt({units: [unit(1), unit(2, {observedAt: S - 86400})]}, NOW);
  assert.equal(mpptFresh(m.get(1), NOW), true); assert.equal(mpptFresh(m.get(2), NOW), false);
  assert.equal(mpptLine(m.get(1), NOW), '0.42 kWh today · 0.88 yesterday · peak 350 W · panels 32 V');
  assert.equal(mpptLine(m.get(2), NOW), null); assert.deepEqual(mpptFlags(m.get(2), NOW), []);
  assert.equal(mpptLine(undefined, NOW), null);
});

test('flags: charger error always; dead panels only in daylight; low yield only when the unit needed the sun', () => {
  const one = over => parseMppt({units: [unit(1, over)]}, NOW).get(1);
  assert.deepEqual(mpptFlags(one({}), NOW), []);
  assert.deepEqual(mpptFlags(one({errorCode: 33}), NOW), [{kind: 'charger', line: 'Solar charger error · panel voltage too high'}]);
  assert.deepEqual(mpptFlags(one({errorCode: 116}), NOW), [{kind: 'charger', line: 'Solar charger error · code 116'}]);
  assert.deepEqual(mpptFlags(one({panelVolts: 1.4}), NOW), [{kind: 'panel', line: 'Panels not producing · 1 V at the charger in daylight'}]);
  const night = local(26, 22), dark = parseMppt({units: [unit(1, {panelVolts: 0, observedAt: Math.round(night / 1000) - 60})]}, night).get(1);
  assert.deepEqual(mpptFlags(dark, night), []);
  const weak = one({yieldYesterday: 0.3});
  assert.deepEqual(mpptFlags(weak, NOW, {needed: true, peerYield: 0.9}), [{kind: 'panel', line: 'Panels made 0.3 kWh yesterday · the others made about 0.9 kWh'}]);
  assert.deepEqual(mpptFlags(weak, NOW, {needed: false, peerYield: 0.9}), []);          // stayed full: it simply needed little
  assert.deepEqual(mpptFlags(weak, NOW, {needed: true, peerYield: 0.2}), []);           // everyone was low: a gray day
  assert.deepEqual(mpptFlags(weak, NOW, {needed: true, peerYield: null}), []);
});

test('peer yield is the middle of the fresh Field units and needs four of them', () => {
  const m = parseMppt({units: [unit(1, {yieldYesterday: 0.8}), unit(2, {yieldYesterday: 0.9}), unit(3, {yieldYesterday: 1.0}), unit(4, {yieldYesterday: 0.1}), unit(5, {yieldYesterday: 5, observedAt: S - 86400})]}, NOW);
  assert.equal(peerYield(m, [1, 2, 3, 4, 5], NOW), 0.8500000000000001);
  assert.equal(peerYield(m, [1, 2, 3], NOW), null); assert.equal(peerYield(null, [1], NOW), null);
});

test('Needs attention: charger error ranks just under a Victron alarm; panel trouble is listed for Field units only', () => {
  const m = v => ({metric: 'battery_soc', value: v, unit: '%', source: 'system', instance: 0, observedAt: new Date(NOW - 60000).toISOString()});
  const units = [1, 2, 3].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/' + id + '/dashboard', embedUrl: null}));
  const rows = units.map(u => ({installationId: u.installationId, name: u.name, lastAttemptAt: null, errorCode: null, measurements: [m(90)]}));
  const inventory = [{unitNumber: 'HELIOS 001', placement: 'FIELD'}, {unitNumber: 'HELIOS 002', placement: 'FIELD'}, {unitNumber: 'HELIOS 003', placement: 'SHOP'}];
  const mppt = parseMppt({units: [unit(1, {panelVolts: 2}), unit(2, {errorCode: 18}), unit(3, {errorCode: 18, panelVolts: 0})]}, NOW);
  const list = victronNeedsAttention(units, rows, inventory, NOW, null, null, null, mppt);
  assert.deepEqual(list.map(i => [i.name, i.kind, i.line]), [
    ['HELIOS 002', 'charger', 'Solar charger error · charger over-current'],
    ['HELIOS 001', 'panel', 'Panels not producing · 2 V at the charger in daylight']]);
  assert.deepEqual(victronNeedsAttention(units, rows, inventory, NOW, null, null, null, null), []);
});

test('database read: one row per Helios, chargers added together, service role only', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema cos_vrm_private;
    create table cos_vrm_private.installations(installation_id bigint primary key, name text not null);
    create table cos_vrm_private.mppt_latest(installation_id bigint, instance integer, path text, value numeric, observed_at timestamptz, checked_at timestamptz default now(), primary key(installation_id, instance, path));
    insert into cos_vrm_private.installations values(7001,'HELIOS 001'),(7002,'Shop bench'),(7003,'HELIOS 003');
    insert into cos_vrm_private.mppt_latest(installation_id,instance,path,value,observed_at) values
      (7001,278,'/Pv/V',32.4,'2026-11-26T17:00:00Z'),(7001,278,'/History/Daily/0/Yield',0.42,'2026-11-26T16:00:00Z'),(7001,279,'/History/Daily/0/Yield',0.10,'2026-11-26T16:00:00Z'),
      (7001,278,'/History/Daily/1/Yield',0.88,'2026-11-26T06:00:00Z'),(7001,278,'/History/Daily/0/MaxPower',350,'2026-11-26T16:30:00Z'),(7001,278,'/ErrorCode',0,'2026-11-20T00:00:00Z'),
      (7002,1,'/Pv/V',30,'2026-11-26T17:00:00Z');`);
  await db.exec(readFileSync(new URL('../db/20261126_cos_vrm_mppt_read.sql', import.meta.url), 'utf8'));
  const out = (await db.query('select public.cos_vrm_mppt_read() v')).rows[0].v;
  assert.deepEqual(out, {units: [{installationId: 7001, name: 'HELIOS 001', observedAt: Date.parse('2026-11-26T17:00:00Z') / 1000,
    yieldToday: 0.52, yieldYesterday: 0.88, peakToday: 350, peakYesterday: null, panelVolts: 32.4, errorCode: 0}]});
  assert.equal(safeVrmMppt(out, Date.parse('2026-11-26T17:05:00Z')).units.length, 1);
  for (const role of ['anon', 'authenticated']) { await db.exec('begin; set local role ' + role); await assert.rejects(db.query('select public.cos_vrm_mppt_read()'), /permission denied/); await db.exec('rollback'); }
});

test('"made less than the others" needs a battery that had room yesterday, not one that sat full', () => {
  const sec = ms => Math.round(ms / 1000);
  const yesterday = soc => { const pts = []; for (let t = local(25, 7); t <= local(25, 17); t += 1800000) pts.push([sec(t), soc(t), 100, 50]); return pts; };
  const drained = yesterday(t => 70 + (t - local(25, 7)) / 3600000 * 2), full = yesterday(() => 100);
  assert.equal(hadRoomYesterday(drained, NOW), true); assert.equal(hadRoomYesterday(full, NOW), false);
  assert.equal(hadRoomYesterday(drained.slice(0, 3), NOW), false); assert.equal(hadRoomYesterday(null, NOW), false);
  const m = v => ({metric: 'battery_soc', value: v, unit: '%', source: 'system', instance: 0, observedAt: new Date(NOW - 60000).toISOString()});
  const units = [1, 2, 3, 4, 5].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/' + id + '/dashboard', embedUrl: null}));
  const rows = units.map(u => ({installationId: u.installationId, name: u.name, lastAttemptAt: null, errorCode: null, measurements: [m(96)]}));
  const inventory = units.map(u => ({unitNumber: u.name, placement: 'FIELD'}));
  const mppt = parseMppt({units: [unit(1, {yieldYesterday: 0.14}), unit(2, {yieldYesterday: 0.14}), unit(3), unit(4), unit(5)]}, NOW);
  const history = new Map([[1, drained], [2, full]]);   // unit 2 was on outside power yesterday
  const list = victronNeedsAttention(units, rows, inventory, NOW, history, null, null, mppt);
  assert.deepEqual(list.map(i => [i.name, i.kind]), [['HELIOS 001', 'panel']]);
  assert.match(list[0].line, /Panels made 0.14 kWh yesterday · the others made about 0.88 kWh/);
});

// The charger has no clock: its "today" counter starts over a few hours after dark.
const at = (ms, over = {}) => parseMppt({units: [unit(1, {observedAt: Math.round(ms / 1000) - 120, ...over})]}, ms).get(1);

test('late evening, after the charger started its new day: its "yesterday" is shown as today', () => {
  const late = local(26, 22, 5), rolled = at(late, {yieldToday: 0, peakToday: 0, yieldYesterday: 0.81, peakYesterday: 344, panelVolts: 0});
  assert.deepEqual(solarDays(rolled, late), {today: 0.81, peakToday: 344, yesterday: null, judged: {day: 0, made: 0.81}});
  assert.equal(mpptLine(rolled, late), '0.81 kWh today · peak 344 W · panels 0 V');
  // Same hour, a charger that has not started over yet reads as it always did.
  const same = at(late, {yieldToday: 0.81, peakToday: 344, yieldYesterday: 1.13, panelVolts: 0});
  assert.deepEqual(solarDays(same, late).judged, {day: -1, made: 1.13});
  assert.equal(mpptLine(same, late), '0.81 kWh today · 1.13 yesterday · peak 344 W · panels 0 V');
  // Before 9 PM an empty count is a real zero, not a new day.
  const dusk = local(26, 18), zero = at(dusk, {yieldToday: 0, peakToday: 0, panelVolts: 0});
  assert.deepEqual(solarDays(zero, dusk).judged, {day: -1, made: 0.88});
  assert.match(mpptLine(zero, dusk), /^0 kWh today · 0.88 yesterday/);
});

test('small hours, before the charger starts its new day: its "today" is shown as yesterday', () => {
  const small = local(27, 0, 30), still = at(small, {yieldToday: 0.92, peakToday: 360, yieldYesterday: 1.02, panelVolts: 0});
  assert.deepEqual(solarDays(still, small), {today: null, peakToday: null, yesterday: 0.92, judged: {day: -1, made: 0.92}});
  assert.equal(mpptLine(still, small), '0.92 kWh yesterday · panels 0 V');
  const started = at(small, {yieldToday: 0, peakToday: 0, yieldYesterday: 0.92, panelVolts: 0});
  assert.deepEqual(solarDays(started, small).judged, {day: -1, made: 0.92});
  assert.equal(mpptLine(started, small), '0 kWh today · 0.92 yesterday · peak 0 W · panels 0 V');
});

test('late evening, units are compared on the same day and against that day\'s battery', () => {
  const late = local(26, 22, 5), S2 = Math.round(late / 1000) - 120, sec = ms => Math.round(ms / 1000);
  const rolled = made => ({observedAt: S2, yieldToday: 0, peakToday: 0, yieldYesterday: made, panelVolts: 0});
  const notYet = (today, before) => ({observedAt: S2, yieldToday: today, yieldYesterday: before, panelVolts: 0});
  // Units 1-5 have started the new day; 6 has not, and its "yesterday" (the 25th) must not be mixed in.
  const mppt = parseMppt({units: [unit(1, rolled(0.2)), unit(2, rolled(0.8)), unit(3, rolled(0.84)), unit(4, rolled(0.9)), unit(5, rolled(0.86)), unit(6, notYet(0.85, 0.1))]}, late);
  assert.equal(peerYield(mppt, [1, 2, 3, 4, 5, 6], late, 0), 0.84);
  assert.equal(peerYield(mppt, [1, 2, 3, 4, 5, 6], late, -1), null);   // only one unit still speaks about the 25th
  const day = (d, soc) => { const pts = []; for (let t = local(d, 7); t <= local(d, 17); t += 1800000) pts.push([sec(t), soc, 100, 50]); return pts; };
  const m = v => ({metric: 'battery_soc', value: v, unit: '%', source: 'system', instance: 0, observedAt: new Date(late - 60000).toISOString()});
  const units = [1, 2, 3, 4, 5, 6].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/' + id + '/dashboard', embedUrl: null}));
  const rows = units.map(u => ({installationId: u.installationId, name: u.name, lastAttemptAt: null, errorCode: null, measurements: [m(96)]}));
  const inventory = units.map(u => ({unitNumber: u.name, placement: 'FIELD'}));
  // Unit 1 had room today (the 26th): flagged about today. Had it only had room on the 25th, it would not be.
  const today = victronNeedsAttention(units, rows, inventory, late, new Map([[1, day(26, 70)]]), null, null, mppt).filter(i => i.kind === 'panel');
  assert.deepEqual(today.map(i => i.name), ['HELIOS 001']);
  assert.match(today[0].line, /Panels made 0.2 kWh today · the others made about 0.84 kWh/);
  assert.deepEqual(victronNeedsAttention(units, rows, inventory, late, new Map([[1, day(25, 70)]]), null, null, mppt).filter(i => i.kind === 'panel'), []);
  assert.equal(hadRoomYesterday(day(26, 70), late, 0), true); assert.equal(hadRoomYesterday(day(26, 70), late), false);
});

// The saved equipment list only holds HELIOS 001-010. mHelp's own current list places the rest.
const place = (n, placement, zip = null) => ({installationId: 7000 + n, name: 'HELIOS ' + String(n).padStart(3, '0'), placement, zip});

test('database read: Field/Shop from mHelp for each Helios with exactly one current record, service role only', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema cos_vrm_private; create schema cos_mhelp_placement_private;
    create table cos_vrm_private.installations(installation_id bigint primary key, name text not null);
    create table cos_mhelp_placement_private.census_mhelp_current_coverage(product_id text, unit_number text, placement text, zip text);
    insert into cos_vrm_private.installations values(7011,'HELIOS 011'),(7012,'HELIOS 012'),(7013,'HELIOS 013'),(7014,'HELIOS 014'),(7015,'HELIOS 015'),(7099,'Shop bench');
    insert into cos_mhelp_placement_private.census_mhelp_current_coverage values
      ('1','Helios 011','FIELD','77493-1234'),('2','Helios  012','SHOP','77040'),
      ('3','Helios 013','FIELD','77001'),('4','HELIOS 013','SHOP',null),     -- two records: left out
      ('5','Helios 014','UNKNOWN',null),                                      -- not Field or Shop: left out
      ('6','Shop bench','SHOP',null);                                         -- not a Helios: left out`);
  await db.exec(readFileSync(new URL('../db/20261127_cos_vrm_placement_read.sql', import.meta.url), 'utf8'));
  const out = (await db.query('select public.cos_vrm_placement_read() v')).rows[0].v;
  assert.deepEqual(out, {units: [{installationId: 7011, name: 'HELIOS 011', placement: 'FIELD', zip: '77493'}, {installationId: 7012, name: 'HELIOS 012', placement: 'SHOP', zip: null}]});
  assert.equal(safeVrmPlacement(out).units.length, 2);
  for (const role of ['anon', 'authenticated']) { await db.exec('begin; set local role ' + role); await assert.rejects(db.query('select public.cos_vrm_placement_read()'), /permission denied/); await db.exec('rollback'); }
});

test('placement answer: bounded and exact on both sides; anything odd means no placement, never a guess', async () => {
  const good = [place(11, 'FIELD', '77493'), place(12, 'SHOP')];
  assert.deepEqual(safeVrmPlacement({units: good}).units, good);
  assert.deepEqual(parsePlacements({units: [], placements: good}), [{name: 'HELIOS 011', placement: 'FIELD', zip: '77493'}, {name: 'HELIOS 012', placement: 'SHOP', zip: null}]);
  for (const bad of [[place(11, 'FIELD'), place(11, 'SHOP')], [{...place(11, 'FIELD'), placement: 'YARD'}], [{...place(11, 'FIELD'), zip: '7749'}], [{...place(11, 'FIELD'), name: 'Shop bench'}]]) {
    assert.throws(() => safeVrmPlacement({units: bad})); assert.equal(parsePlacements({placements: bad}), null);
  }
  assert.equal(parsePlacements({units: []}), null); assert.equal(parsePlacements({placements: null}), null); assert.equal(parsePlacements(null), null);
  // One read carries both; the charger readings do not depend on the placement part.
  const S3 = Math.round(Date.now() / 1000) - 120;
  const both = await readVrmExtras(async () => Response.json({units: [unit(1, {observedAt: S3})], placements: good}), 't');
  assert.equal(both.mppt.size, 1); assert.equal(both.places.length, 2);
  const noPlace = await readVrmExtras(async () => Response.json({units: [unit(1, {observedAt: S3})], placements: null}), 't');
  assert.equal(noPlace.mppt.size, 1); assert.equal(noPlace.places, null);
  assert.deepEqual(await readVrmExtras(async () => new Response('', {status: 503}), 't'), {mppt: null, places: null});
});

test('the saved list decides; mHelp answers only for a Helios the saved list does not have at all', () => {
  const saved = [
    {unitNumber: 'HELIOS 001', effectivePlacement: {contract: 'COS_EFFECTIVE_FLEET_PLACEMENT_V1', state: 'field'}},
    {unitNumber: 'HELIOS 002', effectivePlacement: {contract: 'COS_EFFECTIVE_FLEET_PLACEMENT_V1', state: 'unknown'}},   // held for review: stays unknown
    {unitNumber: 'Spotter 230', placement: 'FIELD'},
  ];
  const places = [{name: 'HELIOS 001', placement: 'SHOP', zip: null}, {name: 'HELIOS 002', placement: 'FIELD', zip: '77001'},
    {name: 'HELIOS 011', placement: 'FIELD', zip: '77493'}, {name: 'HELIOS 012', placement: 'SHOP', zip: null}];
  const merged = withMhelpPlacement(saved, places);
  assert.equal(merged.length, 5);
  assert.deepEqual(['HELIOS 001', 'HELIOS 002', 'HELIOS 011', 'HELIOS 012', 'HELIOS 013'].map(n => heliosPlacement(n, merged)), ['field', 'unknown', 'field', 'shop', 'unknown']);
  assert.deepEqual(['HELIOS 011', 'HELIOS 012'].map(n => heliosPlacement(n, saved)), ['unknown', 'unknown']);   // what the page did before
  // A Field unit placed by mHelp gets its ZIP-area forecast; a Shop unit gets none.
  assert.equal(heliosSpots(saved).size, 0); assert.equal(heliosSpots(merged).size, 1); assert.match([...heliosSpots(merged).keys()][0], /^HELIOS\|0*11$/);
  // Nothing from mHelp: the saved list is returned untouched. No saved list at all: mHelp still places every Helios.
  assert.equal(withMhelpPlacement(saved, null), saved); assert.equal(withMhelpPlacement(saved, []), saved); assert.equal(withMhelpPlacement(null, null), null);
  assert.deepEqual(['HELIOS 001', 'HELIOS 012'].map(n => heliosPlacement(n, withMhelpPlacement(null, places))), ['shop', 'shop']);
});
