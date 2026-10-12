import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsHandler } from '../../supabase/functions/cos-operations-pages/index.ts';

const org = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const identities = {
  owner: { legacy: 'e4abc521-1ef3-45a6-9829-b87faff78210', actor: '3f073784-96e7-43d8-b9e0-33ab31c3c8b1', department: 'owner', role: 'owner' },
  teddy: { legacy: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', actor: 'd0757b64-9623-4adc-afff-21cc7853e88a', department: 'it', role: 'it_technician', name: 'Teddy Hopper' },
  victor: { legacy: 'b7cc3cbf-d11e-4d4a-9742-c07701857911', actor: '3caf7c00-627f-445f-bce4-ddeae574ee5c', department: 'it', role: 'it_technician', name: 'Victor Garcia' },
  service: { legacy: '78e54fbd-c2db-4d18-8e3d-a9740adcf285', actor: '7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', department: 'service', role: 'service_technician', name: 'Abel Cervantes' },
  unlinked: { legacy: 'a0000000-0000-4000-8000-000000000001', department: 'owner', role: 'owner' },
};
function bridge(who, { active = true, roleActive = true } = {}) {
  const calls = [];
  const handler = createOperationsHandler({ platformUrl: 'https://native.example', serviceKey: 'synthetic-test-key', fetch: async (url) => {
    calls.push(url);
    const json = value => new Response(JSON.stringify(value), { status: 200 });
    if (url.includes('/auth/v1/user')) return json({ id: who.legacy });
    if (url.includes('/rest/v1/profiles?')) return json([{ user_id: who.legacy, full_name: who.name || 'Fixture', role: who.department, active, archived_at: null }]);
    if (url.includes('/rest/v1/user_profiles?')) return json([{ user_id: who.actor, display_name: who.name || 'Fixture', department: who.department, active }]);
    if (url.includes('/rest/v1/user_roles?')) return json(roleActive ? [{ role_id: 'b0000000-0000-4000-8000-000000000001', roles: { code: who.role, organization_id: org } }] : []);
    throw new Error('Unexpected transport: ' + url);
  } });
  const request = (path, method = 'GET') => handler(new Request('https://bridge.example', { method: 'POST', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json', Origin: 'https://cypressriveroasis2023-sudo.github.io' }, body: JSON.stringify({ path, method, body: null }) }));
  return { request, calls };
}

test('linked Owner advertises the Victron read already allowed by the backend', async () => {
  const f = bridge(identities.owner);
  const before = await f.request('/api/vrm-fleet');
  assert.equal(before.status, 200);
  assert.equal((await before.json()).items.length, 9);
  const response = await f.request('/api/session');
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.authorized, true);
  assert.equal(session.role, 'Owner');
  assert.equal(session.legacyOwner, true);
  assert.equal(session.features.vrmRead, true);
  assert.equal(session.productionOwnerUserId, identities.owner.actor);
  assert.equal(f.calls.some(url => /\/rpc\//.test(url)), false);
});

test('both exact verified IT identities retain saved Victron read and no refresh access', async () => {
  for (const who of [identities.teddy, identities.victor]) {
    const f = bridge(who);
    const session = await (await f.request('/api/session')).json();
    assert.equal(session.role, 'IT');
    assert.equal(session.features.vrmRead, true);
    assert.equal(session.features.fieldLocationVerification, false);
    assert.equal((await f.request('/api/vrm-fleet')).status, 200);
    assert.equal((await f.request('/api/vrm-fleet/refresh')).status, 403);
    assert.equal((await f.request('/api/vrm-fleet/refresh', 'POST')).status, 403);
  }
});

test('unlinked Owner, Service, inactive and revoked-role accounts gain no access', async () => {
  const unlinked = bridge(identities.unlinked);
  const session = await (await unlinked.request('/api/session')).json();
  assert.equal(session.authorized, false);
  assert.equal(session.features.vrmRead, false);
  assert.equal((await unlinked.request('/api/vrm-fleet')).status, 403);
  for (const f of [bridge(identities.service), bridge(identities.owner, { active: false }), bridge(identities.owner, { roleActive: false })]) {
    assert.equal((await f.request('/api/session')).status, 403);
    assert.equal((await f.request('/api/vrm-fleet')).status, 403);
  }
});
