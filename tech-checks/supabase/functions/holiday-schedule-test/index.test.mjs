import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'index.ts'), 'utf8');
const DISABLED = {
  ok: false,
  error: 'holiday-schedule-test is disabled; it may not write camera schedules',
};
const SYNTHETIC_CONFIRM = 'synthetic-confirm-phrase';
const PLAN_PATH = '/LAPI/V1.0/Channel/0/Plan/WeekPlan/IntrosionZone';

function sealedRequest(method, body) {
  const init = body === undefined ? {method} : {method, body};
  const request = new Request('https://example.invalid/functions/v1/holiday-schedule-test', init);
  return new Proxy(request, {
    get(target, prop, receiver) {
      if (prop === 'headers' || prop === 'json' || prop === 'text' || prop === 'arrayBuffer' || prop === 'formData' || prop === 'blob') {
        throw new Error(`handler read request.${String(prop)}`);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('entrypoint ships no camera client, guard, secret read, or database write', () => {
  assert.deepEqual(readdirSync(here).sort(), ['index.test.mjs', 'index.ts']);
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.doesNotMatch(source, /^\s*export\s+(?:type\s+)?(?:\*\s+as\s+[A-Za-z_$][\w$]*|\*|\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\b/m);
  assert.doesNotMatch(source, /\bfetch\b/);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(source, /\bWebSocket\b/);
  assert.doesNotMatch(source, /Deno\.env/);
  assert.doesNotMatch(source, /Deno\.connectTls/);
  assert.doesNotMatch(source, /Deno\.connect\b/);
  assert.doesNotMatch(source, /Deno\.Command/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /supabase/i);
  assert.doesNotMatch(source, /\bALLOWED\b/);
  assert.match(source, /Deno\.serve\(handleHolidayScheduleTest\)/);
});

test('every method returns 410, including a confirm phrase, and never calls fetch', async () => {
  assert.equal(typeof globalThis.Deno, 'undefined');
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    calls.push('called');
    throw new Error('fetch was called');
  };
  try {
    const {handleHolidayScheduleTest} = await import('./index.ts');
    const cases = [
      ['GET', undefined],
      ['GET', SYNTHETIC_CONFIRM],
      ['POST', undefined],
      ['POST', ''],
      ['POST', SYNTHETIC_CONFIRM],
      ['POST', JSON.stringify({confirm: SYNTHETIC_CONFIRM})],
      ['PUT', undefined],
      ['PUT', ''],
      ['PUT', SYNTHETIC_CONFIRM],
      ['PUT', JSON.stringify({confirm: SYNTHETIC_CONFIRM, path: PLAN_PATH, host: 'camera.example.invalid'})],
      ['PUT', JSON.stringify({method: 'PUT', url: `https://camera.example.invalid${PLAN_PATH}`})],
      ['OPTIONS', undefined],
      ['OPTIONS', ''],
      ['OPTIONS', SYNTHETIC_CONFIRM],
      ['HEAD', undefined],
      ['PATCH', undefined],
      ['PATCH', ''],
      ['PATCH', SYNTHETIC_CONFIRM],
      ['PATCH', JSON.stringify({confirm: SYNTHETIC_CONFIRM})],
      ['DELETE', undefined],
      ['DELETE', ''],
      ['DELETE', SYNTHETIC_CONFIRM],
      ['DELETE', JSON.stringify({confirm: SYNTHETIC_CONFIRM, path: PLAN_PATH, host: 'camera.example.invalid'})],
    ];
    for (const [method, body] of cases) {
      const request = method === 'GET' && body !== undefined
        ? {method, body, url: 'https://example.invalid/functions/v1/holiday-schedule-test'}
        : sealedRequest(method, body);
      const response = await handleHolidayScheduleTest(request);
      assert.equal(response.status, 410, method);
      assert.deepEqual(calls, []);
      if (method === 'HEAD') continue;
      const text = await response.text();
      assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.equal(text, JSON.stringify(DISABLED));
      assert.deepEqual(JSON.parse(text), DISABLED);
    }
  } finally {
    globalThis.fetch = original;
  }
});
