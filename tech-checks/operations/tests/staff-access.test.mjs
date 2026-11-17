import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accountPath, denyStaffRoute, staffRole} from '../../supabase/functions/cos-operations-pages/staffAccess.ts';

test('the three roles come from the existing account role', () => {
  assert.equal(staffRole({role: 'Owner', legacyOwner: true}), 'owner');
  assert.equal(staffRole({role: 'IT', legacyOwner: false}), 'it');
  assert.equal(staffRole({department: 'service', legacyOwner: false}), 'service');
});

test('a service tech cannot reach admin data or actions', () => {
  assert.equal(denyStaffRoute('service', 'GET', '/api/session'), null);
  assert.equal(denyStaffRoute('service', 'GET', '/api/fleet-saved-board'), null);
  assert.equal(denyStaffRoute('service', 'GET', '/api/users'), 'Account, password, and security changes stay with the owner.');
  assert.match(denyStaffRoute('service', 'POST', '/api/fleet/units/abc/shop-placement') || '', /inventory list/);
  assert.equal(denyStaffRoute('service', 'GET', '/api/camera-health/summary-v3'), null);
  assert.equal(denyStaffRoute('service', 'POST', '/api/fleet-saved-board/refresh'), null);
  assert.match(denyStaffRoute('service', 'GET', '/api/jobs') || '', /inventory list/);
  assert.match(denyStaffRoute('service', 'GET', '/api/team-production') || '', /inventory list/);
  assert.match(denyStaffRoute('service', 'POST', '/api/unit-camera-status/edit') || '', /inventory list/);
  assert.match(denyStaffRoute('service', 'POST', '/api/account/password') || '', /owner/);
});

test('IT cannot change account, password, or security settings', () => {
  for (const path of ['/api/account', '/api/account/password', '/api/users/1', '/api/roles', '/api/security', '/api/auth/settings']) {
    assert.equal(accountPath(path), true);
    assert.match(denyStaffRoute('it', 'POST', path) || '', /owner/);
  }
  assert.equal(denyStaffRoute('it', 'GET', '/api/fleet-saved-board'), null);
  assert.equal(denyStaffRoute('it', 'GET', '/api/field-map'), null);
});

test('the owner is not refused by this extra rule', () => {
  assert.equal(denyStaffRoute('owner', 'POST', '/api/account/password'), null);
  assert.equal(denyStaffRoute('owner', 'POST', '/api/fleet/units/abc/shop-placement'), null);
});

test('the edge function applies the refusal without removing the owner gate', () => {
  const source = readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts', import.meta.url), 'utf8');
  const denyAt = source.indexOf('denyStaffRoute(');
  const ownerAt = source.indexOf("fail('An active COS Owner account is required.', 403)");
  assert.ok(denyAt > 0 && ownerAt > denyAt);
  const sql = readFileSync(new URL('../../supabase/migrations/20261117_cos_staff_role_limits.sql', import.meta.url), 'utf8');
  assert.match(sql, /as restrictive/);
  assert.match(sql, /department = 'owner'/);
  assert.doesNotMatch(sql, /update public\.user_profiles set/i);
});
