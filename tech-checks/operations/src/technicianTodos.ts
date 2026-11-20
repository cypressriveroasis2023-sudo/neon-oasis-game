import type {CosPowerVerdict} from './cosPowerAlarms';
import {ageFeed} from './feedFreshness';
import {parseAddress} from '../../supabase/functions/camera-field-geocode/censusAddress';
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
  power?: { unit: string; placement?: string; verdict: CosPowerVerdict; victronFeedReadAt?: string | null }[];
  now?: number;
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
    const feedKnown = 'victronFeedReadAt' in power;
    const feedFresh = !feedKnown || ageFeed(power.victronFeedReadAt, input.now ?? Date.now(), 'victron').state === 'fresh';
    if (power.verdict.silent === 'alarm' && feedFresh) {
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
