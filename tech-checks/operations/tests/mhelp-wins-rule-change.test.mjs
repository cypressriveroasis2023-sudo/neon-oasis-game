import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manualShopInventory, rollbackShopOverrideCount} from '../../supabase/functions/cos-operations-pages/fleetShopProjection.ts';
import {readMhelpInventoryAuthority} from '../src/mhelpInventoryAuthority.ts';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';

const manifest = JSON.parse(readFileSync(new URL('./mhelp-wins-rule-change.json', import.meta.url), 'utf8'));
const provenance = 'James 10:15 AM CT Nov 19: mHelp wins; flag overrides that disagree';

test('the mHelp rule change is declared for the override tests', () => {
  assert.equal(manifest.provenance, provenance);
  assert.equal(manifest.flag, 'Owner override disagrees with mHelp (ignored for counts)');
  assert.equal(manifest.tests.length, 7);
  const files = new Map();
  for (const change of manifest.tests) {
    assert.equal(typeof change.old, 'string');
    assert.equal(typeof change.new, 'string');
    assert.notEqual(change.old, change.new);
    files.set(change.file, readFileSync(new URL('./' + change.file, import.meta.url), 'utf8'));
  }
  for (const change of manifest.tests) {
    assert.match(files.get(change.file), new RegExp(change.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(files.get(change.file), /Owner override disagrees with mHelp \(ignored for counts\)|toHaveText\('287'\)/);
  }
});

test('applying the rule-change rollback restores the old shop count', () => {
  const f = statusPinsFixture();
  const unit = f.field.inventoryItems[0];
  const receipt = {contract: 'COS_FLEET_SHOP_OVERRIDES_V1', items: [{unitId: unit.id, unitNumber: unit.unitNumber, auditId: '77777777-7777-4777-8777-777777777777', placement: 'SHOP', recordedAt: '2026-10-06T18:00:01.000Z', sourceBindings: [{productId: f.upload.records[0].productId, sourceSha256: f.upload.sourceSha256, sourceUnitNumber: f.upload.records[0].unitNumber}]}]};
  const current = readMhelpInventoryAuthority(manualShopInventory(f.upload, receipt), Date.parse(f.fresh));
  assert.equal(current.field, 287);
  assert.equal(current.shop, 714);
  const rolled = rollbackShopOverrideCount(f.upload, receipt);
  assert.equal(rolled.field, 286);
  assert.equal(rolled.shop, 715);
  assert.equal(rolled.total, 1001);
});
