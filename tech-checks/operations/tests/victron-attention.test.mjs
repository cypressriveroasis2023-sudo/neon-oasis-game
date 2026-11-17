import test from 'node:test';
import assert from 'node:assert/strict';
import {heliosPlacement, victronNeedsAttention} from '../src/victronAttention.ts';

const now = Date.parse('2026-11-17T16:00:00Z');
const ago = (ms) => new Date(now - ms).toISOString();
const soc = (value, age = 60 * 1000) => ({metric: 'battery_soc', value, unit: '%', observedAt: ago(age), instance: 0, source: 'system'});
const unit = (id, name) => ({installationId: id, name});
const inventory = [
  {unitNumber: 'HELIOS 001', placement: 'FIELD', currentLocationType: 'field'},
  {unitNumber: 'HELIOS 016', placement: 'SHOP', currentLocationType: 'shop'},
  {unitNumber: 'HELIOS 002', placement: 'FIELD', currentLocationType: 'field'},
];
const settings = {lowVoltageV: null, lowSocPercent: 20, silentHours: null};

test('mHelp placement is Field or Shop only when one Helios number matches', () => {
  assert.equal(heliosPlacement('HELIOS 001', inventory), 'field');
  assert.equal(heliosPlacement('HELIOS 016', inventory), 'shop');
  assert.equal(heliosPlacement('HELIOS 016', [...inventory, {unitNumber: 'Helios 16', placement: 'FIELD'}]), 'unknown');
  assert.equal(heliosPlacement('HELIOS 099', inventory), 'unknown');
});

test('a fresh low Field battery is a power issue, and a Shop unit is only shop attention', () => {
  const lines = victronNeedsAttention({
    now,
    settings,
    inventory,
    units: [unit(1, 'HELIOS 001'), unit(16, 'HELIOS 016'), unit(2, 'HELIOS 002')],
    power: [
      {installationId: 1, name: 'HELIOS 001', measurements: [soc(12)]},
      {installationId: 16, name: 'HELIOS 016', measurements: [soc(4)]},
      {installationId: 2, name: 'HELIOS 002', measurements: [soc(9, 50 * 60 * 1000)]},
    ],
  });
  assert.deepEqual(lines.map(line => line.kind), ['power', 'unknown', 'shop']);
  assert.match(lines[0].line, /HELIOS 001 — Field · charge 12% · power issue/);
  assert.match(lines[1].line, /HELIOS 002 — Field · power unknown/);
  assert.match(lines[2].line, /HELIOS 016 — Shop · shop attention/);
  assert.equal(lines.some(line => /offline|alarm|outage/i.test(line.line)), false);
});

test('an unset charge threshold does not invent an alarm', () => {
  const lines = victronNeedsAttention({
    now,
    settings: {lowVoltageV: null, lowSocPercent: null, silentHours: null},
    inventory,
    units: [unit(1, 'HELIOS 001')],
    power: [{installationId: 1, name: 'HELIOS 001', measurements: [soc(4)]}],
  });
  assert.deepEqual(lines, []);
});
