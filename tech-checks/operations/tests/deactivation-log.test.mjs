import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeactivationLog, cleanRow, EMAIL} from '../../supabase/functions/cos-deactivation-log/index.ts';

// Operations: the one function that writes the cancellation sheet, as the COS service account.
const account = JSON.stringify({type: 'service_account', client_email: EMAIL, private_key: 'KEY', private_key_id: 'kid12345'});
function make({verify = true, google = 200, url = 'https://tughscoxralhofrckvxy.supabase.co'} = {}) {
  const seen = [];
  const handler = createDeactivationLog({getEnv: n => ({COS_GOOGLE_SERVICE_ACCOUNT_JSON: account, SUPABASE_URL: url})[n], sign: async () => 'signed', verify: async s => verify && s === 'cron-secret',
    fetch: async (u, init) => { seen.push({url: String(u), body: init?.body}); const j = (status, body) => ({ok: status < 300, status, json: async () => body});
      if (String(u).includes('oauth2')) return j(200, {access_token: 'sa-token'});
      if (init?.method === 'POST') return j(google, {updates: {updatedRange: "'Deactivation History'!A301:I301"}});
      return j(google, {sheets: [{properties: {title: 'Deactivation History'}}]}); }});
  const post = async (body, secret = 'cron-secret') => { const r = await handler(new Request('https://x', {method: 'POST', headers: {'x-camera-cron-secret': secret}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
  return {post, seen};
}
const ROW = ['11/25/2026', 'Blazer', 'Spotter 268', 'Clayton', '22703', '', 'EMAILED SIMETRY 11/25/2026', '', ''];

test('only a caller with the cron secret, and only in the Operations project', async () => {
  assert.equal((await make().post({action: 'check'}, 'wrong')).status, 403);
  assert.equal((await make({verify: false}).post({action: 'check'})).status, 403);
  assert.equal((await make({url: 'https://elsewhere.supabase.co'}).post({action: 'check'})).status, 503);
});

test('check says whether the sheet and its tab open; append adds exactly one row', async () => {
  assert.deepEqual((await make().post({action: 'check'})).body, {sheet_opens: true, tab_found: true, status: 200});
  assert.equal((await make({google: 403}).post({action: 'check'})).body.sheet_opens, false);
  const m = make();
  const r = await m.post({action: 'append', row: ROW});
  assert.deepEqual(r.body, {ok: true, range: 'A301:I301'});
  const call = m.seen.find(x => x.url.includes(':append'));
  assert.match(call.url, /Deactivation%20History'!A%3AI/);
  assert.deepEqual(JSON.parse(call.body), {values: [ROW]});
  assert.deepEqual((await make({google: 403}).post({action: 'append', row: ROW})).body, {ok: false, status: 403});
});

test('a row is plain text in nine cells, never a formula', () => {
  assert.deepEqual(cleanRow(ROW), ROW);
  assert.equal(cleanRow(ROW.slice(1)), null);
  assert.equal(cleanRow(['=1+1', ...ROW.slice(1)]), null);
  assert.equal(cleanRow([...ROW.slice(0, 8), '@x']), null);
  assert.equal(cleanRow([...ROW.slice(0, 8), 'a\nb']), null);
  assert.deepEqual(cleanRow(["'=HYPERLINK(1)", ...ROW.slice(1)])[0], "'=HYPERLINK(1)");
});
