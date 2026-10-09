import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryAreas, visionAreas, isOnHand, locationLink } from '../src/visionAreas.ts';

test('primary navigation preserves six fleet areas and includes the capability-gated Unit Tracker', () => {
  assert.deepEqual(visionAreas.map(area => area.label), ['Camera Health', 'InHand Routers', 'Victron Power', 'Units On Hand', 'Field View', 'Team']);
  assert.equal(primaryAreas.length, 9);
  assert.equal(primaryAreas.filter(area=>area.workspace==='Unit Tracker').length,1);
});
test('on-hand inventory requires recorded physical placement', () => {
  assert.equal(isOnHand({ status: 'available', currentLocationType: null }), false);
  assert.equal(isOnHand({ status: 'available', currentLocationType: 'shop' }), true);
  assert.equal(isOnHand({ status: 'repair', currentLocationType: 'shop' }), true);
  for (const status of ['installed', 'retired', 'in_transit', 'returning']) assert.equal(isOnHand({ status, currentLocationType: 'shop' }), false);
  assert.equal(isOnHand({ status: 'available', currentLocationType: 'shop', installedSiteId: 'site-1' }), false);
});
test('location links prefer complete valid GPS and safely fall back to address', () => {
  assert.equal(locationLink({ latitude: 29.7, longitude: -95.4, address: 'Fixture yard' }), 'https://www.google.com/maps/search/?api=1&query=29.7%2C-95.4');
  assert.equal(locationLink({ latitude: null, longitude: null, address: '1 Main St, Houston & gate 2' }), 'https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Houston%20%26%20gate%202');
  assert.equal(locationLink({ latitude: '', longitude: null }), null);
  assert.equal(locationLink({ latitude: 100, longitude: 0 }), null);
  assert.equal(locationLink({ latitude: 0, longitude: 0 }), 'https://www.google.com/maps/search/?api=1&query=0%2C0');
});
