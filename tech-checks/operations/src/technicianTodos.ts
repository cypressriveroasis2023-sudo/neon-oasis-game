import type {CosPowerVerdict} from './cosPowerAlarms';
import {parseAddress} from '../../supabase/functions/camera-field-geocode/censusAddress';

export type TechnicianTodo = {
  id: string;
  kind: 'camera_offline' | 'battery_alarm' | 'power_silent' | 'mhelp_address';
  unit: string;
  detail: string;
  productId?: string;
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

/** Jobs a technician can act on. Unknown, shop, and unset thresholds are not jobs. */
export function technicianTodos(input: {
  cameras?: TodoCamera[];
  power?: { unit: string; placement?: string; verdict: CosPowerVerdict }[];
  addresses?: TodoAddress[];
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
      detail: camera.offline === 1 ? '1 confirmed camera offline in the field.' : camera.offline+' confirmed cameras offline in the field.',
    });
  }
  for (const power of input.power ?? []) {
    if (power.placement === 'SHOP') continue;
    if (power.verdict.voltage === 'alarm' || power.verdict.soc === 'alarm') {
      const which = [power.verdict.voltage === 'alarm' ? 'voltage' : '', power.verdict.soc === 'alarm' ? 'charge' : ''].filter(Boolean).join(' and ');
      todos.push({id: 'battery:'+power.unit, kind: 'battery_alarm', unit: power.unit, detail: 'COS '+which+' alarm. Victron\'s own alarm is a separate check.'});
    }
    if (power.verdict.silent === 'alarm') {
      todos.push({id: 'silent:'+power.unit, kind: 'power_silent', unit: power.unit, detail: 'Power readings have been silent longer than the configured window.'});
    }
  }
  for (const address of input.addresses ?? []) {
    if (address.placement === 'SHOP') continue;
    todos.push({
      id: 'address:'+(address.productId || address.unit),
      kind: 'mhelp_address',
      unit: address.unit,
      productId: address.productId,
      detail: addressTodoDetail(address),
    });
  }
  return todos;
}
