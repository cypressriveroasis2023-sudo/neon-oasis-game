import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handAddressPoint, geocodioPoint, metresApart, SAME_PLACE_METRES} from '../../supabase/functions/cos-operations-pages/handAddressPoint.ts';

const KEY = 'synthetic-key-not-a-real-one';
const body = payload => new Response(JSON.stringify(payload), {status: 200, headers: {'content-type': 'application/json'}});
const census = matches => ({result: {addressMatches: matches}});
const censusHit = {coordinates: {y: 29.78, x: -95.53}, matchedAddress: '9500 KATY FWY, HOUSTON, TX, 77024'};
const geoHit = (over = {}) => ({location: {lat: 29.8646, lng: -95.2614}, accuracy: 1, accuracy_type: 'rooftop', formatted_address: '20702 Hempstead Rd, Cypress, TX 77065', ...over});

function transport(responses) {
  const asked = [];
  return {asked, fetch: async url => {
    const parsed = new URL(url);
    asked.push(parsed);
    const answer = responses[parsed.hostname];
    if (!answer) throw Error('Unexpected host ' + parsed.hostname);
    return typeof answer === 'function' ? answer(parsed) : answer();
  }};
}

test('the Census answer is used and the second service is never asked', async () => {
  const t = transport({'geocoding.geo.census.gov': () => body(census([censusHit]))});
  const found = await handAddressPoint('9500 Katy Fwy, Houston, TX 77024', t.fetch, KEY);
  assert.deepEqual([found.status, found.provider, found.latitude], ['success', 'census', 29.78]);
  assert.deepEqual(t.asked.map(u => u.hostname), ['geocoding.geo.census.gov']);
});

test('an address the Census file lacks is placed by the second service', async () => {
  const t = transport({'geocoding.geo.census.gov': () => body(census([])), 'api.geocod.io': () => body({results: [geoHit()]})});
  const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', t.fetch, KEY);
  assert.deepEqual([found.status, found.provider, found.latitude, found.longitude], ['success', 'geocodio', 29.8646, -95.2614]);
  assert.equal(found.matchedAddress, '20702 Hempstead Rd, Cypress, TX 77065');
  assert.deepEqual(t.asked.map(u => u.hostname), ['geocoding.geo.census.gov', 'api.geocod.io']);
});

test('only the address and the key are sent to the second service', async () => {
  const t = transport({'geocoding.geo.census.gov': () => body(census([])), 'api.geocod.io': () => body({results: [geoHit()]})});
  await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', t.fetch, KEY);
  const asked = t.asked[1];
  // The key COS holds is granted the v2.1 geocode endpoint only, so the
  // request has to go there; an older path would be refused and read as an
  // address that simply could not be placed.
  assert.equal(asked.pathname, '/v2.1/geocode');
  assert.deepEqual([...asked.searchParams.keys()].sort(), ['api_key', 'country', 'q']);
  assert.equal(asked.searchParams.get('q'), '20702 Hempstead Rd, Cypress, TX 77065');
});

test('with no key configured nothing is asked of the second service', async () => {
  for (const key of [undefined, null, '', '   ', 'bad\nkey']) {
    const t = transport({'geocoding.geo.census.gov': () => body(census([]))});
    const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', t.fetch, key);
    assert.equal(found.status, 'no_match', String(key));
    assert.deepEqual(t.asked.map(u => u.hostname), ['geocoding.geo.census.gov']);
  }
});

test('a guessed or unusable second-service answer is refused rather than pinned', async () => {
  for (const results of [[geoHit({accuracy: 0.5})], [geoHit({accuracy: null})], [geoHit({location: {lat: 0, lng: 0}})],
    [geoHit({location: {lat: 'x', lng: -95}})], [geoHit({location: null})], []]) {
    const t = transport({'geocoding.geo.census.gov': () => body(census([])), 'api.geocod.io': () => body({results})});
    const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', t.fetch, KEY);
    assert.equal(found.status, 'no_match', JSON.stringify(results));
    assert.equal(found.latitude, undefined);
  }
});

test('several spellings of one place still pin; two real places do not', async () => {
  const near = geoHit({location: {lat: 29.8647, lng: -95.2615}, formatted_address: '20702 Hempstead Road, Cypress, TX'});
  const far = geoHit({location: {lat: 30.1, lng: -95.9}});
  assert.ok(metresApart([29.8646, -95.2614], [29.8647, -95.2615]) < SAME_PLACE_METRES);
  const same = transport({'geocoding.geo.census.gov': () => body(census([])), 'api.geocod.io': () => body({results: [geoHit(), near]})});
  assert.equal((await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', same.fetch, KEY)).status, 'success');
  const two = transport({'geocoding.geo.census.gov': () => body(census([])), 'api.geocod.io': () => body({results: [geoHit(), far]})});
  const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', two.fetch, KEY);
  assert.equal(found.status, 'no_match');
  assert.match(found.reason, /more than one place/);
});

test('an unreachable or broken second service leaves the Census reason, never a pin', async () => {
  for (const answer of [() => new Response('nope', {status: 500}), () => body({results: 'not a list'}), () => {throw Error('down');}]) {
    const t = transport({'geocoding.geo.census.gov': () => body(census([])), 'api.geocod.io': answer});
    const found = await handAddressPoint('20702 Hempstead Rd, Cypress, TX 77065', t.fetch, KEY);
    assert.equal(found.status, 'no_match');
    assert.match(found.reason, /could not find that address/);
    assert.equal(found.latitude, undefined);
  }
});

test('a refused address never reaches either service', async () => {
  const t = transport({});
  for (const value of ['', '   ', 'x'.repeat(201), 'gate code 1234', 'http://example.com/a', 'a@b.com', 42, null]) {
    const found = await handAddressPoint(value, t.fetch, KEY);
    assert.equal(found.status, 'invalid_address', String(value));
  }
  assert.deepEqual(t.asked, []);
});

test('the second service can be asked on its own and reports its own trouble', async () => {
  const t = transport({'api.geocod.io': () => new Response('slow', {status: 503})});
  const found = await geocodioPoint('20702 Hempstead Rd, Cypress, TX 77065', KEY, t.fetch);
  assert.equal(found.status, 'provider_error');
  assert.equal(found.latitude, undefined);
});
