import assert from 'node:assert/strict';
import test from 'node:test';
import {LINK_FAMILIES, outOfService, planUnitLinks, unitIdentity} from '../shared/mhelpUnitLink.ts';

// Names are made up here, in the spellings both sides actually use.
const cos = (id, name) => ({id, name});
const row = (id, name, productId, lifecycle) => ({id, name, productId, lifecycle: lifecycle || 'UNFLAGGED'});

test('a hyphen and a space are the same unit, and so are CAM V and CAMV', () => {
  assert.deepEqual(unitIdentity('Sniper 2-344'), {family: 'SNIPER 2', number: 344, key: 'SNIPER 2:344'});
  assert.deepEqual(unitIdentity('SNIPER 2 344'), {family: 'SNIPER 2', number: 344, key: 'SNIPER 2:344'});
  assert.equal(unitIdentity('Sniper 4-100').key, unitIdentity('SNIPER 4 100').key);
  assert.equal(unitIdentity('CAM V 013').key, unitIdentity('CAMV 013').key);
  assert.equal(unitIdentity('CAM-V 13').key, 'CAMV:13');
});

test('leading zeros, a trailing model word and spacing never make a second unit', () => {
  assert.equal(unitIdentity('CAMV 013').key, unitIdentity('camv 13').key);
  assert.equal(unitIdentity('SNIPER 317 ES').key, 'SNIPER:317');
  assert.equal(unitIdentity('  sniper   317  ').key, 'SNIPER:317');
  assert.equal(unitIdentity('Radar Sniper 500').key, 'RADAR SNIPER:500');
  assert.equal(unitIdentity('RSU 001').key, 'RSU:1');
});

test('a name outside the families COS checks, or with no number, has no identity', () => {
  for (const name of ['Solar Spotter 010', 'Spotter HDC2 045', 'Ranger 007', 'Helios 001', 'Recon II 028'])
    assert.equal(unitIdentity(name), null, name);
  for (const name of ['Sniper', 'Sniper ES', '', '   ', null, undefined, 42, {}])
    assert.equal(unitIdentity(name), null, String(name));
  assert.equal(unitIdentity('Sniper 0'), null);
  assert.ok(LINK_FAMILIES.includes('SNIPER 4'));
});

test('a DO NOT USE row is read for its name but never linked', () => {
  assert.equal(unitIdentity('Sniper 024 - DO NOT USE').key, 'SNIPER:24');
  assert.ok(outOfService('Sniper 024 - DO NOT USE'));
  assert.ok(outOfService('SNIPER 143 RETIRED'));
  assert.equal(outOfService('Sniper 148'), false);
  const plan = planUnitLinks([cos('u1', 'SNIPER 24')], [row('m1', 'Sniper 024 - DO NOT USE', '111')]);
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.held.map(h => [h.side, h.reason]).sort(), [['cos', 'no_mhelp_row'], ['mhelp', 'out_of_service']]);
});

test('one COS unit and one mHelp row with the same family and number are linked', () => {
  const plan = planUnitLinks(
    [cos('u1', 'SNIPER 2 344'), cos('u2', 'SNIPER 4 100'), cos('u3', 'CAMV 013')],
    [row('m1', 'Sniper 2-344', '2303195'), row('m2', 'Sniper 4-100', '2303200'), row('m3', 'CAM V 13', '1732576')]);
  assert.deepEqual(plan.links.map(l => [l.unitName, l.productId]).sort(),
    [['CAMV 013', '1732576'], ['SNIPER 2 344', '2303195'], ['SNIPER 4 100', '2303200']]);
  assert.deepEqual(plan.held, []);
});

test('a family is part of the identity: Sniper 2 344 is not Sniper 344', () => {
  const plan = planUnitLinks([cos('u1', 'SNIPER 344')], [row('m1', 'Sniper 2-344', '2303195')]);
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.held.map(h => h.reason).sort(), ['no_cos_unit', 'no_mhelp_row']);
});

test('two candidates on either side write nothing and name the ambiguity', () => {
  const two = planUnitLinks([cos('u1', 'SNIPER 148')], [row('m1', 'Sniper 148', '1'), row('m2', 'SNIPER 148', '2')]);
  assert.deepEqual(two.links, []);
  assert.equal(two.held.find(h => h.side === 'cos').reason, 'two_mhelp_rows');
  const dup = planUnitLinks([cos('u1', 'SNIPER 148'), cos('u2', 'Sniper 148')], [row('m1', 'Sniper 148', '1')]);
  assert.deepEqual(dup.links, []);
  assert.deepEqual(dup.held.filter(h => h.side === 'cos').map(h => h.reason), ['two_cos_units', 'two_cos_units']);
});

test('an A# already saved on another unit is never reused', () => {
  const plan = planUnitLinks([cos('u1', 'SNIPER 148')], [row('m1', 'Sniper 148', '1287578')], ['1287578']);
  assert.deepEqual(plan.links, []);
  assert.equal(plan.held.find(h => h.side === 'cos').reason, 'product_id_taken');
});

test('an mHelp row COS has no record of is reported, never invented', () => {
  const plan = planUnitLinks([], [row('m1', 'Sniper 2-346', '2303197')]);
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.held, [{side: 'mhelp', id: 'm1', name: 'Sniper 2-346', reason: 'no_cos_unit'}]);
});

test('a row with no usable A# is held, and the plan carries nothing but links and holds', () => {
  for (const bad of [null, undefined, '', 'abc', '0', '12a'])
    assert.equal(planUnitLinks([cos('u1', 'SNIPER 148')], [row('m1', 'Sniper 148', bad)]).links.length, 0, String(bad));
  const plan = planUnitLinks([cos('u1', 'SNIPER 148')], [row('m1', 'Sniper 148', '7')]);
  assert.deepEqual(Object.keys(plan).sort(), ['held', 'links']);
  assert.deepEqual(Object.keys(plan.links[0]).sort(), ['key', 'mhelpName', 'productId', 'unitId', 'unitName']);
});
