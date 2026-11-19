import { readRouterSnapshot, routerSnapshot, type RouterSnapshot } from './routers.ts';

/** Exact router address fields. Matching is the whole name, never a substring. */
export const ROUTER_ADDRESS_FIELDS = ['router_public_ip', 'unit_ip', 'public_ip', 'private_ip', 'publicIp', 'unitIp', 'privateIp', 'wanIp', 'lanIp', 'wan', 'lan', 'ip'] as const;
const routerAddressFields = new Set<string>(ROUTER_ADDRESS_FIELDS);

function omitRouterAddressFields(row: object) {
  for (const key of Object.keys(row)) if (routerAddressFields.has(key)) delete (row as Record<string, unknown>)[key];
}

/** The durable board imports routers.ts directly. This wrapper is the only address-field removal. */
export function routerSnapshotWithoutAddresses(routers: Parameters<typeof routerSnapshot>[0], units: Parameters<typeof routerSnapshot>[1], now?: Date): RouterSnapshot {
  const value = routerSnapshot(routers, units, now);
  for (const row of value.items) omitRouterAddressFields(row);
  return value;
}

export function readRouterSnapshotWithoutAddresses(value: unknown): RouterSnapshot {
  const data = value as { items?: unknown };
  if (data && typeof data === 'object' && Array.isArray(data.items)) {
    for (const row of data.items) if (row && typeof row === 'object') omitRouterAddressFields(row);
  }
  return readRouterSnapshot(value);
}
