import {canonicalCameraUnit} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';
import {shortDate, unitTileSummary} from './vrmReadOnlyModel';
import {historyFlags, type HistoryPoint} from './vrmHistory';
import type {VrmUnit} from '../../supabase/functions/cos-operations-pages/vrm';
import type {SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';

export type VictronPlacement = 'field' | 'shop' | 'unknown';
export type VictronAttention = {installationId: number; name: string; kind: 'alarm' | 'low' | 'fair' | 'overnight' | 'solar' | 'unknown' | 'off'; line: string};
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
export function victronNeedsAttention(units: readonly VrmUnit[], rows: SafeVrmPower[], inventory: readonly InventoryUnit[] | null, now: number, history?: ReadonlyMap<number, HistoryPoint[]> | null): VictronAttention[] {
  const out: VictronAttention[] = [];
  for (const unit of units) {
    if (heliosPlacement(unit.name, inventory) !== 'field') continue;
    const tile = unitTileSummary(unit, rows, now);
    const pct = tile.soc ? Math.round(tile.soc.value) + '%' : '';
    const seen = tile.lastSeen ? ' · last connected ' + shortDate(tile.lastSeen, now) : '';
    if (tile.alarms.length) out.push({installationId: unit.installationId, name: unit.name, kind: 'alarm', line: 'Victron ' + (tile.alarms[0].level === 2 ? 'alarm' : 'warning') + ' · ' + tile.alarms.map(a => a.kind).join(', ') + (pct ? ' · ' + pct : '')});
    else if (tile.tone === 'low') out.push({installationId: unit.installationId, name: unit.name, kind: 'low', line: 'Low battery · ' + pct});
    else if (tile.tone === 'fair' && tile.soc && tile.soc.value < 35) out.push({installationId: unit.installationId, name: unit.name, kind: 'fair', line: 'Getting low · ' + pct});
    else if (tile.tone === 'stale') out.push({installationId: unit.installationId, name: unit.name, kind: 'unknown', line: 'Power unknown' + (seen || ' · reading over 45 min old')});
    else if (tile.tone === 'none') out.push({installationId: unit.installationId, name: unit.name, kind: 'unknown', line: 'Power unknown · no battery reading' + seen});
    else if (tile.tone === 'unavailable') out.push({installationId: unit.installationId, name: unit.name, kind: 'off', line: 'Not in the latest Victron sync' + seen});
    // History (best-effort): only for units with a current reading and nothing stronger listed.
    if ((tile.tone === 'good' || tile.tone === 'fair') && !out.some(item => item.installationId === unit.installationId)) {
      for (const flag of historyFlags(history?.get(unit.installationId) ?? [], now)) out.push({installationId: unit.installationId, name: unit.name, kind: flag.kind, line: flag.line});
    }
  }
  const rank = {alarm: 0, low: 1, fair: 2, overnight: 3, solar: 4, off: 5, unknown: 6};
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, undefined, {numeric: true}));
}
