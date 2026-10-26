/** Automatic reads are gentle; manual actions still read immediately. Clock ticks never probe. */
export const AUTO_REFRESH_MS=15*60*1000;
// Camera evidence expires after 20 minutes; its 15-minute producers are unchanged.
// These fifteen-minute reads fetch only the saved health/map pair, never vendor probes.
export const CAMERA_AUTO_REFRESH_MS=15*60*1000;
export function automaticRefreshDue(lastAttemptAt:number,now:number,hidden:boolean,intervalMs=AUTO_REFRESH_MS) {
  return !hidden && Number.isFinite(now) && (lastAttemptAt===0 || now-lastAttemptAt>=intervalMs);
}
