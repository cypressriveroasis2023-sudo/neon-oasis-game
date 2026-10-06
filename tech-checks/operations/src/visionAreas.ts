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
  { workspace: 'Operations', label: 'Operations', icon: 'operations' },
] as const;
export const locationKey = (value: unknown) => String(value || '').trim().toLowerCase().replaceAll('_', ' ');
export function isOnHand(unit: Record<string, any>) {
  return ['shop', 'root', 'warehouse', 'yard'].includes(locationKey(unit.currentLocationType))
    && !['retired', 'deleted'].includes(locationKey(unit.status))
    && !unit.installedSiteId
    && !['installed', 'in transit', 'returning'].includes(locationKey(unit.status));
}
export function locationLink(unit: { latitude?: unknown; longitude?: unknown; address?: string }) {
  const numeric = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
  const coordinates = numeric(unit.latitude) && numeric(unit.longitude) && Math.abs(Number(unit.latitude)) <= 90 && Math.abs(Number(unit.longitude)) <= 180;
  const query = coordinates ? `${unit.latitude},${unit.longitude}` : unit.address?.trim();
  return query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null;
}
