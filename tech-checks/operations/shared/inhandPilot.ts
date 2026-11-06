/** Client-safe, allowlisted pilot response contract. No provider account or credential data. */
export const INHAND_TEST_NAME = 'Helios 001';
const PILOT_ID = 'helios001-20261006';
const LOCATION_FRESHNESS_MS = 10 * 60 * 1000;
export type InhandPilotState = 'unarmed' | 'ready' | 'expired' | 'consumed';
export type InhandPilotControl = {
  source: 'inhand_pilot_control'; version: 1; pilotId: string;
  device: { id: string; serialNumber: string; name: string };
  state: InhandPilotState; serverTime: string; armedAt: string | null; expiresAt: string | null; attemptedAt: string | null;
};
export type InhandPilotResult = {
  source: 'inhand'; version: 1; fetchedAt: string;
  identity: { deviceId: string; serialNumber: string; name: string | null };
  connection: { reportedStatus: 'online' | 'offline' | 'unknown'; statusObservedAt: null; freshness: 'unknown'; independentlyProbed: false };
  network: { publicIp: string | null; wanIp: string | null; infoUpdatedAt: string | null };
  location: null | { latitude: number; longitude: number; source: 'cellTower'; observedAt: string; freshness: 'fresh' | 'stale'; accuracyM: null; address: string | null };
  locationUnavailableReason: null | 'missing' | 'invalid_coordinates' | 'unverified_source' | 'invalid_timestamp';
};
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => { throw new Error('The InHand test returned an unsupported response.'); };
const deviceId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
const serialNumber = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][A-Z0-9-]{5,63}$/.test(value);
function stamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1)) return fail();
  const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, digits: string) => '.' + digits.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
  if (new Date(ms).toISOString() !== normalized) return fail();
  return normalized;
}
const optionalStamp = (value: unknown) => value === null ? null : stamp(value);
function ipv4(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value) || !value.split('.').every(part => Number(part) <= 255)) return fail();
  return value;
}
function text(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value;
}
export function parseInhandPilotControl(value: unknown): InhandPilotControl {
  if (!row(value) || value.source !== 'inhand_pilot_control' || value.version !== 1 || value.pilotId !== PILOT_ID || !row(value.device) ||
      !deviceId(value.device.id) || !serialNumber(value.device.serialNumber) || value.device.name !== INHAND_TEST_NAME ||
      (typeof value.state !== 'string' || !['unarmed', 'ready', 'expired', 'consumed'].includes(value.state))) return fail();
  const serverTime = stamp(value.serverTime), armedAt = optionalStamp(value.armedAt), expiresAt = optionalStamp(value.expiresAt), attemptedAt = optionalStamp(value.attemptedAt);
  if ((armedAt === null) !== (expiresAt === null)) return fail();
  if (armedAt && expiresAt && (Date.parse(expiresAt) <= Date.parse(armedAt) || Date.parse(expiresAt) - Date.parse(armedAt) > 3600000)) return fail();
  if (attemptedAt && (!armedAt || !expiresAt || Date.parse(attemptedAt) < Date.parse(armedAt) || Date.parse(attemptedAt) > Date.parse(expiresAt) || Date.parse(attemptedAt) > Date.parse(serverTime))) return fail();
  const expectedState = attemptedAt ? 'consumed' : !armedAt || Date.parse(armedAt) > Date.parse(serverTime) ? 'unarmed' : expiresAt && Date.parse(expiresAt) <= Date.parse(serverTime) ? 'expired' : 'ready';
  if (value.state !== expectedState) return fail();
  return { source: 'inhand_pilot_control', version: 1, pilotId: PILOT_ID, device: { id: value.device.id, serialNumber: value.device.serialNumber, name: INHAND_TEST_NAME }, state: value.state as InhandPilotState, serverTime, armedAt, expiresAt, attemptedAt };
}
/** Server time is authoritative; subtract round-trip time conservatively instead of trusting the device clock. */
export function inhandPilotControlState(control: InhandPilotControl, elapsedMs = 0): InhandPilotState {
  if (control.state !== 'ready') return control.state;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !control.expiresAt || Date.parse(control.expiresAt) <= Date.parse(control.serverTime) + elapsedMs) return 'expired';
  return 'ready';
}
/** Match only the identity returned by this run's authenticated control read; the server fixes the actual target. */
export function parseInhandPilotResult(value: unknown, expectedDevice: InhandPilotControl['device']): InhandPilotResult {
  if (!expectedDevice || !deviceId(expectedDevice.id) || !serialNumber(expectedDevice.serialNumber) || expectedDevice.name !== INHAND_TEST_NAME) return fail();
  if (!row(value) || value.source !== 'inhand' || value.version !== 1 || !row(value.identity) || !row(value.connection) || !row(value.network) ||
      !row(value.mapping) || value.mapping.status !== 'not_mapped' || value.mapping.cosUnitId !== null ||
      value.identity.deviceId !== expectedDevice.id || value.identity.serialNumber !== expectedDevice.serialNumber ||
      (typeof value.connection.reportedStatus !== 'string' || !['online', 'offline', 'unknown'].includes(value.connection.reportedStatus)) || value.connection.statusObservedAt !== null ||
      value.connection.freshness !== 'unknown' || value.connection.independentlyProbed !== false) return fail();
  const fetchedAt = stamp(value.fetchedAt);
  const beforeFetch = (input: unknown) => { const result = optionalStamp(input); if (result && Date.parse(result) > Date.parse(fetchedAt)) return fail(); return result; };
  const name = text(value.identity.name, 160);
  const network = { publicIp: ipv4(value.network.publicIp), wanIp: ipv4(value.network.wanIp), infoUpdatedAt: beforeFetch(value.network.infoUpdatedAt) };
  // Provider record timestamps are not a connection or location observation time.
  if (!row(value.providerTimes) || beforeFetch(value.providerTimes.infoUpdatedAt) !== network.infoUpdatedAt) return fail();
  beforeFetch(value.providerTimes.profileUpdatedAt); beforeFetch(value.providerTimes.logtime);
  let location: InhandPilotResult['location'] = null;
  if (value.location !== null) {
    if (!row(value.location) || value.location.source !== 'cellTower' || value.location.accuracyM !== null ||
        typeof value.location.latitude !== 'number' || !Number.isFinite(value.location.latitude) || Math.abs(value.location.latitude) > 90 ||
        typeof value.location.longitude !== 'number' || !Number.isFinite(value.location.longitude) || Math.abs(value.location.longitude) > 180 || value.locationUnavailableReason !== null) return fail();
    const observedAt = beforeFetch(value.location.observedAt);
    if (!observedAt) return fail();
    const freshness = Date.parse(fetchedAt) - Date.parse(observedAt) <= LOCATION_FRESHNESS_MS ? 'fresh' : 'stale';
    if (value.location.freshness !== freshness) return fail();
    location = { latitude: value.location.latitude, longitude: value.location.longitude, source: 'cellTower', observedAt, freshness, accuracyM: null, address: text(value.location.address, 512) };
  } else if (typeof value.locationUnavailableReason !== 'string' || !['missing', 'invalid_coordinates', 'unverified_source', 'invalid_timestamp'].includes(value.locationUnavailableReason)) return fail();
  return {
    source: 'inhand', version: 1, fetchedAt, identity: { deviceId: expectedDevice.id, serialNumber: expectedDevice.serialNumber, name },
    connection: { reportedStatus: value.connection.reportedStatus as 'online' | 'offline' | 'unknown', statusObservedAt: null, freshness: 'unknown', independentlyProbed: false },
    network, location, locationUnavailableReason: value.locationUnavailableReason as InhandPilotResult['locationUnavailableReason'],
  };
}
