import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

const EXAMPLE = 'EXAMPLE-SIM-0007';
const RETURN_ID = '00000000-0000-4000-8000-000000000001';
const ORG = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const IT = {legacy: '05bf20fe-19f7-4db7-ac05-5b2a5f681fdf', actor: 'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7', name: 'Test IT', role: 'it', code: 'it_technician'};
const OWNER = {legacy: 'e4abc521-1ef3-45a6-9829-b87faff78210', actor: '3f073784-96e7-43d8-b9e0-33ab31c3c8b1', name: 'Owner', role: 'owner', code: 'owner'};
const SERVICE = {legacy: '78e54fbd-c2db-4d18-8e3d-a9740adcf285', actor: '7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', name: 'Abel Cervantes', role: 'service', code: 'service_technician'};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
const record = () => ({productId: '900014', unit: 'SNIPER 014', outcome: 'canceled', carrier: 'Verizon', canceledOn: '2026-11-17', canceledBy: 'Example IT', confirmation: 'CONFIRM-EXAMPLE', simNumber: EXAMPLE, returnId: RETURN_ID});

function fixture(change = {}) {
  const user = change.user || IT;
  const calls = [];
  const handler = createOperationsHandler({
    platformUrl: change.platformUrl || 'https://native.example',
    serviceKey: 'synthetic-service',
    fetch: async (url, init = {}) => {
      calls.push({url, init});
      if (url.includes('/auth/v1/user')) return json({id: user.legacy});
      if (url.includes('/rest/v1/profiles?')) return json([{user_id: user.legacy, full_name: user.name, role: user.role, active: true, archived_at: null}]);
      if (url.includes('/rest/v1/user_profiles?')) return json([{user_id: user.actor, display_name: user.name, department: user.role, active: true}]);
      if (url.includes('/rest/v1/user_roles?')) return json([{roles: {code: user.code, organization_id: ORG}}]);
      if (url.endsWith('/rest/v1/cos_sim_cancel_records')) return change.insert || new Response(null, {status: 201});
      throw Error('Unexpected request');
    },
  });
  const invoke = body => handler(new Request('https://native.example/functions/v1/cos-operations-pages', {
    method: 'POST',
    headers: {Origin: 'https://cos-vision-integration-preview.pages.dev', Authorization: 'Bearer synthetic-session', 'Content-Type': 'application/json'},
    body: JSON.stringify({path: '/api/sim-cancel', method: 'POST', body}),
  }));
  return {calls, invoke};
}

function inserts(calls) {
  return calls.filter(call => call.url.includes('/rest/v1/cos_sim_cancel_records'));
}

test('an IT session writes the SIM row on Tech Check Platform and the reply stays generic', async () => {
  const f = fixture();
  const response = await f.invoke(record());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true});
  const saved = inserts(f.calls);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].url, 'https://native.example/rest/v1/cos_sim_cancel_records');
  assert.equal(saved[0].url.includes('goqrnolcvqnirjmzaeyk'), false);
  const row = JSON.parse(saved[0].init.body);
  assert.equal(row.recorded_by, IT.actor);
  assert.equal(row.return_id, RETURN_ID);
  assert.equal(row.sim_number.endsWith('0007'), true);
  assert.equal(row.sim_number.length > 4, true);
  assert.equal(f.calls.some(call => call.url.includes('cos_sim_cancel_records') && call.url.includes('goqrnolcvqnirjmzaeyk')), false);
});

test('a database error that repeats the SIM number is not returned', async () => {
  const leaked = fixture({insert: json({code: '42501', message: EXAMPLE, details: EXAMPLE}, 403)});
  const response = await leaked.invoke(record());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes(EXAMPLE), false);
  assert.match(text, /could not be saved/);
  const duplicate = fixture({insert: json({code: '23505', message: EXAMPLE, details: EXAMPLE}, 409)});
  const again = await duplicate.invoke(record());
  assert.equal(again.status, 200);
  assert.equal((await again.text()).includes(EXAMPLE), false);
});

test('the SIM insert refuses the Cameras On Site project, service accounts, and a missing number', async () => {
  const wrong = fixture({platformUrl: 'https://goqrnolcvqnirjmzaeyk.supabase.co'});
  const refused = await wrong.invoke(record());
  assert.equal(refused.status, 503);
  assert.equal((await refused.text()).includes(EXAMPLE), false);
  assert.equal(inserts(wrong.calls).length, 0);
  const service = fixture({user: SERVICE});
  assert.equal((await service.invoke(record())).status, 403);
  assert.equal(inserts(service.calls).length, 0);
  const owner = fixture({user: OWNER});
  assert.equal((await owner.invoke(record())).status, 200);
  assert.equal(JSON.parse(inserts(owner.calls)[0].init.body).recorded_by, OWNER.actor);
  const missing = fixture();
  const blocked = await missing.invoke({...record(), simNumber: ''});
  assert.equal(blocked.status, 400);
  assert.equal((await blocked.text()).includes(EXAMPLE), false);
  assert.equal(inserts(missing.calls).length, 0);
});
