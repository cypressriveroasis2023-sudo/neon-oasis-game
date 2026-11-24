/** True only while the Tech Check TV board is the mounted display. */
let hold = false;
export function setTvSessionHold(value: boolean) { hold = value; }
export function tvSessionHold() { return hold; }

/** True while the COS Board is the mounted screen. A sign-in hiccup then
 *  refreshes quietly for the same owner instead of dropping the board. It
 *  changes nothing else the TV hold changes. */
let board = false;
export function setBoardSessionHold(value: boolean) { board = value; }
export function boardSessionHold() { return board; }

export const TV_SHARED_VIEW_RELOAD = 'Your session changed. Reload the shared view.';

/** The TV recovers this reading by itself. The real sentence stays outside the hold. */
export function tvSettingsNotice(error: string, holdActive = tvSessionHold()) {
  return holdActive && error === TV_SHARED_VIEW_RELOAD ? 'Reconnecting…' : error;
}
