/** Automatic reads are gentle; manual actions still read immediately. Clock ticks never probe. */
export const AUTO_REFRESH_MS=15*60*1000;
// Camera evidence expires 20 minutes after the PROVIDER OBSERVED it
// (cameraTimestamp measures now-observedAt, not now-fetchedAt), so a read does
// not buy a full 20 minutes of display life. Measured 2026-10-30: the youngest
// of 474 Vigilant observations was already 9 minutes old on arrival, leaving
// <=11 usable minutes. A 15-minute cadence therefore left several minutes of
// every cycle with expired evidence, and units silently drained into
// "unverified" until the next read. Ten minutes keeps the read inside the
// usable window with margin instead of widening CAMERA_FRESH_MS, which would
// make stale observations look current. These reads fetch only the saved
// health/map pair, never vendor probes, and this value is also the saved-pair
// cache TTL in api.ts.
export const CAMERA_AUTO_REFRESH_MS=10*60*1000;
export function automaticRefreshDue(lastAttemptAt:number,now:number,hidden:boolean,intervalMs=AUTO_REFRESH_MS) {
  return !hidden && Number.isFinite(now) && (lastAttemptAt===0 || now-lastAttemptAt>=intervalMs);
}
