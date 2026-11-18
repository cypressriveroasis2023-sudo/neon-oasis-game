/** True only while the Tech Check TV board is the mounted display. */
let hold = false;
export function setTvSessionHold(value: boolean) { hold = value; }
export function tvSessionHold() { return hold; }

export const TV_SHARED_VIEW_RELOAD = 'Your session changed. Reload the shared view.';

/** The TV recovers this reading by itself. The real sentence stays outside the hold. */
export function tvSettingsNotice(error: string, holdActive = tvSessionHold()) {
  return holdActive && error === TV_SHARED_VIEW_RELOAD ? 'Reconnecting…' : error;
}
