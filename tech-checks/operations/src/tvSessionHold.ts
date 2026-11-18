/** True only while the Tech Check TV board is the mounted display. */
let hold = false;
export function setTvSessionHold(value: boolean) { hold = value; }
export function tvSessionHold() { return hold; }
