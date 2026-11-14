import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandAddressLookup} from '../../supabase/functions/cos-hand-address-lookup/index.ts';
import {handAddressPoint} from '../../supabase/functions/cos-operations-pages/handAddressPoint.ts';

const KEY = 'synthetic-key-not-a-real-one';
const geoHit = (over = {}) => ({location: {lat: 29.8646, lng: -95.2614}, accuracy: 1, accuracy_type: 'rooftop', formatted_address: '20702 Hempstead Rd, Cypress, TX 77065', ...over});
const json = payload => new Response(JSON.stringify(payload), {status: 200, headers: {'content-type': 'application/json'}});
const ask = (body, {headers = {authorization: 'Bearer token'}, method = 'POST'} = {}) =>
  new Request('https://camera.example/functions/v1/cos-hand-address-lookup',
    {method, headers, ...(body === undefined || method === 'GET' ? {} : {body: JSON.stringify(body)})});

function service({allow = true, key = KEY, results = [geoHit()]} = {}) {
  if (key === 'none') key = undefined;
  const asked = [];
  return {asked, handler: createHandAddressLookup({
    verifyFleetActor: async authorization => { asked.push({authorization}); return allow; },
    geocodioApiKey: key,
    fetch: async url => { asked.push({url: new URL(url)}); return json({results}); },
  })};
}

test('an Owner or approved IT gets a point, and only the address is sent on', async () => {
  const s = service();
  const answer = await s.handler(ask({address: '20702 Hempstead Rd, Cypress, TX 77065'}));
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {status: 'success', reason: 'Pinned at the location the second address service has for this address.',
    latitude: 29.8646, longitude: -95.2614, provider: 'geocodio', matchedAddress: '20702 Hempstead Rd, Cypress, TX 77065'});
  const sent = s.asked.find(item => item.url);
  assert.deepEqual([...sent.url.searchParams.keys()].sort(), ['api_key', 'country', 'q']);
  assert.equal(sent.url.searchParams.get('q'), '20702 Hempstead Rd, Cypress, TX 77065');
});

test('anyone the fleet does not know is refused, and nothing is looked up', async () => {
  const s = service({allow: false});
  const answer = await s.handler(ask({address: '1 Main St'}));
  assert.equal(answer.status, 403);
  assert.match((await answer.json()).error, /Owner or approved IT/);
  assert.equal(s.asked.filter(item => item.url).length, 0);
});

test('a browser is refused outright: no origin is allowed and no CORS is offered', async () => {
  const s = service();
  const answer = await s.handler(ask({address: '1 Main St'}, {headers: {authorization: 'Bearer token', origin: 'https://cypressriveroasis2023-sudo.github.io'}}));
  assert.equal(answer.status, 403);
  assert.equal(answer.headers.get('access-control-allow-origin'), null);
  assert.equal(s.asked.length, 0);
});

test('only a POST carrying one plain address is accepted', async () => {
  const s = service();
  assert.equal((await s.handler(ask({address: '1 Main St'}, {method: 'GET'}))).status, 405);
  for (const body of [{}, {address: ''}, {address: '   '}, {address: 'x'.repeat(201)}, {address: 42}, {address: '1 Main St', unitKey: 'SPOTTER 306'}, []])
    assert.ok((await s.handler(ask(body))).status >= 400, JSON.stringify(body));
  assert.equal(s.asked.filter(item => item.url).length, 0);
});

test('a request far too large is refused before it is read in', async () => {
  const s = service();
  const answer = await s.handler(ask({address: 'x'.repeat(4000)}));
  assert.equal(answer.status, 413);
});

test('with no key on that project the answer says so and no pin is invented', async () => {
  for (const key of ['none', '', '   ', 'bad\nkey']) {
    const s = service({key});
    const answer = await s.handler(ask({address: '1 Main St'}));
    const found = await answer.json();
    assert.equal(found.status, 'provider_error', String(key));
    assert.equal(found.latitude, undefined);
  }
});

test('the hand edit uses the lookup when it has no key of its own', async () => {
  const census = async () => json({result: {addressMatches: []}});
  const calls = [];
  const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', census, null,
    async address => { calls.push(address); return {status: 'success', reason: 'Pinned.', latitude: 29.8646, longitude: -95.2614, provider: 'geocodio'}; });
  assert.deepEqual([found.status, found.latitude, calls], ['success', 29.8646, ['20702 Hempstead Rd, Cypress, TX 77065']]);
});

test('a lookup that fails or answers nonsense leaves the address saved with no pin', async () => {
  const census = async () => json({result: {addressMatches: []}});
  for (const lookup of [async () => { throw Error('down'); }, async () => ({status: 'nonsense'}), async () => null, async () => 'not an object']) {
    const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', census, null, lookup);
    // Either reason is fine; what matters is that no point is invented.
    assert.ok(['no_match', 'provider_error'].includes(found.status), found.status);
    assert.equal(found.latitude, undefined);
  }
});

test('a key configured on the Fleet project is used directly and the lookup is left alone', async () => {
  const calls = [];
  const transport = async url => new URL(url).hostname === 'geocoding.geo.census.gov'
    ? json({result: {addressMatches: []}}) : json({results: [geoHit()]});
  const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', transport, KEY,
    async () => { calls.push('asked'); return {status: 'no_match', reason: 'no'}; });
  assert.deepEqual([found.status, found.provider, calls], ['success', 'geocodio', []]);
});
