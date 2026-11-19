import test from 'node:test';
import assert from 'node:assert/strict';
import {placementException, placementWithMhelpFirst, OWNER_OVERRIDE_IGNORED, PLACEMENT_DIFFERS} from '../src/mhelpPlacementFirst.ts';
import {manualShopInventory, projectManualShop} from '../../supabase/functions/cos-operations-pages/fleetShopProjection.ts';

const at = '2026-10-20T22:02:00Z';
const unit = '00000000-0000-4000-8000-000000000001';
const audit = '00000000-0000-4000-8000-000000000099';

test('mHelp wins and a disagreeing owner override is ignored for the count', () => {
  assert.equal(placementWithMhelpFirst('SHOP', 'FIELD'), 'FIELD');
  assert.equal(placementWithMhelpFirst('FIELD', 'SHOP'), 'SHOP');
  assert.equal(placementWithMhelpFirst('SHOP', null), 'SHOP');
  assert.equal(placementException('SHOP', 'FIELD', 'owner_override'), OWNER_OVERRIDE_IGNORED);
  assert.equal(placementException('SHOP', 'FIELD', 'cos'), PLACEMENT_DIFFERS);
  assert.equal(placementException('SHOP', 'SHOP', 'owner_override'), null);
  assert.equal(OWNER_OVERRIDE_IGNORED, 'Owner override disagrees with mHelp (ignored for counts)');
});

test('the board shop path keeps an mHelp Field unit in the field count', () => {
  const upload = {
    source: 'owner_supplied_mhelp_export',
    sourceSha256: 'a'.repeat(64),
    receivedAt: '2026-11-19T15:00:00Z',
    summary: {},
    records: [{
      productId: '100',
      unitNumber: 'Spotter 054',
      placement: 'FIELD',
      uploadLifecycle: 'UNFLAGGED',
      binding: {state: 'linked', unitIds: [unit], candidateUnitIds: [], placementHeld: false},
    }],
  };
  const receipt = {contract: 'COS_FLEET_SHOP_OVERRIDES_V1', items: [{
    unitId: unit, unitNumber: 'Spotter 054', auditId: audit, recordedAt: at, placement: 'SHOP', recordedBy: 'Alex Rivera',
    sourceBindings: [{productId: '100', sourceSha256: upload.sourceSha256, sourceUnitNumber: 'Spotter 054'}],
  }]};
  const effective = manualShopInventory(upload, receipt);
  assert.equal(effective.records[0].placement, 'FIELD');
  assert.equal(effective.cosManualShopCount, 0);
  assert.equal(effective.supersededShopMoves[0].detail, OWNER_OVERRIDE_IGNORED);
  const projected = projectManualShop({
    uploadInventory: upload,
    inventoryItems: [{id: unit, unitNumber: 'Spotter 054', placement: 'FIELD'}],
    items: [{id: unit, unitNumber: 'Spotter 054'}],
    summary: {},
  }, receipt);
  assert.equal(projected.inventoryItems[0].placement, 'FIELD');
  assert.equal(projected.items.some(row => row.id === unit), true);
  assert.equal(projected.supersededShopMoves[0].detail, OWNER_OVERRIDE_IGNORED);
});
