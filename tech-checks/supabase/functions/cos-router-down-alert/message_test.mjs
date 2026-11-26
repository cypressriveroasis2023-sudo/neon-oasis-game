import test from 'node:test';
import assert from 'node:assert/strict';
import { pushPayload, readAlerts } from './message.ts';

test('push opens the unit on the board card', () => {
  const p = JSON.parse(pushPayload({ kind: 'down', unit: 'SPOTTER 100', title: 'Router down: SPOTTER 100', body: 'x' }, 2));
  assert.equal(p.url, './?fieldUnit=SPOTTER%20100'); assert.equal(p.kind, 'router_down'); assert.equal(p.badge_count, '2');
  const s = JSON.parse(pushPayload({ kind: 'down', unit: null, title: 'Routers down: 3 more', body: 'y' }, 1));
  assert.equal(s.url, './?fleetDashboard=1');
  const bad = JSON.parse(pushPayload({ kind: 'back', unit: 'A\u0000B', title: 't', body: 'b' }, 0));
  assert.equal(bad.url, './?fleetDashboard=1'); assert.equal(bad.kind, 'router_back'); assert.equal(bad.badge_count, '1');
});

test('alerts are read defensively', () => {
  assert.deepEqual(readAlerts(null), []);
  assert.deepEqual(readAlerts({ alerts: [{ kind: 'back', unit: 'U', title: 'T', body: 'B' }, { nope: 1 }, 5] }), [{ kind: 'back', unit: 'U', title: 'T', body: 'B' }]);
});
