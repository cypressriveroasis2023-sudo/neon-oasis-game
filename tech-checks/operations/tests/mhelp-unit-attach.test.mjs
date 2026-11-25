import assert from 'node:assert/strict';
import test from 'node:test';
import {attachIdentity, outOfService, planUnitAttachments, summariseAttachPlan} from '../shared/mhelpUnitAttach.ts';

// Every spelling below was taken from the live lists on 2026-11-24.
const cos = (unitKey, name) => ({id: unitKey, name: name || unitKey});
const row = (productId, name, lifecycle) => ({id: productId, name, productId, lifecycle: lifecycle || 'UNFLAGGED'});

test('the model suffix is not part of which unit this is', () => {
  // The case that blocked SPOTTER 236 all week.
  assert.equal(attachIdentity('SPOTTER 236').key, 'SPOTTER|236');
  assert.equal(attachIdentity('Spotter 236HDC2').key, 'SPOTTER|236');
  assert.equal(attachIdentity('Spotter 236HDC2').variant, 'HDC2');
  assert.equal(attachIdentity('SPOTTER 236').variant, '');
});

test('spacing, capitals and leading zeros never make a second unit', () => {
  assert.equal(attachIdentity('SOLARSPOTTER 010').key, attachIdentity('Solar Spotter 010').key);
  assert.equal(attachIdentity('RANGER 014').key, attachIdentity('Ranger 014').key);
  assert.equal(attachIdentity('CAMV 010').key, attachIdentity('CAM V 010').key);
});

test('the placement system aliases are kept, not re-invented', () => {
  // RSU reads as CAMV and ST as SOLARPOLE, because that is what the placement
  // reader already does. This module does not get a second opinion on families.
  assert.equal(attachIdentity('RSU 001').key, 'CAMV|1');
  assert.equal(attachIdentity('CAMV 001').key, 'CAMV|1');
  assert.equal(attachIdentity('ST 255').key, 'SOLARPOLE|255');
});

test('a decimal unit number stays its own unit', () => {
  assert.equal(attachIdentity('Spotter 028.1HDC4S').key, 'SPOTTER|28.1');
  assert.notEqual(attachIdentity('Spotter 028.1HDC4S').key, attachIdentity('Spotter 028').key);
});

test('a name carrying site text is not a unit name', () => {
  // The two live COS duplicates. Neither is linked.
  assert.equal(attachIdentity('RII024 - Not in use'), null);
  assert.equal(attachIdentity('RII-034 - EZ Bel Construction'), null);
});

test('out of service is never attached, from either the name or the lifecycle', () => {
  assert.equal(outOfService('Sniper 003 - DO NOT USE'), true);
  assert.equal(outOfService('Sniper 003', 'DO_NOT_USE'), true);
  assert.equal(outOfService('Sniper 003', 'UNFLAGGED'), false);
  const plan = planUnitAttachments([cos('SNIPER 003')], [row('1714260', 'Sniper 003 - DO NOT USE', 'DO_NOT_USE')]);
  assert.equal(plan.links.length, 0);
  assert.deepEqual(plan.held.map(h => [h.side, h.reason]).sort(), [['cos', 'no_mhelp_row'], ['mhelp', 'out_of_service']]);
});

test('one COS unit and one mHelp row with the same family and number are linked', () => {
  const plan = planUnitAttachments([cos('SPOTTER 236')], [row('1982800', 'Spotter 236HDC2')]);
  assert.deepEqual(plan.links.map(l => [l.unitKey, l.productId, l.mhelpName]), [['SPOTTER 236', '1982800', 'Spotter 236HDC2']]);
  assert.equal(plan.held.length, 0);
  assert.equal(summariseAttachPlan(plan).suffixDiffers, 1);
});

test('two COS units sharing a family and number are both held', () => {
  const plan = planUnitAttachments(
    [cos('SPOTTER 236'), cos('SPOTTER 236HD')], [row('1982800', 'Spotter 236HDC2')],
  );
  assert.equal(plan.links.length, 0);
  assert.deepEqual(plan.held.map(h => h.reason), ['two_cos_units', 'two_cos_units']);
});

test('two mHelp rows sharing a family and number hold the COS unit', () => {
  const plan = planUnitAttachments(
    [cos('SPOTTER 236')], [row('1982800', 'Spotter 236HDC2'), row('1982801', 'Spotter 236HD')],
  );
  assert.equal(plan.links.length, 0);
  assert.deepEqual(plan.held.map(h => h.reason), ['two_mhelp_rows']);
});

test('a unit mHelp does not hold, and a unit COS does not hold, are both reported', () => {
  const plan = planUnitAttachments([cos('SPOTTER 999')], [row('1982800', 'Spotter 236HDC2')]);
  assert.equal(plan.links.length, 0);
  assert.deepEqual(
    plan.held.map(h => [h.side, h.name, h.reason]).sort(),
    [['cos', 'SPOTTER 999', 'no_mhelp_row'], ['mhelp', 'Spotter 236HDC2', 'no_cos_unit']],
  );
});

test('an A# already attached elsewhere is never reused', () => {
  const plan = planUnitAttachments([cos('SPOTTER 236')], [row('1982800', 'Spotter 236HDC2')], ['1982800']);
  assert.equal(plan.links.length, 0);
  assert.deepEqual(plan.held.map(h => h.reason), ['product_id_taken']);
});

test('a unit that already has a link is left exactly as it is', () => {
  const plan = planUnitAttachments(
    [cos('SPOTTER 236')], [row('1982800', 'Spotter 236HDC2')], [], ['SPOTTER 236'],
  );
  assert.equal(plan.links.length, 0);
  assert.equal(plan.held.length, 0);
});

test('a summary counts the holds by reason', () => {
  const plan = planUnitAttachments(
    [cos('SPOTTER 236'), cos('RII024 - Not in use'), cos('SPOTTER 999')],
    [row('1982800', 'Spotter 236HDC2'), row('1714260', 'Sniper 003 - DO NOT USE', 'DO_NOT_USE')],
  );
  const summary = summariseAttachPlan(plan);
  assert.equal(summary.links, 1);
  assert.equal(summary.held, 3);
  // "RII024 - Not in use" is held as out of service, which is checked before the
  // name is read: a retired duplicate is a clearer answer than an unreadable name.
  assert.equal(summary.heldByReason.out_of_service, 2);
  assert.equal(summary.heldByReason.no_mhelp_row, 1);
  assert.equal(summary.heldByReason.name_not_recognised, undefined);
});
