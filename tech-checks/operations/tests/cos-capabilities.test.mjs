import test from 'node:test';
import assert from 'node:assert/strict';
import {can, canOpenWorkspace, capabilities, signedIn, unavailableBecause, EQUIPMENT_CAPABILITIES, OWNER_CAPABILITIES}
  from '../src/cosCapabilities.ts';

// What the deployed function actually hands an IT/fleet session today.
const LIVE_FLEET_FEATURES = {
  durableFleetBoard: true, unitTracker: true, fleetAccess: true, vrmRead: true,
  fleetPlacementEdit: true, fleetConnectionEdit: true, cameraHealthV2: true,
  fieldLocationVerification: false, mhelpTicketImport: false, deliveryGoBack: false,
};
const it = {authorized: true, role: 'IT', legacyOwner: false, features: LIVE_FLEET_FEATURES};
const owner = {authorized: true, role: 'Owner', legacyOwner: true, features: {
  ...LIVE_FLEET_FEATURES, fieldLocationVerification: true, mhelpTicketImport: true, ownerIdentityReview: true}};

test('a signed-out or unknown visitor can do nothing', () => {
  for (const session of [null, undefined, {}, {authorized: false, role: 'Owner'}, {authorized: true, role: 'Customer'}]) {
    assert.equal(signedIn(session), false, JSON.stringify(session));
    for (const name of [...EQUIPMENT_CAPABILITIES, ...OWNER_CAPABILITIES]) assert.equal(can(session, name), false);
  }
});

// James's rule: he and IT both see every camera and every stand, and can fix,
// change or correct them anytime. Equipment is where the two roles are equal.
test('IT can do everything the owner can with a stand or a camera', () => {
  for (const name of EQUIPMENT_CAPABILITIES) {
    assert.equal(can(it, name), can(owner, name), name + ' must be the same for both');
    assert.equal(can(it, name), true, name + ' must be available to IT');
  }
});

test('management and record authority stay with the owner', () => {
  for (const name of OWNER_CAPABILITIES) {
    assert.equal(can(owner, name), true, name);
    assert.equal(can(it, name), false, name);
  }
});

// The app may narrow what the server granted. It may never widen it: a control
// the server will refuse is worse than no control, because the person finds out
// only after doing the work.
test('a capability the server withheld is never offered', () => {
  const withheld = {...it, features: {...LIVE_FLEET_FEATURES, fleetPlacementEdit: false, vrmRead: false, unitTracker: false, fleetConnectionEdit: false}};
  assert.equal(can(withheld, 'equipment.placement'), false);
  assert.equal(can(withheld, 'equipment.publicIp'), false);
  assert.equal(can(withheld, 'equipment.power'), false);
  assert.equal(can(withheld, 'equipment.tracker'), false);
  // What needs no server grant is unaffected.
  assert.equal(can(withheld, 'equipment.see'), true);
  assert.equal(can(withheld, 'equipment.address'), true);
});

test('an owner whose legacy link is gone is not treated as an owner', () => {
  const demoted = {...owner, legacyOwner: false};
  for (const name of OWNER_CAPABILITIES) assert.equal(can(demoted, name), false, name);
  assert.equal(can(demoted, 'equipment.see'), true, 'equipment is unaffected');
});

test('every capability is answered, and the two lists do not overlap', () => {
  const all = capabilities(it);
  for (const name of [...EQUIPMENT_CAPABILITIES, ...OWNER_CAPABILITIES]) assert.equal(typeof all[name], 'boolean', name);
  assert.equal(Object.keys(all).length, EQUIPMENT_CAPABILITIES.length + OWNER_CAPABILITIES.length);
  for (const name of EQUIPMENT_CAPABILITIES) assert.ok(!OWNER_CAPABILITIES.includes(name), name);
});

// One app, one nav. A workspace is absent because the person cannot use it,
// never because they signed in as the wrong kind of person.
test('a tech reaches every equipment workspace, and no management one', () => {
  for (const workspace of ['Fleet Dashboard','Camera Health','Units On Hand','Equipment',
    'InHand Routers','Victron VRM','Unit Tracker','Tech Check','Handoffs','Operations']) {
    assert.equal(canOpenWorkspace(it, workspace), true, workspace + ' must be open to IT');
    assert.equal(canOpenWorkspace(owner, workspace), true, workspace + ' must be open to the owner');
  }
  for (const workspace of ['Daily Board','Today','Team','Owner Tasks','MHelp','Billing','Customers','Jobs']) {
    assert.equal(canOpenWorkspace(it, workspace), false, workspace + ' must stay with the owner');
    assert.equal(canOpenWorkspace(owner, workspace), true, workspace);
  }
});

test('an unknown workspace is treated as management, not waved through', () => {
  assert.equal(canOpenWorkspace(it, 'Something Invented Later'), false);
});

// A control that is simply missing teaches nobody anything.
test('a refusal says who to ask', () => {
  assert.equal(unavailableBecause(owner, 'equipment.see'), null, 'nothing to explain when it is allowed');
  assert.match(unavailableBecause(it, 'owner.boards'), /owner/i);
  assert.match(unavailableBecause(null, 'equipment.see'), /sign in/i);
  assert.match(unavailableBecause({...it, features: {}}, 'equipment.placement'), /granted|owner can turn it on/i);
});
