import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Synthetic records only. No source edits, network, provider calls or persistence.
globalThis.crypto ??= webcrypto;
globalThis.fetch = async () => { throw new Error('NETWORK FORBIDDEN in isolated boundary proof'); };
const root = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const source = path => import(pathToFileURL(root + '/tech-checks/' + path));
const { checkedAddressEstimate } = await source('operations/src/fieldAddressEstimates.ts');
const { isCurrentFieldPin, historicalFieldCoordinates, normalizeLocationAddress } = await source('operations/src/fieldLocations.ts');
const { projectOwnerPlacement } = await source('supabase/functions/cos-operations-pages/placementProjection.ts');
const { projectFieldGeocodes } = await source('supabase/functions/cos-operations-pages/fieldGeocodeProjection.ts');
const { projectFallbackGeocodes } = await source('supabase/functions/cos-operations-pages/fallbackGeocodeProjection.ts');
const ids = {
  unit: '11111111-1111-4111-8111-111111111111', control: '22222222-2222-4222-8222-222222222222',
  history: '33333333-3333-4333-8333-333333333333', request: '44444444-4444-4444-8444-444444444444',
  provider: '55555555-5555-4555-8555-555555555555', match: '66666666-6666-4666-8666-666666666666',
  org: '77777777-7777-4777-8777-777777777777',
};
const key = 'SYNTHETIC BOUNDARY 900';
const oldAddress = '100 Example Road, Testville, TX 77001';
const suiteAddress = '200 Synthetic Fixture Road, Suite 700, Testville, TX 77002-1234';
const baseAddress = '200 Synthetic Fixture Road, Testville, TX 77002';
const oldAt = '2026-10-01T00:00:00.000Z', moveAt = '2026-10-10T00:00:00.000Z';
const providerAt = '2026-10-10T01:00:00.000Z', newAt = '2026-10-11T00:00:00.000Z';
const now = Date.parse('2026-10-12T12:00:00.000Z');
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeLocationAddress(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
const note = async address => 'COS_FIELD_LOCATION_V1|address_sha256=' + await digest(address) + '|confirmed=true\nSynthetic manual observation retained verbatim.';
const historicalKeys = ['hasUnitGps', 'gpsRecordedAt', 'historicalLatitude', 'historicalLongitude', 'historicalCoordinateSource', 'historicalRecordedAt', 'locationNote'];
const history = row => Object.fromEntries(historicalKeys.map(field => [field, row[field]]));

async function fixture(address = suiteAddress) {
  const unit = { id: ids.unit, unit_number: key, organization_id: ids.org };
  const provider = { id: ids.provider, organization_id: ids.org, source: 'vigilant_control_center', external_device_id: 'synthetic-boundary-device', device_name: 'Synthetic boundary camera', device_type: 'IPC' };
  const match = { id: ids.match, organization_id: ids.org, equipment_unit_id: ids.unit, vigilant_device_id: ids.provider, camera_key: 'cam1', match_method: 'reviewed_fixture', confidence: 'exact' };
  const device = { id: 99001, unit_key: key, source: provider.source, device_type: 'IPC', external_device_id: provider.external_device_id, device_serial: 'synthetic-boundary-serial' };
  const audit = { id: '9001', unit_key: key, device_ids: ['99001'], contract: 'COS_CAMERA_PLACEMENT_V2', control_id: ids.control, request_id: ids.request, placement: 'FIELD', action: 'MOVE_TO_FIELD', site_label: 'Synthetic new site', street_address: address, created_at: moveAt };
  const raw = {
    id: ids.unit, unitNumber: key, readOnly: false, _sourceField: true, status: 'field', currentLocationType: 'field',
    address: oldAddress, addressSource: 'Current installation address', latitude: 30, longitude: -95, coordinateSource: 'manual',
    hasUnitGps: true, gpsRecordedAt: oldAt, locationVerification: 'owner_verified', locationVerifiedAt: oldAt, locationHistoryId: ids.history,
    historicalLatitude: 30, historicalLongitude: -95, historicalCoordinateSource: 'manual', historicalRecordedAt: oldAt,
    locationNote: await note(oldAddress), _placementProof: { owner: true, historyId: ids.history, note: await note(oldAddress) },
  };
  const snapshot = { items: [raw], inventoryItems: [raw], summary: {}, generatedAt: newAt };
  const sources = { units: [unit], matches: [match], providers: [provider], devices: [device], audits: [audit] };
  // Inject the documented verified-identity DTO boundary using synthetic values.
  // Do not claim to exercise production organization/review-scope admission here.
  const identity = { identityVersion: 1, unitIdentities: [{ unitId: ids.unit, unitNumber: key, kind: 'native_provider', deviceIds: ['99001'], unitKeys: [key], proof: await digest('synthetic identity proof') }], identityWarnings: [] };
  return { raw, audit, sources, snapshot, identity: async () => structuredClone(identity) };
}
const placed = async f => projectOwnerPlacement(f.snapshot, f.sources.audits, f.sources.devices, await f.identity(), f.sources.units);
async function record(address = suiteAddress, provider = 'census', patch = {}) {
  const common = { status: 'success', auditId: '9001', unitKey: key, addressSha256: await digest(address), latitude: 31, longitude: -96, matchedAddress: baseAddress, geocodedAt: providerAt };
  return provider === 'census'
    ? { ...common, provider: 'us_census_address_range', benchmark: 'Public_AR_Current', ...patch }
    : { ...common, provider: 'geocodio', source: 'geocodio_automatic_address_estimate', confidence: 'estimate', verified: false, liveGps: false, accuracy: 1, accuracyType: 'range_interpolation', matchType: null, ...patch };
}
const projectProvider = (snapshot, provider, r) => provider === 'census' ? projectFieldGeocodes(snapshot, [r]) : projectFallbackGeocodes(snapshot, [r]);
const both = ['census', 'geocodio'];

test('Owner placement suppresses old-address GPS but preserves historical flag, coordinates, source, note and timestamp', async () => {
  const f = await fixture(), before = structuredClone({ snapshot: f.snapshot, sources: f.sources });
  const result = await placed(f), row = result.items[0];
  assert.equal(row.address, suiteAddress);
  assert.equal(row.placementSource, 'owner');
  assert.equal(row.placementAuditId, '9001');
  assert.equal(row.placementUpdatedAt, moveAt);
  assert.equal(row.addressUpdatedAt, moveAt);
  assert.equal(row.addressSource, 'Owner confirmed installation address');
  assert.equal(row.latitude, null); assert.equal(row.longitude, null); assert.equal(row.coordinateSource, null);
  assert.equal(row.locationVerification, 'address_changed'); assert.equal(row.locationVerifiedAt, null); assert.equal(row.locationHistoryId, null);
  assert.deepEqual(history(row), history(f.raw)); assert.equal(row.hasUnitGps, true);
  assert.equal(isCurrentFieldPin(row), false);
  assert.deepEqual(historicalFieldCoordinates(row), { latitude: 30, longitude: -95, source: 'manual', recordedAt: oldAt });
  assert.deepEqual({ snapshot: f.snapshot, sources: f.sources }, before);
  assert.equal(result.summary.mappedUnits, 0);
});

test('valid suite Census success is admitted only as a separate estimate with proven older historical GPS', async () => {
  const f = await fixture(), owner = await placed(f), r = await record();
  const result = await projectFieldGeocodes(owner, [r]), row = result.items[0];
  assert.equal(row.locationGeocode.status, 'success');
  assert.equal(row.locationGeocode.addressSha256, await digest(suiteAddress));
  const estimate = await checkedAddressEstimate(row, now);
  assert.ok(estimate); assert.equal(estimate.latitude, 31); assert.equal(estimate.longitude, -96);
  assert.equal(estimate.secondaryUnitVerified, false); assert.equal(estimate.originalAddress, suiteAddress);
  assert.equal(isCurrentFieldPin(row), false); assert.deepEqual(history(row), history(f.raw));
});

test('existing no-GPS suite behavior remains unchanged without historical-only proof', async () => {
  const f = await fixture(), projected = await projectFieldGeocodes(await placed(f), [await record()]);
  const row = projected.items[0], before = structuredClone(row), control = { ...row, hasUnitGps: false };
  const estimate = await checkedAddressEstimate(control, now);
  assert.ok(estimate); assert.equal(estimate.confidence, 'address_range_interpolation');
  assert.equal(estimate.secondaryUnit.identifier, '700'); assert.equal(estimate.secondaryUnitVerified, false);
  assert.equal(estimate.originalAddress, suiteAddress); assert.equal(estimate.latitude, 31); assert.equal(estimate.longitude, -96);
  assert.equal(control.latitude, null); assert.equal(control.longitude, null); assert.equal(isCurrentFieldPin(control), false);
  assert.deepEqual(row, before); assert.equal(row.hasUnitGps, true);
});

test('existing unsuited Owner Census branch already admits an estimate with historical hasUnitGps true', async () => {
  const f = await fixture(baseAddress), row = (await projectFieldGeocodes(await placed(f), [await record(baseAddress)])).items[0];
  const estimate = await checkedAddressEstimate(row, now);
  assert.ok(estimate); assert.equal(estimate.confidence, 'address_range_interpolation');
  assert.equal(row.hasUnitGps, true); assert.equal(isCurrentFieldPin(row), false); assert.deepEqual(history(row), history(f.raw));
});

test('existing Owner Geocodio suite branch already admits separate estimate with historical hasUnitGps true', async () => {
  const f = await fixture(), row = (await projectFallbackGeocodes(await placed(f), [await record(suiteAddress, 'geocodio')])).items[0];
  const estimate = await checkedAddressEstimate(row, now);
  assert.ok(estimate); assert.equal(estimate.confidence, 'automatic_address_estimate'); assert.equal(estimate.secondaryUnitVerified, false);
  assert.equal(row.hasUnitGps, true); assert.equal(row.latitude, null); assert.equal(isCurrentFieldPin(row), false);
  assert.deepEqual(history(row), history(f.raw));
});

for (const historicalCoordinateSource of ['manual', 'site']) test(`older native ${historicalCoordinateSource} history admits only unverified Census point and remains untouched`, async () => {
  const f = await fixture(); f.raw.historicalCoordinateSource = historicalCoordinateSource;
  const projected = await projectFieldGeocodes(await placed(f), [await record()]), before = structuredClone(projected);
  const estimate = await checkedAddressEstimate(projected.items[0], now);
  assert.ok(estimate); assert.equal(estimate.confidence, 'address_range_interpolation');
  assert.equal(estimate.secondaryUnitVerified, false); assert.equal(isCurrentFieldPin(projected.items[0]), false);
  assert.deepEqual(projected, before); assert.deepEqual(history(projected.items[0]), history(f.raw));
});

test('PostgreSQL microsecond timestamps retain strict earlier-history ordering without losing original values', async () => {
  const f = await fixture();
  Object.assign(f.raw, { gpsRecordedAt: '2026-10-01T00:00:00.032265+00:00', historicalRecordedAt: '2026-10-01T00:00:00.032265+00:00', historicalCoordinateSource: 'site' });
  f.audit.created_at = '2026-10-10T00:00:00.248717+00:00';
  const row = (await projectFieldGeocodes(await placed(f), [await record()])).items[0], before = structuredClone(row);
  assert.ok(await checkedAddressEstimate(row, now)); assert.deepEqual(row, before);
  const tied = { ...row, gpsRecordedAt: '2026-10-10T00:00:00.248100+00:00', historicalRecordedAt: '2026-10-10T00:00:00.248100+00:00' };
  assert.equal(await checkedAddressEstimate(tied, now), null, 'ambiguous sub-millisecond ordering fails conservatively closed');
});

const historicalDenials = [
  ['read-only native', { readOnly: true }], ['missing native proof', { readOnly: undefined }],
  ['wrong placement', { placement: 'SHOP' }], ['unknown placement', { placement: 'UNKNOWN' }],
  ['wrong source', { placementSource: 'imported' }], ['identity review', { placementStatus: 'needs_identity_review' }],
  ['wrong status', { status: 'installed' }], ['wrong current type', { currentLocationType: 'site' }],
  ['zero audit', { placementAuditId: '0' }], ['missing audit', { placementAuditId: undefined }],
  ['wrong address source', { addressSource: 'Imported address' }], ['missing address source', { addressSource: undefined }],
  ['unverified current state', { locationVerification: 'coordinates_unverified' }], ['Owner-verified state', { locationVerification: 'owner_verified' }],
  ['current latitude', { latitude: 0 }], ['current longitude', { longitude: 0 }],
  ['current latitude text', { latitude: '30' }], ['undefined latitude', { latitude: undefined }], ['undefined longitude', { longitude: undefined }],
  ['current source', { coordinateSource: 'manual' }], ['undefined current source', { coordinateSource: undefined }],
  ['current verification time', { locationVerifiedAt: oldAt }], ['undefined verification time', { locationVerifiedAt: undefined }],
  ['current history id', { locationHistoryId: ids.history }], ['undefined history id', { locationHistoryId: undefined }],
  ['unknown historical source', { historicalCoordinateSource: 'arbitrary' }], ['import history source', { historicalCoordinateSource: 'import' }],
  ['provider history source', { historicalCoordinateSource: 'us_census_address_range_estimate' }], ['missing history source', { historicalCoordinateSource: undefined }],
  ['history latitude text', { historicalLatitude: '30' }], ['history longitude text', { historicalLongitude: '-95' }],
  ['history invalid latitude', { historicalLatitude: 91 }], ['history invalid longitude', { historicalLongitude: NaN }],
  ['missing history point', { historicalLatitude: null }], ['history timestamp mismatch', { historicalRecordedAt: moveAt }],
  ['missing history timestamp', { historicalRecordedAt: undefined }], ['missing GPS timestamp', { gpsRecordedAt: undefined }],
  ['GPS time equals Owner move', { gpsRecordedAt: moveAt, historicalRecordedAt: moveAt }],
  ['GPS time newer than Owner move', { gpsRecordedAt: newAt, historicalRecordedAt: newAt }],
  ['future history', { gpsRecordedAt: '2026-10-13T00:00:00Z', historicalRecordedAt: '2026-10-13T00:00:00Z' }],
  ['invalid history calendar date', { gpsRecordedAt: '2026-02-30T00:00:00Z', historicalRecordedAt: '2026-02-30T00:00:00Z' }],
  ['invalid history hour', { gpsRecordedAt: '2026-10-01T24:00:00Z', historicalRecordedAt: '2026-10-01T24:00:00Z' }],
  ['history lacks timezone', { gpsRecordedAt: '2026-10-01T00:00:00', historicalRecordedAt: '2026-10-01T00:00:00' }],
  ['address time mismatch', { addressUpdatedAt: oldAt }], ['missing address time', { addressUpdatedAt: undefined }],
  ['missing placement time', { placementUpdatedAt: undefined }],
  ['invalid Owner calendar date', { placementUpdatedAt: '2026-02-30T00:00:00Z', addressUpdatedAt: '2026-02-30T00:00:00Z' }],
  ['future Owner date', { placementUpdatedAt: '2026-10-13T00:00:00Z', addressUpdatedAt: '2026-10-13T00:00:00Z' }],
];
for (const [label, patch] of historicalDenials) test(`historical-only Census admission rejects ${label}`, async () => {
  const f = await fixture(), original = (await projectFieldGeocodes(await placed(f), [await record()])).items[0];
  // Keep candidate identity equal when testing malformed audit syntax, so this targets the new predicate.
  const row = { ...original, ...patch, locationGeocode: { ...original.locationGeocode, ...(Object.hasOwn(patch, 'placementAuditId') ? { auditId: patch.placementAuditId } : {}) } }, before = structuredClone(row);
  assert.equal(await checkedAddressEstimate(row, now), null); assert.deepEqual(row, before);
});

test('historical-only admission rejects a provider result dated before the current Owner address', async () => {
  const f = await fixture(), row = (await projectFieldGeocodes(await placed(f), [await record(suiteAddress, 'census', { geocodedAt: oldAt })])).items[0];
  assert.equal(await checkedAddressEstimate(row, now), null); assert.deepEqual(history(row), history(f.raw));
});

for (const provider of both) test(`${provider}: current matching later Owner-verified GPS wins in projection and client`, async () => {
  const f = await fixture();
  Object.assign(f.raw, { gpsRecordedAt: newAt, historicalRecordedAt: newAt, historicalLatitude: 32, historicalLongitude: -97, locationNote: await note(suiteAddress), _placementProof: { owner: true, historyId: ids.history, note: await note(suiteAddress) } });
  const owner = await placed(f), row = owner.items[0], before = structuredClone(owner);
  assert.equal(isCurrentFieldPin(row), true); assert.equal(row.latitude, 32); assert.equal(row.longitude, -97);
  assert.equal(row.coordinateSource, 'manual'); assert.equal(row.locationVerifiedAt, newAt); assert.equal(row.locationHistoryId, ids.history);
  const r = await record(suiteAddress, provider), result = await projectProvider(owner, provider, r);
  assert.deepEqual(result, owner); assert.deepEqual(owner, before);
  assert.equal(await checkedAddressEstimate({ ...row, locationGeocode: r }, now), null);
  assert.equal(await checkedAddressEstimate({ ...row, hasUnitGps: false, locationGeocode: r }, now), null);
});

test('old/equal-date, wrong-address, non-Owner and malformed history proof cannot revive a current pin', async () => {
  const cases = [
    { label: 'old timestamp', gpsRecordedAt: oldAt },
    { label: 'timestamp equals move', gpsRecordedAt: moveAt },
    { label: 'invalid timestamp', gpsRecordedAt: 'invalid' },
    { label: 'wrong address hash', proof: { note: await note(oldAddress) } },
    { label: 'non-Owner proof', proof: { owner: false } },
    { label: 'invalid history identity', proof: { historyId: 'not-a-history-uuid' } },
    { label: 'invalid history latitude', historicalLatitude: 91 },
    { label: 'missing history longitude', historicalLongitude: null },
    { label: 'read-only record', readOnly: true },
  ];
  for (const { label, proof, ...patch } of cases) {
    const f = await fixture();
    Object.assign(f.raw, { gpsRecordedAt: newAt, _placementProof: { owner: true, historyId: ids.history, note: await note(suiteAddress), ...proof } }, patch);
    const result = await placed(f), row = result.inventoryItems[0];
    assert.equal(isCurrentFieldPin(row), false, label); assert.equal(row.latitude, null, label); assert.equal(row.longitude, null, label);
  }
});

for (const provider of both) test(`${provider}: full-address hash, stale audit and unit-key mismatches stay rejected independently of GPS flag`, async () => {
  const f = await fixture(), owner = await placed(f), row = owner.items[0];
  const patches = [ { auditId: '9000' }, { unitKey: 'SYNTHETIC BOUNDARY 901' }, { addressSha256: '0'.repeat(64) }, { addressSha256: await digest(baseAddress) }, { addressSha256: await digest(suiteAddress.replace('700', '701')) } ];
  for (const patch of patches) {
    const r = await record(suiteAddress, provider, patch);
    for (const flag of [true, false]) {
      assert.equal(await checkedAddressEstimate({ ...row, hasUnitGps: flag, locationGeocode: r }, now), null, `${provider} ${JSON.stringify(patch)} flag=${flag}`);
    }
    const projected = await projectProvider(owner, provider, r);
    assert.notEqual(projected.items[0].locationGeocode?.status, 'success');
    assert.deepEqual(history(projected.items[0]), history(f.raw));
  }
});

for (const provider of both) test(`${provider}: changed suite/address and unsafe provider match never admit an estimate`, async () => {
  const f = await fixture(), row = (await placed(f)).items[0];
  for (const matchedAddress of [baseAddress.replace('200', '201'), baseAddress.replace('Testville', 'Elsewhere'), baseAddress.replace('TX', 'OK'), baseAddress.replace('77002', '77003'), baseAddress + '-9999', suiteAddress]) {
    assert.equal(await checkedAddressEstimate({ ...row, hasUnitGps: false, locationGeocode: await record(suiteAddress, provider, { matchedAddress }) }, now), null, matchedAddress);
  }
  assert.equal(await checkedAddressEstimate({ ...row, address: suiteAddress.replace('700', '701'), hasUnitGps: false, locationGeocode: await record(suiteAddress, provider) }, now), null);
});

for (const provider of both) test(`${provider}: reviewed-identity warning DTO quarantines unit and protects history`, async () => {
  const f = await fixture();
  f.identity = async () => ({ identityVersion: 1, unitIdentities: [], identityWarnings: [{ unitId: ids.unit, reason: 'Synthetic reviewed association changed.', deviceIds: ['99001'], unitKeys: [key] }] });
  const owner = await placed(f), row = owner.inventoryItems[0];
  assert.equal(owner.items.length, 0); assert.equal(row.placement, 'UNKNOWN'); assert.equal(row.placementStatus, 'needs_identity_review');
  assert.equal(row.latitude, null); assert.equal(isCurrentFieldPin(row), false); assert.deepEqual(history(row), history(f.raw));
  assert.equal(await checkedAddressEstimate({ ...row, hasUnitGps: false, locationGeocode: await record(suiteAddress, provider) }, now), null);
});

for (const provider of both) test(`${provider}: resource membership mismatch quarantines native identity instead of estimating`, async () => {
  const f = await fixture();
  f.sources.devices.push({ ...f.sources.devices[0], id: 99002, external_device_id: 'extra-synthetic-device' });
  const owner = await placed(f), row = owner.inventoryItems[0];
  assert.equal(owner.items.length, 0); assert.equal(row.placement, 'UNKNOWN'); assert.equal(row.placementStatus, 'needs_identity_review');
  assert.equal(await checkedAddressEstimate({ ...row, hasUnitGps: false, locationGeocode: await record(suiteAddress, provider) }, now), null);
  assert.deepEqual(history(row), history(f.raw));
});

test('duplicate audit and vanished native membership fail closed before provider presentation', async () => {
  const duplicate = await fixture(); duplicate.sources.audits.push({ ...duplicate.audit });
  await assert.rejects(placed(duplicate), /duplicate audit identities/);
  const vanished = await fixture(); vanished.sources.units = [];
  await assert.rejects(placed(vanished), /Native inventory changed/);
});

for (const provider of both) test(`${provider}: manual history input and projected fields stay byte-for-byte unchanged through all provider outcomes`, async () => {
  const f = await fixture(), before = structuredClone({ snapshot: f.snapshot, sources: f.sources });
  const owner = await placed(f), ownerBefore = structuredClone(owner);
  for (const status of ['success', 'pending', 'no_match', 'provider_error']) {
    const r = await record(suiteAddress, provider, { status }), rBefore = structuredClone(r);
    const result = await projectProvider(owner, provider, r), resultBefore = structuredClone(result);
    await checkedAddressEstimate(result.items[0], now);
    assert.deepEqual(history(result.items[0]), history(f.raw)); assert.deepEqual(history(result.inventoryItems[0]), history(f.raw));
    assert.deepEqual(result, resultBefore); assert.deepEqual(r, rBefore); assert.deepEqual(owner, ownerBefore);
  }
  assert.deepEqual({ snapshot: f.snapshot, sources: f.sources }, before);
});

test('source-level UI invariant: nearby centers/distances require current verified coordinates, estimates disclose unverified suites', () => {
  const ui = readFileSync(root + '/tech-checks/operations/src/FieldMap.tsx', 'utf8');
  assert.match(ui, /const hasCoords = \(unit: FieldUnit\) => isCurrentFieldPin\(unit\)/);
  assert.match(ui, /const nearby=items\.find\(unit=>unit\.id===nearbyId&&hasCoords\(unit\)\)/);
  assert.match(ui, /const distance=\(unit:FieldUnit\)=>nearby&&hasCoords\(unit\)/);
  assert.match(ui, /This estimate locates the building address; the suite and installed unit position remain unverified/);
});
