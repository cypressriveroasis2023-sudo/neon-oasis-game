/** Read-only. Exact name or exact id only. Nothing here writes or guesses a unit. */

export type CameraFiling = {
  id: string;
  unitKey: string;
  deviceName: string;
  organization: string;
};

export type FieldUnitFiling = {
  id: string;
  unitNumber: string;
  placement: 'FIELD' | 'SHOP' | 'OTHER';
  cameraId?: string | null;
  organization?: string | null;
};

export type MisfileProposal = {
  cameraId: string;
  fromUnitKey: string;
  fromOrganization: string;
  toUnitId: string;
  toUnitNumber: string;
  toOrganization: string;
  by: 'name' | 'id';
};

export type MisfileReport = {
  proposals: MisfileProposal[];
  ambiguous: {cameraId: string; reason: string}[];
};

const exactName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const SHOP_FILING = new Set(['', 'ROOT', 'SHOP', 'SHOP/ROOT', 'ROOT/SHOP', 'SHOP / ROOT', 'ROOT / SHOP', 'UNASSIGNED', 'UNKNOWN']);

export function isMisfiled(camera: CameraFiling): boolean {
  return SHOP_FILING.has(exactName(camera.organization)) || SHOP_FILING.has(exactName(camera.unitKey));
}

export function misfiledFieldCameras(cameras: readonly CameraFiling[], units: readonly FieldUnitFiling[]): MisfileReport {
  const field = units.filter(unit => unit.placement === 'FIELD');
  const proposals: MisfileProposal[] = [];
  const ambiguous: MisfileReport['ambiguous'] = [];
  for (const camera of cameras) {
    if (!isMisfiled(camera)) continue;
    const name = exactName(camera.unitKey) || exactName(camera.deviceName);
    const byName = name ? field.filter(unit => exactName(unit.unitNumber) === exactName(camera.unitKey) || exactName(unit.unitNumber) === exactName(camera.deviceName)) : [];
    const byId = camera.id ? field.filter(unit => unit.cameraId && unit.cameraId === camera.id) : [];
    const nameIds = new Set(byName.map(unit => unit.id));
    const idIds = new Set(byId.map(unit => unit.id));
    if (byName.length > 1 || byId.length > 1 || (nameIds.size && idIds.size && [...nameIds].some(id => !idIds.has(id)))) {
      ambiguous.push({cameraId: camera.id, reason: 'More than one Field unit matches this camera by name or id.'});
      continue;
    }
    const match = byId[0] || byName[0];
    if (!match) {
      ambiguous.push({cameraId: camera.id, reason: 'No exact Field name or id match.'});
      continue;
    }
    const organization = (match.organization || '').trim();
    if (!organization || SHOP_FILING.has(exactName(organization))) {
      ambiguous.push({cameraId: camera.id, reason: 'The Field unit has no organization text to copy.'});
      continue;
    }
    proposals.push({
      cameraId: camera.id,
      fromUnitKey: camera.unitKey,
      fromOrganization: camera.organization,
      toUnitId: match.id,
      toUnitNumber: match.unitNumber,
      toOrganization: organization,
      by: byId[0] ? 'id' : 'name',
    });
  }
  return {proposals, ambiguous};
}
