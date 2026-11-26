import {canonicalCameraUnit} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';
import {shortDate, unitTileSummary, type TileTone} from './vrmReadOnlyModel';
import {hadRoomYesterday, historyFlags, tonightHeadline, type HistoryPoint, type Tonight} from './vrmHistory';
import {cloudyWarning, type OutlookDay} from './vrmWeather';
import {mpptFlags, peerYield, type Mppt} from './vrmMppt';
import type {VrmUnit} from '../../supabase/functions/cos-operations-pages/vrm';
import type {SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';

export type VictronPlacement = 'field' | 'shop' | 'unknown';
export type VictronAttention = {installationId: number; name: string; kind: 'alarm' | 'low' | 'tonight' | 'fair' | 'overnight' | 'charger' | 'panel' | 'notfull' | 'load' | 'cloudy' | 'solar' | 'tight' | 'unknown' | 'off'; line: string};
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

export type FleetCount = {key: string; label: string; value: number | string};
/**
 * The page's Field/Shop split. Shop units go last, and one that is not powered is normal, not down.
 * Once mHelp has placed at least one unit, the numbers on top are about the units outside the shop.
 * Until then (mHelp not read yet, or failed) every unit is counted as before.
 */
export function victronFleetView<U extends {installationId: number; name: string}>(units: readonly U[], placement: (unit: U) => VictronPlacement, tile: (unit: U) => {tone: TileTone; fresh: boolean}) {
  const shop = units.filter(unit => placement(unit) === 'shop');
  const rest = units.filter(unit => placement(unit) !== 'shop');
  const placed = units.filter(unit => placement(unit) !== 'unknown').length;
  const counted = placed > 0 ? rest : [...units];
  const tally = (tones: TileTone[]) => counted.filter(unit => tones.includes(tile(unit).tone)).length;
  const allField = counted.every(unit => placement(unit) === 'field');
  const silent = tally(['stale', 'none', 'unavailable']);
  const summary: FleetCount[] = placed > 0 ? [
    {key: 'good', label: allField ? 'Field reporting' : 'Reporting', value: tally(['good', 'fair', 'low']) + ' of ' + counted.length},
    {key: 'low', label: 'Low battery', value: tally(['low'])},
    {key: silent ? 'fair' : 'stale', label: allField ? 'Field not reporting' : 'Not reporting', value: silent},
    {key: 'shop', label: 'In shop', value: shop.length},
  ] : [
    {key: 'good', label: 'Reporting', value: tally(['good', 'fair', 'low'])},
    {key: 'low', label: 'Low battery', value: tally(['low'])},
    {key: 'stale', label: 'Stale / no reading', value: tally(['stale', 'none'])},
    {key: 'unavailable', label: 'Unavailable', value: tally(['unavailable'])},
  ];
  return {
    ordered: shop.length ? [...rest, ...shop] : [...units], shop, placed, summary,
    /** In the shop with no current reading: shown as "Not powered". */
    shopOff: new Set(shop.filter(unit => ['stale', 'none'].includes(tile(unit).tone)).map(unit => unit.installationId)),
    /** Running, but mHelp still says Shop: no alerts until it is moved to Field. */
    shopOn: shop.filter(unit => tile(unit).fresh),
  };
}

/** Field units only. Shop units are never an outage. A stale or missing reading is "power unknown", never "dead". */
export function victronNeedsAttention(units: readonly VrmUnit[], rows: SafeVrmPower[], inventory: readonly InventoryUnit[] | null, now: number, history?: ReadonlyMap<number, HistoryPoint[]> | null, tonight?: ReadonlyMap<number, Tonight> | null, weather?: ReadonlyMap<string, OutlookDay[]> | null, mppt?: ReadonlyMap<number, Mppt> | null): VictronAttention[] {
  const out: VictronAttention[] = [];
  const fieldIds = units.filter(unit => heliosPlacement(unit.name, inventory) === 'field').map(unit => unit.installationId);
  const peers = peerYield(mppt, fieldIds, now);
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
    // Tonight's estimate (best-effort): a unit heading under 20% before 7 AM, or tight at 7 AM.
    const night = tonight?.get(unit.installationId);
    if (night && (night.verdict === 'low' || night.verdict === 'tight') && !out.some(item => item.installationId === unit.installationId)) {
      out.push({installationId: unit.installationId, name: unit.name, kind: night.verdict === 'low' ? 'tonight' : 'tight', line: tonightHeadline(night)});
    }
    // History (best-effort): only for units with a current reading and nothing stronger listed.
    if ((tile.tone === 'good' || tile.tone === 'fair') && !out.some(item => item.installationId === unit.installationId)) {
      for (const flag of historyFlags(history?.get(unit.installationId) ?? [], now)) out.push({installationId: unit.installationId, name: unit.name, kind: flag.kind, line: flag.line});
    }
    // Charger readings (best-effort): a charger error always shows; panel trouble only when nothing stronger is listed.
    if (tile.tone === 'good' || tile.tone === 'fair' || tile.tone === 'low') {
      const listed = out.filter(item => item.installationId === unit.installationId);
      // "Made less than the others" only counts for a unit whose battery had room to charge yesterday.
      const needed = hadRoomYesterday(history?.get(unit.installationId), now);
      for (const flag of mpptFlags(mppt?.get(unit.installationId), now, {needed, peerYield: peers})) {
        if (flag.kind === 'charger' || !listed.some(item => item.kind === 'alarm')) out.push({installationId: unit.installationId, name: unit.name, kind: flag.kind, line: flag.line});
      }
    }
    // Weather (best-effort): gray days ahead with the battery already down.
    if ((tile.tone === 'good' || tile.tone === 'fair') && tile.soc && !out.some(item => item.installationId === unit.installationId)) {
      const key = canonicalCameraUnit(unit.name), line = key ? cloudyWarning(weather?.get(key) ?? [], tile.soc.value) : null;
      if (line) out.push({installationId: unit.installationId, name: unit.name, kind: 'cloudy', line});
    }
  }
  const rank = {alarm: 0, charger: 1, low: 2, tonight: 3, panel: 4, fair: 5, overnight: 6, notfull: 7, load: 8, cloudy: 9, solar: 10, tight: 11, off: 12, unknown: 13};
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, undefined, {numeric: true}));
}
