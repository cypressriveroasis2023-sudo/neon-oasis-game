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
// How long the paired health/map read waits for the optional exact-Product
// proof before presenting the map with proof "pending". This is a
// PRESENTATION budget, not a cadence or a freshness rule: proof keeps running
// after it elapses and is adopted when it lands (the separate 30-second
// cancellation in api.ts is unchanged). The original 6500 ms value (318ab091)
// had no recorded benchmark. Measured 2026-10-31 (edge logs, 31 Oct): proof p50
// is ~7.5 s, so the old budget almost always expired anyway, after holding the
// first paint for 6.5 s. A controlled fake-clock run of the real api.ts
// (budget-harness-record, main 559f14d2) showed 1500 settles 2.9 s sooner on
// typical inputs and 5 s sooner on bad-day inputs, with cache retention, saved
// receipt bridging, overlap sharing and late-failure clearing all unchanged.
export const PROOF_PRESENTATION_BUDGET_MS=1500;
