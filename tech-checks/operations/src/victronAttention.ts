import {canonicalCameraUnit} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';
import {unitTileSummary} from './vrmReadOnlyModel';
import type {VrmUnit} from '../../supabase/functions/cos-operations-pages/vrm';
import type {SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';

export type VictronPlacement = 'field' | 'shop' | 'unknown';
export type VictronAttention = {installationId: number; name: string; kind: 'low' | 'fair' | 'unknown' | 'off'; line: string};
type InventoryUnit = {unitNumber?: string; placement?: string; currentLocationType?: string; effectivePlacement?: {contract?: string; state?: string}};

/** Field or Shop from the one mHelp unit with the same Helios number. None or two matches stay unknown. */
export function heliosPlacement(name: string, inventory: readonly InventoryUnit[] | null): VictronPlacement {
  if (!inventory) return 'unknown';
  const key = canonicalCameraUnit(name);
  if (!key?.startsWith('HELIOS|')) return 'unknown';
  const matches = inventory.filter(unit => typeof unit?.unitNumber === 'string' && canonicalCameraUnit(unit.unitNumber) === key);
  return matches.length === 1 ? inventoryPlacement(matches[0] as Parameters<typeof inventoryPlacement>[0]) : 'unknown';
}

export function placementLabel(placement: VictronPlacement): string {
  return placement === 'field' ? 'Field' : placement === 'shop' ? 'Shop' : 'Placement unknown';
}

/** Field units only. Shop units are never an outage. A stale or missing reading is "power unknown", never "dead". */
export function victronNeedsAttention(units: readonly VrmUnit[], rows: SafeVrmPower[], inventory: readonly InventoryUnit[] | null, now: number): VictronAttention[] {
  const out: VictronAttention[] = [];
  for (const unit of units) {
    if (heliosPlacement(unit.name, inventory) !== 'field') continue;
    const tile = unitTileSummary(unit, rows, now);
    const pct = tile.soc ? Math.round(tile.soc.value) + '%' : '';
    if (tile.tone === 'low') out.push({installationId: unit.installationId, name: unit.name, kind: 'low', line: 'Low battery · ' + pct});
    else if (tile.tone === 'fair' && tile.soc && tile.soc.value < 35) out.push({installationId: unit.installationId, name: unit.name, kind: 'fair', line: 'Getting low · ' + pct});
    else if (tile.tone === 'stale') out.push({installationId: unit.installationId, name: unit.name, kind: 'unknown', line: 'Power unknown · reading over 30 min old'});
    else if (tile.tone === 'none') out.push({installationId: unit.installationId, name: unit.name, kind: 'unknown', line: 'Power unknown · no battery reading'});
    else if (tile.tone === 'unavailable') out.push({installationId: unit.installationId, name: unit.name, kind: 'off', line: 'Not in the latest Victron sync'});
  }
  const rank = {low: 0, fair: 1, off: 2, unknown: 3};
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, undefined, {numeric: true}));
}
