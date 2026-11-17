import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFamily, familyHealthCards, reconDetectors, todayIssues} from '../src/todayIssues.ts';
import {issueGuide} from '../src/issueGuide.ts';
import {observationFresh} from '../src/cameraEvidence.ts';
import {queueMissingProductLinks} from '../shared/mhelpCameraPlacement.ts';
import {RECON_DETECTOR_FRESH_MS} from '../shared/otherUnitStatus.ts';
import {RECON_DETECTOR_FRESH_MS as BOARD_RECON_WINDOW} from '../src/cameraEvidence.ts';

const clear = {voltage: 'clear', soc: 'clear', silent: 'clear', victronLowVoltage: 'clear'};
const now = Date.parse('2026-11-17T12:24:00Z');

test('issues stay in severity order and shop is not an outage', () => {
  const model = todayIssues({
    role: 'owner', boardCurrent: true, checkedAt: now,
    cameras: [
      {unit: 'SPOTTER 264', unitId: 'u1', placement: 'FIELD', offline: 1},
      {unit: 'SNIPER 44', placement: 'SHOP', offline: 2},
    ],
    power: [{unit: 'HELIOS 8', placement: 'FIELD', verdict: {...clear, voltage: 'alarm'}}],
    placements: [{unit: 'SOLAR SPOTTER 054', unitId: 'u54'}],
    deviceLinks: [{unit: 'RANGER 3', productId: 'p3'}],
    addresses: [{unit: 'CAMV 4', productId: 'p4', placement: 'FIELD', address: '2850 Twinwood Pkwy, Brookshire, TX 77423'}],
    noReadings: [{unit: 'SPOTTER 2', productId: 'p2'}],
  });
  assert.equal(model.count, model.issues.length);
  assert.equal(model.headline, '6 issues today');
  assert.deepEqual(model.issues.map(issue => issue.kind), ['outage', 'power', 'placement', 'device_link', 'address', 'no_reading']);
  assert.equal(model.issues[0].line, 'SPOTTER 264 — 1 camera offline in the field');
  assert.equal(model.empty, null);
  assert.equal(model.issues.some(issue => issue.unit === 'SNIPER 44'), false);
});

test('a tech does not see placement or device-link reviews', () => {
  const model = todayIssues({
    role: 'tech', boardCurrent: true,
    cameras: [{unit: 'SPOTTER 264', placement: 'FIELD', offline: 1}],
    placements: [{unit: 'SOLAR SPOTTER 054'}],
    deviceLinks: [{unit: 'RANGER 3'}],
  });
  assert.deepEqual(model.issues.map(issue => issue.kind), ['outage']);
});

test('Recon field counts keep unknown separate and leave shop out', () => {
  const cards = familyHealthCards([
    {unit: 'RECON 9', placement: 'field', state: 'offline'},
    {unit: 'RECON II 2', placement: 'field', state: 'unknown'},
    {unit: 'RECON 3', placement: 'field', state: 'online'},
    {unit: 'RECON 4', placement: 'shop', state: 'offline'},
    {unit: 'SNIPER 1', placement: 'field', state: 'online'},
  ], []);
  const recon = cards.find(card => card.id === 'recon');
  assert.equal(cameraFamily('RECON II 2'), 'recon');
  assert.deepEqual([recon.online, recon.offline, recon.unknown, recon.field], [1, 1, 1, 3]);
  assert.equal(recon.online + recon.offline + recon.unknown, recon.field);
});

test('each issue kind has a guide a tech or owner can finish in the card', () => {
  for (const kind of ['outage', 'power', 'address', 'no_reading']) {
    const steps = issueGuide(kind, 'tech');
    assert.ok(steps.some(step => step.control === 'outcome'));
    assert.equal(steps.some(step => step.ownerOnly), false);
  }
  assert.ok(issueGuide('device_link', 'owner').some(step => step.control === 'link'));
  assert.equal(issueGuide('device_link', 'tech').some(step => step.control === 'link'), false);
  assert.ok(issueGuide('placement', 'owner').some(step => step.control === 'confirm-shop'));
  assert.ok(issueGuide('address', 'tech').some(step => step.control === 'mhelp'));
});

test('Wall-E has no status source, so it stays Unknown', () => {
  const cards = familyHealthCards([{unit: 'WA 003', placement: 'field', state: 'online'}, {unit: 'WA 100', placement: 'field', state: 'offline'}], []);
  const card = cards.find(item => item.id === 'walle');
  assert.deepEqual([card.online, card.offline, card.unknown], [0, 0, 2]);
  assert.deepEqual(card.issues.map(issue => issue.line), ['WA 003 — no status source', 'WA 100 — no status source']);
});

test('a Recon detector a few hours old stays on the card, and a critical battery is shown', () => {
  assert.equal(RECON_DETECTOR_FRESH_MS, BOARD_RECON_WINDOW);
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const old = new Date(now - 8 * 60 * 60 * 1000).toISOString();
  const row = (id, name, status, at, percent) => ({
    id, name, unit: 'RECON II 022', type: 'detector', activationState: 'active', status: 'online',
    evidence: {kind: 'provider', source: 'Reconeyez', resource: 'detector', active: true, status, observedAt: at, lastOnlineAt: at},
    batteryEvidence: {source: 'Reconeyez', percent, percentObservedAt: at, status: percent <= 10 ? 'critical' : 'normal', statusObservedAt: at},
  });
  const star = {kind: 'provider', source: 'Star4Live', resource: 'camera', observedAt: recent};
  assert.equal(observationFresh(star, now), false);
  assert.equal(observationFresh(row('a', 'RII022 Cam 1', 'online', recent, 2).evidence, now), true);
  const detectors = [
    ...reconDetectors([row('a', 'RII022 Cam 1', 'online', recent, 2), row('b', 'RII029 Cam 1', 'online', recent, 5), row('c', 'RII029 Cam 2', 'offline', old, 1)], now),
  ];
  const cards = familyHealthCards([
    {unit: 'RECON II 022', placement: 'field', state: 'unknown', detectors: detectors.filter(item => item.name.startsWith('RII022'))},
    {unit: 'RECON II 029', placement: 'field', state: 'unknown', detectors: detectors.filter(item => item.name.startsWith('RII029'))},
  ], [{id: 'link:022', kind: 'device_link', unit: 'RECON II 022', line: 'RECON II 022 — device link needed'}], now);
  const card = cards.find(item => item.id === 'recon');
  assert.deepEqual([card.online, card.offline, card.unknown], [1, 0, 1]);
  assert.deepEqual(card.batteries.map(item => item.percent).sort(), [1, 2, 5]);
  assert.match(card.notes[0], /RII029 Cam 2 — last reported offline/);
  assert.equal(card.issues[0].line, 'RECON II 022 — device link needed');
  const queued = queueMissingProductLinks([
    {unit: 'RECON II 005', source: 'reconeyez', productIdKnown: true, mhelpProductId: null},
    {unit: 'RANGER 12', source: 'star4live', productIdKnown: true, mhelpProductId: null},
    {unit: 'SNIPER 119', source: 'ip_check', productIdKnown: true, mhelpProductId: 'old-id'},
    {unit: 'SNIPER 44', source: 'ip_check', productIdKnown: false},
  ], new Set(['current-id']));
  assert.deepEqual(queued, ['RECON II 005 — device link needed', 'RANGER 12 — device link needed', 'SNIPER 119 — device link needed']);
});

test('an empty current board says there are no issues, and a stale board does not', () => {
  assert.equal(todayIssues({role: 'tech', boardCurrent: true}).empty, 'No issues right now');
  const stale = todayIssues({role: 'tech', boardCurrent: false, checkedAt: now});
  assert.match(stale.empty, /Board not current — last checked /);
  assert.equal(stale.headline, '0 issues today');
});
