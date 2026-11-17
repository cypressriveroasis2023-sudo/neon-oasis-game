import {POWER_FRESH_MS} from './cameraEvidence';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';
import {cosPowerVerdict, powerSamples, type CosPowerSettings, type PowerMeasurement, type PowerSample} from './cosPowerAlarms';

export type VictronPlacement = 'field' | 'shop' | 'unknown';
export type VictronAttentionKind = 'power' | 'unknown' | 'shop';
export type VictronAttention = {
  installationId: number;
  name: string;
  placement: VictronPlacement;
  kind: VictronAttentionKind;
  line: string;
};

type InventoryUnit = {
  unitNumber?: string;
  placement?: string;
  currentLocationType?: string;
  effectivePlacement?: {contract?: string; state?: string};
};

type PowerRow = {installationId: number; name: string; measurements?: PowerMeasurement[] | null};

/** One mHelp unit with the same family and number. Two matches stay unknown. */
export function heliosPlacement(name: string, inventory: InventoryUnit[]): VictronPlacement {
  const key = canonicalCameraUnit(name);
  if (!key?.startsWith('HELIOS|')) return 'unknown';
  const matches = inventory.filter(unit => typeof unit?.unitNumber === 'string' && canonicalCameraUnit(unit.unitNumber) === key);
  if (matches.length !== 1) return 'unknown';
  return inventoryPlacement(matches[0] as Parameters<typeof inventoryPlacement>[0]);
}

export function placementLabel(placement: VictronPlacement): string {
  return placement === 'field' ? 'Field' : placement === 'shop' ? 'Shop' : 'Placement unknown';
}

function charge(samples: ReturnType<typeof powerSamples>): string {
  return samples.soc ? samples.soc.value+'%' : 'no charge reading';
}

function fresh(sample: PowerSample | null, now: number): boolean {
  if (!sample) return false;
  const time = Date.parse(sample.observedAt);
  return Number.isFinite(time) && time <= now + 60_000 && now - time <= POWER_FRESH_MS;
}

/** Field charge under the owner threshold is a power issue. Shop is never an alarm.
 * A stale reading stays Unknown. A low fresh battery is not called offline. */
export function victronNeedsAttention(input: {
  units: {installationId: number; name: string}[];
  inventory: InventoryUnit[];
  power: PowerRow[];
  settings: CosPowerSettings;
  now: number;
}): VictronAttention[] {
  const lines: VictronAttention[] = [];
  for (const unit of input.units) {
    const placement = heliosPlacement(unit.name, input.inventory);
    const rows = input.power.filter(row => row.installationId === unit.installationId && row.name === unit.name);
    const samples = powerSamples(rows.length === 1 ? rows[0].measurements : []);
    const verdict = cosPowerVerdict({
      now: input.now,
      settings: input.settings,
      voltage: samples.voltage,
      soc: samples.soc,
      newestObservedAt: samples.newestObservedAt,
    });
    const stale = (samples.soc && !fresh(samples.soc, input.now)) || (!samples.soc && samples.voltage && !fresh(samples.voltage, input.now));
    const missing = !samples.soc && !samples.voltage;
    if (placement !== 'field') {
      if (placement === 'shop' && (verdict.soc === 'alarm' || verdict.voltage === 'alarm' || stale || missing)) {
        lines.push({installationId: unit.installationId, name: unit.name, placement, kind: 'shop', line: unit.name+' — Shop · shop attention · '+charge(samples)});
      }
      continue;
    }
    if (stale || missing) lines.push({installationId: unit.installationId, name: unit.name, placement, kind: 'unknown', line: unit.name+' — Field · power unknown'});
    else if (verdict.soc === 'alarm') lines.push({installationId: unit.installationId, name: unit.name, placement, kind: 'power', line: unit.name+' — Field · charge '+charge(samples)+' · power issue'});
    else if (verdict.voltage === 'alarm') lines.push({installationId: unit.installationId, name: unit.name, placement, kind: 'power', line: unit.name+' — Field · voltage '+(samples.voltage ? samples.voltage.value+' V' : 'unreported')+' · power issue'});
  }
  const rank = {power: 0, unknown: 1, shop: 2};
  return lines.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
}
