import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInhandPilotControl, inhandPilotControlState, parseInhandPilotResult } from '../shared/inhandPilot.ts';
import { pilotControl, pilotSnapshot } from './fixtures/inhand-pilot.mjs';
const parseResult = value => parseInhandPilotResult(value, parseInhandPilotControl(pilotControl()).device);
const rejected = (parser, value) => assert.throws(() => parser(value), /unsupported response/);
test('control parser validates authenticated identity shape and projects away extras', () => {
  const value = { ...pilotControl(), secret: 'DO_NOT_COPY', device: { ...pilotControl().device, account: 'DO_NOT_COPY' } };
  assert.deepEqual(parseInhandPilotControl(value), pilotControl());
  assert.equal(JSON.stringify(parseInhandPilotControl(value)).includes('DO_NOT_COPY'), false);
  for (const patch of [{ source: 'other' }, { version: 2 }, { pilotId: 'other' }, { state: ['ready'] }, { state: 'other' }, { state: null }, { device: { ...value.device, id: 'other' } }, { device: { ...value.device, serialNumber: 'other' } }, { device: { ...value.device, name: 'other' } }]) rejected(parseInhandPilotControl, { ...value, ...patch });
});
test('result identity must exactly match the authenticated status device, without a hardcoded public identity', () => {
  const response = pilotControl();
  response.device.id = '222222222222222222222222'; response.device.serialNumber = 'SYNTHETIC000002';
  const parsed = parseInhandPilotControl(response);
  assert.equal(parsed.device.id, response.device.id); assert.equal(parsed.device.serialNumber, response.device.serialNumber);
  rejected(value => parseInhandPilotResult(value, parsed.device), pilotSnapshot());
  const matched = pilotSnapshot(); matched.identity.deviceId = parsed.device.id; matched.identity.serialNumber = parsed.device.serialNumber;
  assert.deepEqual(parseInhandPilotResult(matched, parsed.device).identity, matched.identity);
  for (const patch of [{ deviceId: '111111111111111111111111' }, { serialNumber: 'SYNTHETIC000001' }]) rejected(value => parseInhandPilotResult(value, parsed.device), { ...matched, identity: { ...matched.identity, ...patch } });
  for (const expected of [undefined, null, {}, { ...parsed.device, id: 'bad' }, { ...parsed.device, serialNumber: 'bad' }]) rejected(value => parseInhandPilotResult(value, expected), matched);
});
test('control identity shape rejects missing, unbounded, control characters, and non-string identifiers', () => {
  for (const id of [null, undefined, 123, '', 'f'.repeat(23), 'g'.repeat(24), 'f'.repeat(25), ['111111111111111111111111']]) rejected(parseInhandPilotControl, { ...pilotControl(), device: { ...pilotControl().device, id } });
  for (const serialNumber of [null, undefined, 123, '', 'SHORT', 'x'.repeat(65), 'SYNTHETIC\n0001', ['SYNTHETIC000001']]) rejected(parseInhandPilotControl, { ...pilotControl(), device: { ...pilotControl().device, serialNumber } });
});
test('control state gates with server time and elapsed GET time, never device wall clock', () => {
  const ready = parseInhandPilotControl(pilotControl());
  assert.equal(inhandPilotControlState(ready), 'ready');
  assert.equal(inhandPilotControlState(ready, 600000), 'expired');
  for (const elapsed of [NaN, Infinity, -1]) assert.equal(inhandPilotControlState(ready, elapsed), 'expired');
  for (const state of ['unarmed', 'expired', 'consumed']) assert.equal(inhandPilotControlState(parseInhandPilotControl(pilotControl(state))), state);
  assert.equal(inhandPilotControlState(parseInhandPilotControl({ ...pilotControl(), state: 'expired', expiresAt: '2026-10-06T16:00:00Z' })), 'expired');
});
test('control timestamps reject missing fields, impossible dates, future arm/attempt and inconsistent states', () => {
  for (const patch of [{ serverTime: '2026-02-30T16:00:00Z' }, { serverTime: '2026-10-06T16:00:00+00:00' }, { serverTime: 1790000000 }, { armedAt: undefined }, { armedAt: null }, { expiresAt: null }, { armedAt: '2026-10-07T00:00:00Z' }, { expiresAt: '2026-10-06T15:54:00Z' }, { attemptedAt: '2026-10-06T15:59:00Z' }, { state: 'consumed' }]) rejected(parseInhandPilotControl, { ...pilotControl(), ...patch });
  rejected(parseInhandPilotControl, { ...pilotControl('consumed'), attemptedAt: '2026-10-07T00:00:00Z' });
});
test('future window stays unarmed, and inconsistent state/window metadata is rejected', () => {
  const future = { ...pilotControl(), state: 'unarmed', armedAt: '2026-10-06T16:05:00Z', expiresAt: '2026-10-06T16:10:00Z' };
  assert.equal(parseInhandPilotControl(future).state, 'unarmed');
  for (const patch of [{ state: 'ready' }, { armedAt: null }, { expiresAt: null }, { expiresAt: '2026-10-06T17:05:01Z' }]) rejected(parseInhandPilotControl, { ...future, ...patch });
  for (const patch of [{ state: 'expired' }, { state: 'unarmed' }]) rejected(parseInhandPilotControl, { ...pilotControl(), ...patch });
  for (const attemptedAt of ['2026-10-06T15:54:59Z', '2026-10-06T16:10:01Z']) rejected(parseInhandPilotControl, { ...pilotControl('consumed'), attemptedAt });
});
test('result projection excludes all unexpected provider, account, token and mapping fields', () => {
  const value = pilotSnapshot(); value.raw = 'DO_NOT_COPY'; value.identity.account = 'DO_NOT_COPY'; value.network.token = 'DO_NOT_COPY';
  const parsed = parseResult(value);
  assert.equal(parsed.connection.freshness, 'unknown'); assert.equal(parsed.location.freshness, 'stale');
  assert.equal(JSON.stringify(parsed).includes('DO_NOT_COPY'), false);
  assert.deepEqual(Object.keys(parsed).sort(), ['source', 'version', 'fetchedAt', 'identity', 'connection', 'network', 'location', 'locationUnavailableReason'].sort());
});
test('malformed or unrelated snapshots fail closed', () => {
  for (const value of [null, [], 'text', { result: pilotSnapshot() }]) rejected(parseResult, value);
  for (const patch of [{ source: 'other' }, { version: '1' }, { fetchedAt: '2026-02-30T00:00:00Z' }, { mapping: { status: 'mapped', cosUnitId: 'wrong' } }, { identity: { ...pilotSnapshot().identity, deviceId: 'other' } }, { identity: { ...pilotSnapshot().identity, serialNumber: 'other' } }, { identity: { ...pilotSnapshot().identity, name: 'bad\nname' } }]) rejected(parseResult, { ...pilotSnapshot(), ...patch });
});
test('connection status never gains a guessed timestamp, freshness, or independent probe', () => {
  for (const patch of [{ reportedStatus: ['online'] }, { reportedStatus: true }, { reportedStatus: 'connected' }, { statusObservedAt: '2026-10-06T15:59:00Z' }, { freshness: 'fresh' }, { independentlyProbed: true }]) rejected(parseResult, { ...pilotSnapshot(), connection: { ...pilotSnapshot().connection, ...patch } });
});
test('bad IP, future network update, and inconsistent provider times reject without fabricating a value', () => {
  for (const publicIp of ['https://192.0.2.1', '256.2.3.4', '01.2.3.4', '192.0.2.1/32', '', 1]) rejected(parseResult, { ...pilotSnapshot(), network: { ...pilotSnapshot().network, publicIp } });
  rejected(parseResult, { ...pilotSnapshot(), network: { ...pilotSnapshot().network, infoUpdatedAt: '2026-10-07T00:00:00Z' } });
  rejected(parseResult, { ...pilotSnapshot(), providerTimes: { ...pilotSnapshot().providerTimes, infoUpdatedAt: null } });
});
test('location cannot masquerade as GPS, future, fresh when stale, or mapped', () => {
  for (const patch of [{ source: 'gps' }, { latitude: 91 }, { longitude: -181 }, { latitude: '29.8' }, { latitude: NaN }, { accuracyM: 1 }, { observedAt: null }, { observedAt: '2026-10-07T00:00:00Z' }, { observedAt: '2026-02-30T00:00:00Z' }, { freshness: 'fresh' }, { freshness: 'unknown' }]) rejected(parseResult, { ...pilotSnapshot(), location: { ...pilotSnapshot().location, ...patch } });
  const fresh = parseResult({ ...pilotSnapshot(), location: { ...pilotSnapshot().location, observedAt: '2026-10-06T15:50:01Z', freshness: 'fresh' } });
  assert.equal(fresh.location.freshness, 'fresh');
});
test('missing data stays explicitly missing', () => {
  const value = pilotSnapshot(); value.location = null; value.locationUnavailableReason = 'missing'; value.identity.name = null; value.network.publicIp = null; value.network.wanIp = null;
  const parsed = parseResult(value); assert.equal(parsed.location, null); assert.equal(parsed.network.publicIp, null); assert.equal(parsed.identity.name, null);
  for (const reason of [null, undefined, 'unknown', ['missing']]) rejected(parseResult, { ...value, locationUnavailableReason: reason });
});
test('panel bundle contains no server account configuration, provider origin, persistence, or map write', () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = buildSync({ entryPoints: [resolve(root, 'src/InhandPilotPanel.tsx')], bundle: true, write: false, outfile: '/tmp/inhand-pilot-test-bundle.js', format: 'esm', platform: 'browser', jsx: 'automatic' });
  const bundle = result.outputFiles.find(f => f.path.endsWith('.js')).text;
  for (const forbidden of ['iot.inhandnetworks.com', 'accountEmail', 'organizationId', 'observedRoleName', 'verifyInhandIdentity', 'getAccessToken', 'COS_INHAND', 'localStorage', 'sessionStorage', '/gps']) assert.equal(bundle.includes(forbidden), false, forbidden);
  const source = readFileSync(resolve(root, 'src/InhandPilotPanel.tsx'), 'utf8');
  assert.equal((source.match(/api\.post/g) || []).length, 1);
  assert.equal(source.includes('setInterval'), false);
});
