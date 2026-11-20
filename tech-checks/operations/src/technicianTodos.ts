import {cosPowerVerdict, powerSamples, type CosPowerSettings, type CosPowerVerdict} from './cosPowerAlarms';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {parseAddress} from '../../supabase/functions/camera-field-geocode/censusAddress';
import {safeVrmPower, type SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import {simCancelTodo} from './simCancelChecklist';
import {cameraProvesRouterUp} from './sharedFleetCounts';

export type TodoGroup = 'offline' | 'cleanup';

export type TechnicianTodo = {
  id: string;
  kind: 'camera_offline' | 'router_offline' | 'battery_alarm' | 'power_silent' | 'mhelp_address' | 'sim_cancel';
  unit: string;
  detail: string;
  group?: TodoGroup;
  severity?: 'offline' | 'alarm' | 'cleanup';
  action?: string;
};

export type TodoCamera = {
  unit: string;
  placement: 'FIELD' | 'SHOP' | string;
  state: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | string;
  offline: number;
  online?: number;
  unknown?: number;
};

export type TodoAddress = { unit: string; productId?: string; placement?: string; address?: string; bothLookupsFailed?: boolean };

const FIX_IN_MHELP = 'Address cannot be placed. Fix it in mHelpDesk. COS does not write that address.';
const CHECK_IF_WRONG = 'Address couldn\'t be mapped automatically. Check it in mHelpDesk if it looks wrong.';

/** A complete street address is not a bad mHelp record. Say so until both
 * lookups have failed. COS still does not write the address. */
export function addressTodoDetail(address: TodoAddress): string {
  if (address.bothLookupsFailed || !parseAddress(address.address || '')) return FIX_IN_MHELP;
  return CHECK_IF_WRONG;
}

export type TodoRouter = {
  unit: string;
  placement?: string;
  routerOffline: boolean;
  routerObservedAt: number | null;
  cameraOnlineAt: number | null;
};

const shop = (placement?: string) => placement === 'SHOP' || placement === 'shop';
const fieldUnit = (placement?: string) => placement === 'FIELD';

/** Jobs a technician can act on. Unknown, shop, and unset thresholds are not jobs. */
export function technicianTodos(input: {
  cameras?: TodoCamera[];
  routers?: TodoRouter[];
  power?: { unit: string; placement?: string; verdict: CosPowerVerdict }[];
  addresses?: TodoAddress[];
  simCancels?: { unit: string; productId: string; done?: boolean }[];
}): TechnicianTodo[] {
  const todos: TechnicianTodo[] = [];
  for (const camera of input.cameras ?? []) {
    if (camera.placement !== 'FIELD') continue;
    if ((camera.offline ?? 0) <= 0) continue;
    if (camera.state !== 'RED' && camera.state !== 'YELLOW') continue;
    todos.push({
      id: 'camera:'+camera.unit,
      kind: 'camera_offline',
      unit: camera.unit,
      group: 'offline',
      severity: 'offline',
      action: 'Open unit',
      detail: camera.offline === 1 ? '1 confirmed camera offline in the field.' : camera.offline+' confirmed cameras offline in the field.',
    });
  }
  for (const router of input.routers ?? []) {
    if (!fieldUnit(router.placement) || !router.routerOffline) continue;
    const provedUp = cameraProvesRouterUp(router.cameraOnlineAt, router.routerObservedAt);
    todos.push({
      id: 'router:'+router.unit,
      kind: 'router_offline',
      unit: router.unit,
      group: 'offline',
      severity: 'offline',
      action: 'Open unit',
      detail: provedUp
        ? 'Router is offline. A newer camera reading says this unit is up.'
        : 'Router is offline.',
    });
  }
  for (const power of input.power ?? []) {
    if (shop(power.placement)) continue;
    if (power.verdict.voltage === 'alarm' || power.verdict.soc === 'alarm') {
      const which = [power.verdict.voltage === 'alarm' ? 'voltage' : '', power.verdict.soc === 'alarm' ? 'charge' : ''].filter(Boolean).join(' and ');
      todos.push({id: 'battery:'+power.unit, kind: 'battery_alarm', unit: power.unit, group: 'offline', severity: 'alarm', action: 'Open unit', detail: 'COS '+which+' alarm. Victron\'s own alarm is a separate check.'});
    }
    if (power.verdict.silent === 'alarm') {
      todos.push({id: 'silent:'+power.unit, kind: 'power_silent', unit: power.unit, group: 'offline', severity: 'alarm', action: 'Open unit', detail: 'Power readings have been silent longer than the configured window.'});
    }
  }
  for (const item of input.simCancels ?? []) {
    if (item.done) continue;
    const todo = simCancelTodo(item);
    todos.push({...todo, group: 'cleanup', severity: 'cleanup', action: 'Open checklist'});
  }
  for (const address of input.addresses ?? []) {
    if (shop(address.placement)) continue;
    todos.push({
      id: 'address:'+(address.productId || address.unit),
      kind: 'mhelp_address',
      unit: address.unit,
      group: 'cleanup',
      severity: 'cleanup',
      action: 'Check address',
      detail: addressTodoDetail(address),
    });
  }
  const groupOf = (todo: TechnicianTodo): TodoGroup => todo.group ?? (todo.kind === 'mhelp_address' || todo.kind === 'sim_cancel' ? 'cleanup' : 'offline');
  return todos.sort((left, right) => groupOf(left) === groupOf(right) ? 0 : groupOf(left) === 'offline' ? -1 : 1);
}

/** One Helios, one Victron installation: matched only when the name is unique on both sides. */
export function victronInstallationsByUnit(units: readonly {unit: string}[], vrm: any, now: number): Map<string, SafeVrmPower> {
  const found = new Map<string, SafeVrmPower>();
  if (!vrm || !Array.isArray(vrm.items) || !Array.isArray(vrm.power)) return found;
  let power: SafeVrmPower[];
  try { power = safeVrmPower(vrm.power, vrm.items, now); } catch { return found; }
  for (const unit of units) {
    const key = canonicalCameraUnit(unit.unit);
    if (!key?.startsWith('HELIOS|')) continue;
    const matches = power.filter(row => canonicalCameraUnit(row.name) === key);
    if (matches.length === 1 && units.filter(other => canonicalCameraUnit(other.unit) === key).length === 1) found.set(unit.unit, matches[0]);
  }
  return found;
}

/** Battery alarms from the same Victron feed every screen reads. A missing feed contributes nothing. */
export function batteryAlarmPower(
  units: readonly {unit: string; placement?: string}[],
  vrm: any,
  now: number,
  settings: CosPowerSettings,
  feedFresh: boolean,
) {
  if (!feedFresh) return [];
  return [...victronInstallationsByUnit(units, vrm, now).entries()].map(([unit, power]) => {
    const picked = powerSamples(power.measurements);
    return {
      unit,
      placement: units.find(row => row.unit === unit)?.placement,
      verdict: cosPowerVerdict({now, settings, voltage: picked.voltage, soc: picked.soc, newestObservedAt: picked.newestObservedAt, victronLowVoltage: picked.victronLowVoltage}),
    };
  });
}

/**
 * Problems on every screen.
 * power_silent is omitted until a fresh Victron feed can gate it: an old last
 * reading, which a failed sync also produces, must not raise a power Problem.
 * A missing Victron feed (`victronFeedFresh: false`) drops power evidence entirely.
 * Address and SIM-cancel cleanup stay, exactly as the technician list shows them.
 */
export function fleetProblems(input: Parameters<typeof technicianTodos>[0] & { victronFeedFresh?: boolean } = {}): TechnicianTodo[] {
  const {victronFeedFresh, ...rest} = input;
  const power = victronFeedFresh === false ? [] : rest.power;
  return technicianTodos({...rest, power}).filter(todo => todo.kind !== 'power_silent');
}
