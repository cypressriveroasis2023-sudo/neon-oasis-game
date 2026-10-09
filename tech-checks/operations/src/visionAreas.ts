export const visionAreas = [
  { workspace: 'Camera Health', label: 'Camera Health', icon: 'camera', description: 'Camera status, outages and diagnostics.' },
  { workspace: 'InHand Routers', label: 'InHand Routers', icon: 'router', description: 'Connections, router inventory and last checks.' },
  { workspace: 'Victron VRM', label: 'Victron Power', icon: 'power', description: 'Battery, solar and power dashboards.' },
  { workspace: 'Units On Hand', label: 'Units On Hand', icon: 'units', description: 'Shop inventory and units ready for deployment.' },
  { workspace: 'Field Map', label: 'Field View', icon: 'map', description: 'Installed units, GPS locations and site addresses.' },
  { workspace: 'Team', label: 'Team', icon: 'team', description: 'Your people, assignments and daily readiness.' },
] as const;
export const primaryAreas = [
  { workspace: 'Today', label: 'Dashboard', icon: 'dashboard' },
  ...visionAreas,
  { workspace: 'Unit Tracker', label: 'Unit Tracker', icon: 'units' },
  { workspace: 'Operations', label: 'Operations', icon: 'operations' },
] as const;
export const locationKey = (value: unknown) => String(value || '').trim().toLowerCase().replaceAll('_', ' ');
export function isOnHand(unit: Record<string, any>) {
  return ['shop', 'root', 'warehouse', 'yard'].includes(locationKey(unit.currentLocationType))
    && !['retired', 'deleted'].includes(locationKey(unit.status))
    && !unit.installedSiteId
    && !['installed', 'in transit', 'returning'].includes(locationKey(unit.status));
}
export const unitIdentity = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function onHandInventory(data: any) {
  const valid = (rows: any) => Array.isArray(rows) && rows.every((row: any) => row && typeof row === 'object' && typeof row.unitNumber === 'string' && typeof row.status === 'string' && (row.currentLocationType == null || typeof row.currentLocationType === 'string'));
  if (!valid(data?.items) || data.trackerUnits != null && !valid(data.trackerUnits)) throw new Error('Unit placement records could not be verified.');
  const native = data.items as Record<string, any>[], tracker = (data.trackerUnits || []) as Record<string, any>[];
  const nativePlaced = new Set(native.filter(row => row.currentLocationType || row.installedSiteId || ['installed', 'retired', 'deleted', 'in_transit', 'returning', 'assigned'].includes(row.status)).map(row => unitIdentity(row.unitNumber)));
  const trackerKnown = new Set(tracker.map(row => unitIdentity(row.unitNumber)));
  const units = native.filter(isOnHand), seen = new Set(units.map(row => unitIdentity(row.unitNumber)));
  for (const row of tracker) {
    const key = unitIdentity(row.unitNumber);
    if (!key || !isOnHand(row) || nativePlaced.has(key) || seen.has(key)) continue;
    units.push(row); seen.add(key);
  }
  return { units, unknown: native.filter(row => !row.currentLocationType && !trackerKnown.has(unitIdentity(row.unitNumber))).length, snapshot: data.trackerSnapshot };
}
export function locationLink(unit: { latitude?: unknown; longitude?: unknown; address?: string }) {
  const numeric = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
  const coordinates = numeric(unit.latitude) && numeric(unit.longitude) && Math.abs(Number(unit.latitude)) <= 90 && Math.abs(Number(unit.longitude)) <= 180;
  const query = coordinates ? `${unit.latitude},${unit.longitude}` : unit.address?.trim();
  return query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null;
}
