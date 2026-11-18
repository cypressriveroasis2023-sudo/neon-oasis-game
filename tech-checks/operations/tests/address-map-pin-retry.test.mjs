import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAddressMapPin} from '../src/addressMapPinRetry.ts';

const address = '2850 Twinwood Pkwy, Brookshire, TX 77423';

function census(status, body) {
  return async () => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

test('the second lookup can pin a map point after Census misses, without a write', async () => {
  const writes = [];
  const fetch = census(200, {result: {addressMatches: []}});
  const result = await retryAddressMapPin(address, {
    fetch,
    second: async () => ({status: 'success', reason: 'pinned', latitude: 29.8, longitude: -95.7, matchedAddress: address}),
  });
  assert.deepEqual(result.pin, [29.8, -95.7]);
  assert.equal(result.bothFailed, false);
  assert.deepEqual(writes, []);
});

test('both lookups failing is the only time the address is a fix-in-mHelp case', async () => {
  const result = await retryAddressMapPin(address, {
    fetch: census(200, {result: {addressMatches: []}}),
    second: async () => ({status: 'no_match', reason: 'none'}),
  });
  assert.equal(result.pin, null);
  assert.equal(result.bothFailed, true);
});
