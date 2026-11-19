import test from 'node:test';
import assert from 'node:assert/strict';
import {placementException, placementWithMhelpFirst} from '../src/mhelpPlacementFirst.ts';

test('mHelp placement wins and an owner override is only a flag', () => {
  assert.equal(placementWithMhelpFirst('SHOP', 'FIELD'), 'FIELD');
  assert.equal(placementWithMhelpFirst('FIELD', 'SHOP'), 'SHOP');
  assert.equal(placementWithMhelpFirst('SHOP', null), 'SHOP');
  assert.equal(placementException('SHOP', 'FIELD'), 'Owner placement override disagrees with mHelp');
  assert.equal(placementException('SHOP', 'SHOP'), null);
  assert.equal(placementException('FIELD', null), null);
});
