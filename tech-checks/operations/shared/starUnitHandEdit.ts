// What a hand edit to unit camera status may say, checked before anything is recorded.
//
// A hand edit can move a unit between Field and Shop, name its site, give its
// street address (the route geocodes it into the unit's map pin), or correct its
// public IP. It can also say a camera the provider still reports is no longer
// on the unit - a swap. It can never say whether a camera is online, and it can
// only name a unit Star4Live is already reporting.
import {HAND_EDIT_FIELDS, type HandEditField, type UnitCameraStatus} from './starUnitStatus.ts';

export class HandEditError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'HandEditError'; this.status = status; }
}

export type HandEditRequest = {
  unitKey: string;
  field: HandEditField;
  action: 'set' | 'clear';
  value: string | null;
  providerValue: string | null;
  reason: string | null;
  requestId: string;
};

const FIELDS = new Set<string>(['unitKey', 'field', 'action', 'value', 'reason', 'requestId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// No control characters: a site name goes on a board, a sheet and a tech's phone.
const PRINTABLE = /^[^\u0000-\u001f\u007f]+$/;

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** A public IPv4 only. A private, loopback, link-local or reserved address is never a unit's public IP. */
export function publicIpv4(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => /^(0|[1-9][0-9]{0,2})$/.test(part) ? Number(part) : NaN);
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return null;
  if (a === 172 && b >= 16 && b <= 31) return null;
  if (a === 192 && b === 168) return null;
  if (a === 169 && b === 254) return null;
  if (a === 100 && b >= 64 && b <= 127) return null;
  if (a === 192 && b === 0) return null;
  if (a === 198 && (b === 18 || b === 19)) return null;
  return octets.join('.');
}

export function checkedHandEditRequest(
  body: unknown,
  units: UnitCameraStatus[],
  newRequestId: () => string,
): HandEditRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HandEditError('A hand edit request is required.');
  const payload = body as Record<string, unknown>;
  const unknown = Object.keys(payload).filter(key => !FIELDS.has(key));
  if (unknown.length) throw new HandEditError('This hand edit contains unsupported fields: ' + unknown.join(', ') + '.');

  const unitKey = text(payload.unitKey);
  if (!unitKey) throw new HandEditError('A unit is required.');
  const unit = units.find(row => row.unit.trim().toUpperCase() === unitKey.toUpperCase()
    || (row.displayName || '').trim().toUpperCase() === unitKey.toUpperCase());
  if (!unit) throw new HandEditError('Star4Live is not reporting a unit named ' + unitKey + '. Only a unit the provider reports can be edited.', 404);

  const field = text(payload.field) as HandEditField;
  if (!HAND_EDIT_FIELDS.includes(field)) throw new HandEditError('A hand edit may change where a unit is, its site, its address, its public IP, what it is called, or which cameras are on it only.');

  const action = text(payload.action) || 'set';
  if (action !== 'set' && action !== 'clear') throw new HandEditError('A hand edit is either set or clear.');

  const reason = text(payload.reason) || null;
  if (reason && (reason.length > 400 || !PRINTABLE.test(reason))) throw new HandEditError('That reason is too long or contains characters that cannot be stored.');

  const requestId = text(payload.requestId) || newRequestId();
  if (!UUID.test(requestId)) throw new HandEditError('A hand edit request id must be a UUID.');

  // The provider's value is read here, never taken from the caller.
  const providerValue = field === 'placement' ? unit.providerPlacement ?? unit.placement
    : field === 'site' ? unit.providerSite ?? unit.site
    : field === 'address' || field === 'camera' ? null // Star4Live has no street address, and it reports every camera it knows.
    : field === 'name' ? unit.unit // The provider's own name for this unit.
    : unit.providerPublicIp ?? unit.publicIp;

  // One camera is named when putting that camera back; naming none puts every
  // camera on the unit back at once.
  const namedCamera = (raw: string) => {
    const match = (unit.cameraList || []).find(camera => camera.name.trim().toUpperCase() === raw.toUpperCase());
    if (!match) throw new HandEditError('Star4Live is not reporting a camera named ' + raw + ' on ' + unit.unit + '.', 404);
    return match;
  };

  if (action === 'clear') {
    const raw = text(payload.value);
    if (raw && field !== 'camera') throw new HandEditError('Clearing a hand edit does not take a value.');
    if (raw) return {unitKey: unit.unit, field, action, value: namedCamera(raw).name, providerValue: null, reason, requestId};
    return {unitKey: unit.unit, field, action, value: null, providerValue: providerValue ?? null, reason, requestId};
  }

  const raw = text(payload.value);
  if (!raw) throw new HandEditError('A value is required.');
  let value = raw;
  if (field === 'placement') {
    value = raw.toUpperCase();
    if (value !== 'FIELD' && value !== 'SHOP') throw new HandEditError('A unit is either in the FIELD or in the SHOP.');
  } else if (field === 'site') {
    if (value.length > 120 || !PRINTABLE.test(value)) throw new HandEditError('That site name is too long or contains characters that cannot be stored.');
    if (['root', 'shop'].includes(value.toLowerCase())) throw new HandEditError('Use the Shop setting to put a unit in the shop; root is not a site name.');
  } else if (field === 'address') {
    // Format and match are the geocoder's job (one rule, in censusAddress); here
    // only what can be stored. A shop unit has no field pin to drop.
    if (value.length > 200 || !PRINTABLE.test(value)) throw new HandEditError('That address is too long or contains characters that cannot be stored.');
    if (unit.placement !== 'FIELD') throw new HandEditError('Put the unit in the Field first; a unit in the shop has no site address.');
  } else if (field === 'name') {
    if (value.length > 120) throw new HandEditError('That name is too long. Keep it under 120 characters.');
    if (/[\r\n\t]/.test(value)) throw new HandEditError('A unit name is one line of plain text.');
    // Two units answering to one name on the same screen is worse than a wrong name.
    const taken = (units || []).some(other => other.unit !== unit.unit
      && (other.unit.trim().toUpperCase() === value.toUpperCase()
        || (other.displayName || '').trim().toUpperCase() === value.toUpperCase()));
    if (taken) throw new HandEditError('Another unit is already called ' + value + '. Pick a name no other unit uses.');
  } else if (field === 'camera') {
    const camera = namedCamera(value);
    if (camera.name.length > 200) throw new HandEditError('That camera name is too long to store.');
    const remaining = (unit.cameraList || []).filter(other => other.name !== camera.name && !other.removed);
    if (!remaining.length) throw new HandEditError('That is the only camera left on ' + unit.unit + '. Put the unit in the Shop instead of taking its last camera off.');
    value = camera.name;
  } else {
    const ip = publicIpv4(value);
    if (!ip) throw new HandEditError('That is not a public IPv4 address.');
    value = ip;
  }
  return {unitKey: unit.unit, field, action, value, providerValue: providerValue ?? null, reason, requestId};
}
