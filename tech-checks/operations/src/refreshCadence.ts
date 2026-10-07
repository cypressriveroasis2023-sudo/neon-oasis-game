/** Automatic reads are gentle; manual actions still read immediately. Clock ticks never probe. */
export const AUTO_REFRESH_MS=15*60*1000;
export function automaticRefreshDue(lastAttemptAt:number,now:number,hidden:boolean) {
  return !hidden && Number.isFinite(now) && (lastAttemptAt===0 || now-lastAttemptAt>=AUTO_REFRESH_MS);
}
