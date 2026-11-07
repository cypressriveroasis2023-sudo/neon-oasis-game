import {ownerSessionFingerprint,type OperationsSession} from './operationsSessionRecovery';

export type SavedFleetReading = {
  checkedAt: number;
  field: number;
  shop: number;
  online: number;
  offline: number;
  unverified: number;
};

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000;

function validReading(value: SavedFleetReading | null, now: number): value is SavedFleetReading {
  return Boolean(value && Number.isSafeInteger(value.checkedAt) && value.checkedAt > 0 &&
    value.checkedAt <= now &&
    [value.field, value.shop, value.online, value.offline, value.unverified].every(count) &&
    value.online + value.offline + value.unverified <= value.field);
}

export function fleetReadingKey(session: OperationsSession, mode: string) {
  const owner = ownerSessionFingerprint(session, mode);
  if (owner) return 'cos-saved-fleet-reading-v1:' + owner;
  // IT's identifier is supplied only by the authenticated /api/session response.
  // Older backends without that verified identity must leave the display uncached.
  if (!session || session.authorized !== true || session.legacyOwner !== false || session.role !== 'IT' ||
      typeof session.productionTechnicianUserId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.productionTechnicianUserId)) return null;
  const features = session.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) return null;
  const keys = Object.keys(features).sort();
  if (!keys.length || keys.some(key => typeof features[key] !== 'boolean')) return null;
  return 'cos-saved-fleet-reading-v1:' + JSON.stringify([session.productionTechnicianUserId,
    session.legacyOwner, session.role, mode, keys.map(key => [key, features[key]])]);
}

export function readFleetReading(storage: Storage | null, key: string | null, now = Date.now()) {
  if (!storage || !key) return null;
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as SavedFleetReading | null;
    return validReading(value, now) ? value : null;
  } catch {
    return null;
  }
}

export function saveFleetReading(storage: Storage | null, key: string | null, reading: SavedFleetReading, now = Date.now()) {
  if (!storage || !key || !validReading(reading, now)) return;
  const previous = readFleetReading(storage, key, now);
  if (previous && previous.checkedAt >= reading.checkedAt) return;
  try { storage.setItem(key, JSON.stringify(reading)); } catch { /* Storage may be disabled. */ }
}
