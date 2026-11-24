// Run: node --experimental-strip-types --test tech-checks/supabase/functions/inhand-router-status-pull/pull_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pullInhand, readingOf, PullError, INHAND_ORIGIN } from './pull.ts';

const CONFIG = { result: { auth: { clientId: 17953450251798, clientSecret: 'cs' } } };
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status });

function harness({ env = {}, session = null, routes }) {
  const calls = [];
  const saved = [];
  let cleared = 0;
  const deps = {
    env: (n) => env[n],
    now: () => new Date('2026-11-24T14:00:00Z'),
    loadSession: async () => session,
    saveSession: async (t) => { saved.push(t); },
    clearSession: async () => { cleared++; },
    fetch: async (url, init) => {
      const path = url.slice(INHAND_ORIGIN.length);
      assert.ok(url.startsWith(INHAND_ORIGIN + '/'), 'only InHand is contacted');
      assert.notEqual(init.method, 'PUT'); assert.notEqual(init.method, 'DELETE');
      calls.push({ path, init });
      return routes(path, init, calls.length);
    },
  };
  return { deps, calls, saved, get cleared() { return cleared; } };
}

const devices = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ serialNumber: 'rf3' + String(100000 + offset + i), online: (offset + i) % 2 }));

test('refresh sign-in, three pages, readings normalized', async () => {
  const h = harness({
    session: { access_token: null, access_expires_at: null, refresh_token: 'stored-refresh-1' },
    routes: (path, init) => {
      if (path === '/api/platform/config') return ok(CONFIG);
      if (path === '/oauth2/access_token') {
        const form = new URLSearchParams(init.body);
        assert.equal(form.get('grant_type'), 'refresh_token');
        assert.equal(form.get('client_id'), '17953450251798');
        return ok({ access_token: 'a'.repeat(32), refresh_token: 'r'.repeat(32), expires_in: 7200 });
      }
      const q = new URLSearchParams(path.split('?')[1]);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer ' + 'a'.repeat(32));
      const cursor = Number(q.get('cursor'));
      return ok({ result: cursor < 200 ? devices(100, cursor) : devices(40, cursor), total: 240 });
    },
  });
  const out = await pullInhand(h.deps);
  assert.equal(out.seen, 240);
  assert.equal(out.readings.length, 240);
  assert.equal(out.readings[0].serial, 'RF3100000');
  assert.equal(out.observedAt, '2026-11-24T14:00:00.000Z');
  assert.equal(h.saved.length, 1);
});

test('cached session is reused and nothing signs in', async () => {
  const h = harness({
    session: { access_token: 'c'.repeat(32), access_expires_at: '2026-11-24T15:00:00Z', refresh_token: null },
    routes: (path) => { assert.ok(path.startsWith('/api/devices')); return ok({ result: devices(3) }); },
  });
  const out = await pullInhand(h.deps);
  assert.equal(out.readings.length, 3);
  assert.equal(h.calls.length, 1);
});

test('expired cached token is refreshed with the stored refresh token', async () => {
  const grants = [];
  const h = harness({
    session: { access_token: 'c'.repeat(32), access_expires_at: '2026-11-24T13:00:00Z', refresh_token: 'old-refresh-token' },
    routes: (path, init) => {
      if (path === '/api/platform/config') return ok(CONFIG);
      if (path === '/oauth2/access_token') { grants.push(new URLSearchParams(init.body).get('grant_type')); return ok({ access_token: 'n'.repeat(32), expires_in: 3600 }); }
      return ok({ result: devices(1) });
    },
  });
  await pullInhand(h.deps);
  assert.deepEqual(grants, ['refresh_token']);
});

test('a refused cached token gets exactly one fresh sign-in', async () => {
  let deviceCalls = 0;
  const h = harness({
    session: { access_token: 'c'.repeat(32), access_expires_at: '2026-11-24T15:00:00Z', refresh_token: 'stored-refresh-1' },
    routes: (path) => {
      if (path === '/api/platform/config') return ok(CONFIG);
      if (path === '/oauth2/access_token') return ok({ access_token: 'n'.repeat(32) });
      deviceCalls++;
      return deviceCalls === 1 ? ok({}, 401) : ok({ result: devices(2) });
    },
  });
  const out = await pullInhand(h.deps);
  assert.equal(out.readings.length, 2);
  assert.equal(deviceCalls, 2);
});

test('nothing configured fails clearly without contacting InHand', async () => {
  const h = harness({ routes: () => { throw new Error('should not be called'); } });
  await assert.rejects(pullInhand(h.deps), (e) => e instanceof PullError && e.code === 'not_configured');
  assert.equal(h.calls.length, 0);
});

test('rejected sign-in clears the saved session and reports sign_in_rejected', async () => {
  const h = harness({
    session: { access_token: null, access_expires_at: null, refresh_token: 'revoked-refresh' },
    routes: (path) => path === '/api/platform/config' ? ok(CONFIG) : ok({ error: 'invalid_grant' }, 400),
  });
  await assert.rejects(pullInhand(h.deps), (e) => e.code === 'sign_in_rejected');
  assert.equal(h.cleared, 1);
});

test('unexpected device response shape is refused, not guessed', async () => {
  const h = harness({
    session: { access_token: 'c'.repeat(32), access_expires_at: '2026-11-24T15:00:00Z' },
    routes: () => ok({ result: { something: 'else' } }),
  });
  await assert.rejects(pullInhand(h.deps), (e) => e.code === 'devices_unexpected');
});

test('readingOf only accepts a clear online flag and a plain serial', () => {
  assert.deepEqual(readingOf({ serialNumber: ' rf3152533024049 ', online: 1 }), { serial: 'RF3152533024049', online: 1 });
  assert.deepEqual(readingOf({ serialNumber: 'RF31', online: 0 }), null);
  assert.deepEqual(readingOf({ serialNumber: 'RF3152533024049', online: 'yes' }), null);
  assert.deepEqual(readingOf({ serialNumber: 'RF3152533024049' }), null);
  assert.deepEqual(readingOf({ serialNumber: 'RF315; drop table', online: 1 }), null);
});

test('a rejected refresh records only InHand\'s status and error code', async () => {
  const h = harness({
    session: { access_token: null, access_expires_at: null, refresh_token: 'revoked-refresh-SECRET' },
    routes: (path) => path === '/api/platform/config' ? ok(CONFIG) : ok({ error: 'invalid_grant', error_description: 'revoked-refresh-SECRET' }, 400),
  });
  await assert.rejects(pullInhand(h.deps), (e) => e.code === 'sign_in_rejected' && e.detail === 'refresh 400:invalid_grant' && !/secret/i.test(e.detail));
});

test('password secrets alone are not used (InHand refuses password sign-in)', async () => {
  const h = harness({ env: { INHAND_USERNAME: 'u', INHAND_PASSWORD: 'p' }, routes: () => { throw new Error('should not be called'); } });
  await assert.rejects(pullInhand(h.deps), (e) => e.code === 'not_configured');
  assert.equal(h.calls.length, 0);
});

test('connect: code is exchanged with the same redirect address and the session saved', async () => {
  const { exchangeCode } = await import('./pull.ts');
  const h = harness({
    routes: (path, init) => {
      if (path === '/api/platform/config') return ok(CONFIG);
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'abc123');
      assert.equal(form.get('redirect_uri'), 'https://x.supabase.co/functions/v1/inhand-router-status-pull/callback');
      return ok({ access_token: 'a'.repeat(32), refresh_token: 'r'.repeat(32), expires_in: 7200 });
    },
  });
  await exchangeCode(h.deps, 'abc123', 'https://x.supabase.co/functions/v1/inhand-router-status-pull/callback');
  assert.equal(h.saved.length, 1);
  await assert.rejects(exchangeCode(h.deps, 'bad code<script>', 'x'), (e) => e.code === 'sign_in_rejected');
});

test('landed address: only localhost /callback with code and a COS state', async () => {
  const { parseLandedAddress } = await import('./pull.ts');
  const st = 'cos_' + 'a'.repeat(36);
  assert.deepEqual(parseLandedAddress(`http://localhost:8765/callback?code=XYZ&state=${st}`), { redirectUri: 'http://localhost:8765/callback', code: 'XYZ', state: st });
  assert.deepEqual(parseLandedAddress(` http://127.0.0.1:9000/callback?state=${st}&code=Q `)?.redirectUri, 'http://127.0.0.1:9000/callback');
  assert.equal(parseLandedAddress(`https://evil.example/callback?code=XYZ&state=${st}`), null);
  assert.equal(parseLandedAddress(`http://localhost:8765/other?code=XYZ&state=${st}`), null);
  assert.equal(parseLandedAddress(`http://localhost/callback?code=XYZ&state=${st}`), null);
  assert.equal(parseLandedAddress(`http://localhost:8765/callback?state=${st}`), null);
  assert.equal(parseLandedAddress('not a url'), null);
});

test('a 20-digit clientId is sent exactly, not rounded', async () => {
  const { oauthClient } = await import('./pull.ts');
  const raw = '{"result":{"auth":{"clientId":17953450251798098136,"clientSecret":"cs"}}}';
  const h = harness({ routes: () => new Response(raw, { status: 200 }) });
  const client = await oauthClient(h.deps);
  assert.equal(client.id, '17953450251798098136');
  const quoted = harness({ routes: () => new Response('{"result":{"auth":{"clientId":"abc-123_X","clientSecret":"cs"}}}', { status: 200 }) });
  assert.equal((await oauthClient(quoted.deps)).id, 'abc-123_X');
});
