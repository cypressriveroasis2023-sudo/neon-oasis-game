import assert from 'node:assert/strict';
import test from 'node:test';
import {planAgreedUnitLinks} from '../shared/mhelpUnitLinkAgreement.ts';
import {mhelpUnitIdentity} from '../shared/mhelpUnitIdentity.ts';
import {unitIdentity} from '../shared/mhelpUnitLink.ts';

// Spellings taken from the live lists on 2026-11-24: COS writes SNIPER 2 344
// and mHelp writes Sniper 2-344 for the same unit.
const cos = (id, name, productId) => ({id, name, productId: productId || null});
const row = (id, name, productId) => ({id, name, productId, lifecycle: 'UNFLAGGED'});

test('a link both readers confirm is written', () => {
  const plan = planAgreedUnitLinks([cos('635', 'SNIPER 2 344')], [row('p', 'Sniper 2-344', '2303195')]);
  assert.equal(plan.disagreed.length, 0);
  assert.deepEqual(plan.links.map(l => [l.unitId, l.productId]), [['635', '2303195']]);
});

test('the placement reader rejecting the COS name holds the link instead of writing it', () => {
  // SNIPER 317 ES: the newer reader drops the trailing model word, the
  // placement reader does not recognise the name at all.
  assert.equal(unitIdentity('SNIPER 317 ES').key, 'SNIPER:317');
  assert.equal(mhelpUnitIdentity('SNIPER 317 ES'), null);
  const plan = planAgreedUnitLinks([cos('608', 'SNIPER 317 ES')], [row('p', 'Sniper 317', '2259042')]);
  assert.equal(plan.links.length, 0);
  assert.equal(plan.disagreed.length, 1);
  assert.equal(plan.disagreed[0].reason, 'placement_reader_rejects_cos_name');
  assert.equal(plan.disagreed[0].productId, '2259042');
  assert.equal(plan.disagreed[0].placementCosKey, null);
  assert.equal(plan.disagreed[0].placementMhelpKey, 'SNIPER|317|');
});

test('the placement reader rejecting the mHelp name holds the link too', () => {
  const plan = planAgreedUnitLinks([cos('608', 'SNIPER 317')], [row('p', 'SNIPER 317 ES', '2259042')]);
  assert.equal(plan.links.length, 0);
  assert.equal(plan.disagreed[0].reason, 'placement_reader_rejects_mhelp_name');
});

test('RSU and CAMV are one unit to the placement reader, so neither is linked', () => {
  // The trap this module exists for: the placement reader folds RSU into CAMV.
  assert.equal(mhelpUnitIdentity('RSU 001').key, 'CAMV|1|');
  assert.equal(mhelpUnitIdentity('CAMV 001').key, 'CAMV|1|');
  assert.notEqual(unitIdentity('RSU 001').key, unitIdentity('CAMV 001').key);
  const plan = planAgreedUnitLinks(
    [cos('1', 'RSU 001'), cos('2', 'CAMV 001')],
    [row('a', 'RSU 001', '1714213'), row('b', 'CAMV 001', '2218840')],
  );
  assert.equal(plan.links.length, 0);
  assert.equal(plan.disagreed.length, 2);
  for (const held of plan.disagreed) assert.equal(held.reason, 'one_unit_to_the_placement_reader');
  // Both A#s stay unused, so a person can still assign either one.
  assert.deepEqual(plan.disagreed.map(h => h.productId).sort(), ['1714213', '2218840']);
});

test('a CAMV unit on its own still links, with no RSU record to crowd it', () => {
  const plan = planAgreedUnitLinks([cos('651', 'CAMV 002')], [row('p', 'CAMV 002', '2218842')]);
  assert.deepEqual(plan.links.map(l => l.productId), ['2218842']);
  assert.equal(plan.disagreed.length, 0);
});

test('Radar Sniper 500 and SNIPER 500 are never joined by either reader', () => {
  // mHelp has Radar Sniper 500; COS has SNIPER 500 with no A#. Whether they are
  // the same unit is a question for a person, so nothing is linked and both
  // sides are reported.
  const plan = planAgreedUnitLinks([cos('634', 'SNIPER 500')], [row('p', 'Radar Sniper 500', '1910800')]);
  assert.equal(plan.links.length, 0);
  assert.equal(plan.disagreed.length, 0);
  assert.deepEqual(
    plan.held.map(h => [h.side, h.name, h.reason]).sort(),
    [['cos', 'SNIPER 500', 'no_mhelp_row'], ['mhelp', 'Radar Sniper 500', 'no_cos_unit']],
  );
});

test('holds from the first reader are passed through untouched', () => {
  const plan = planAgreedUnitLinks(
    [cos('464', 'Sniper Alibi 243')],
    [row('p', 'Sniper 003 - DO NOT USE', '1714260')],
  );
  assert.equal(plan.links.length, 0);
  assert.equal(plan.disagreed.length, 0);
  assert.deepEqual(
    plan.held.map(h => h.reason).sort(),
    ['name_not_recognised', 'out_of_service'],
  );
});

test('a unit that already carries an A# is never written to again', () => {
  const plan = planAgreedUnitLinks(
    [cos('536', 'SNIPER 148', '1287578')],
    [row('p', 'Sniper 148', '1287578')],
  );
  assert.equal(plan.links.length, 0);
  assert.equal(plan.disagreed.length, 0);
});

test('an A# already saved on another record is never reused', () => {
  const plan = planAgreedUnitLinks(
    [cos('999', 'SNIPER 190')], [row('p', 'Sniper 190', '1287651')], ['1287651'],
  );
  assert.equal(plan.links.length, 0);
  assert.deepEqual(plan.held.map(h => h.reason), ['product_id_taken']);
});
