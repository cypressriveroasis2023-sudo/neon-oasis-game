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
  return owner ? 'cos-saved-fleet-reading-v1:' + owner : null;
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
