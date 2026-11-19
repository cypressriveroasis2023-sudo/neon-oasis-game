/**
 * Camera status for the fleet board.
 * This module is the reuse seam: it does not import the owner/IT page shell
 * (App, FleetDashboard, or fleetAccess). A later reviewed change can call
 * these reads from a service-role Tech Check without rewriting them.
 * Access is not decided here.
 */
import {CAMERA_FRESH_MS, cameraRecord, cameraState, type CameraRow} from './cameraEvidence';

export {CAMERA_FRESH_MS};

export type CameraMark = 'up' | 'down' | 'unknown';

export type CameraMarkRow = { name: string; state: CameraMark; observedAt: string | null };

const ipAddress = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const sevenDigitKey = /^\d{7}$/;

/** Hide addresses, secrets, and full 7-digit keys. A camera name that is one of those is not shown. */
export function publicCameraLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 80 || ipAddress.test(text) || sevenDigitKey.test(text)) return null;
  return text;
}

/** One mark per saved camera or detector row. Freshness stays in cameraEvidence. */
export function cameraMarks(rows: readonly CameraRow[] | null | undefined, now = Date.now()): CameraMarkRow[] {
  return (rows || []).filter(cameraRecord).map(row => {
    const state = cameraState(row, now);
    return {
      name: publicCameraLabel(row.name) || 'Camera',
      state: state === 'online' ? 'up' : state === 'offline' ? 'down' : 'unknown',
      observedAt: typeof row.evidence?.observedAt === 'string' ? row.evidence.observedAt : typeof row.checkedAt === 'string' ? row.checkedAt : null,
    };
  });
}

/** Missing, future, or older than 20 minutes is a stale read. */
export function readIsStale(readAt: string | null | undefined, now = Date.now()): boolean {
  if (!readAt) return true;
  const at = Date.parse(readAt);
  return !Number.isFinite(at) || at > now || now - at > CAMERA_FRESH_MS;
}
