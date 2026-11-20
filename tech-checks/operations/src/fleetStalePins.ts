/** Grey the map pins when the unit list that placed them is stale. */
export function stalePinClass(pinsStale: boolean) {
  return pinsStale ? ' cos-pins-stale' : '';
}
