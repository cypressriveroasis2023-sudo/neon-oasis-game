// Bootstrap only: installation IDs verified in the signed-in COS fleet on 2026-10-05.
// Runtime discovery and selection use the immutable VRM installation ID, never a name/number.
export const heliosVrmUnits = [
  { number: 1, name: 'HELIOS 001', installationId: 1022969 },
  { number: 2, name: 'HELIOS 002', installationId: 1022961 },
  { number: 3, name: 'HELIOS 003', installationId: 1018314 },
  { number: 4, name: 'HELIOS 004', installationId: 1022780 },
  { number: 5, name: 'HELIOS 005', installationId: 1023504 },
  { number: 6, name: 'HELIOS 006', installationId: 1026733 },
  { number: 7, name: 'HELIOS 007', installationId: 1027440 },
  { number: 8, name: 'HELIOS 008', installationId: 1039531 },
  { number: 9, name: 'HELIOS 009', installationId: 1039500 },
] as const;
export type VrmInstallation = { number?: number; name: string; installationId: number; lastSeenAt?: string | null; available?: boolean };
export type VrmUnit = VrmInstallation & { portalUrl: string; embedUrl: string | null };
export type VrmSync = {
  state: 'not_configured' | 'idle' | 'syncing' | 'current' | 'stale' | 'error';
  lastAttemptAt: string | null; lastSuccessAt: string | null; nextSyncAt: string | null;
  error: string | null; scheduleActive: boolean; connectionConfigured?: boolean;
};
export type VrmFleetConfig = { items: VrmUnit[]; sync: VrmSync };
export const VRM_MAX_INSTALLATIONS = 5000;
export const vrmPortalUrl = (id: number) => 'https://vrm.victronenergy.com/installation/' + id + '/dashboard';
export const validInstallationId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
export const validVrmName = (name: unknown): name is string => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);
const validTime = (value: unknown) => value === null || typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));
export const unconfiguredVrmSync = (): VrmSync => ({ state: 'not_configured', lastAttemptAt: null, lastSuccessAt: null, nextSyncAt: null, error: null, scheduleActive: false, connectionConfigured: false });
export function validVrmEmbed(value: unknown, id: number): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !validInstallationId(id)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://vrm.victronenergy.com' && !url.username && !url.password && !url.hash &&
      new RegExp('^/installation/' + id + '/embed/[A-Za-z0-9_-]+/?$').test(url.pathname);
  } catch { return false; }
}
export function vrmPortalConfig(raw?: string, installations: readonly VrmInstallation[] = heliosVrmUnits, sync = unconfiguredVrmSync()): VrmFleetConfig {
  const config: unknown = raw ? JSON.parse(raw) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('VRM dashboard configuration is unavailable.');
  const links = config as Record<string, unknown>;
  // Approvals remain bound to their exact installation, including installations not currently accessible.
  for (const [key, link] of Object.entries(links)) {
    const id = Number(key);
    if (!validInstallationId(id) || String(id) !== key || link !== null && !validVrmEmbed(link, id)) throw new Error('VRM dashboard configuration is unavailable.');
  }
  const items = installations.map(unit => ({ ...unit, portalUrl: vrmPortalUrl(unit.installationId),
    embedUrl: unit.available === false ? null : typeof links[String(unit.installationId)] === 'string' ? links[String(unit.installationId)] as string : null }));
  return readVrmFleetConfig({ items, sync });
}
export function readVrmFleetConfig(value: unknown): VrmFleetConfig {
  const data = value as { items?: unknown; sync?: unknown } | null;
  if (!Array.isArray(data?.items) || data.items.length > VRM_MAX_INSTALLATIONS) throw new Error('VRM returned an invalid installation list.');
  const seen = new Set<number>();
  const items = data.items.map((item: VrmUnit) => {
    if (!item || !validInstallationId(item.installationId) || seen.has(item.installationId) || !validVrmName(item.name) ||
      item.portalUrl !== vrmPortalUrl(item.installationId) || (item.embedUrl !== null && !validVrmEmbed(item.embedUrl, item.installationId)) ||
      item.number !== undefined && !validInstallationId(item.number) || item.available !== undefined && typeof item.available !== 'boolean' ||
      item.lastSeenAt !== undefined && !validTime(item.lastSeenAt) || item.available === false && item.embedUrl !== null) throw new Error('VRM returned inconsistent installation links.');
    seen.add(item.installationId);
    return { installationId: item.installationId, name: item.name, portalUrl: item.portalUrl, embedUrl: item.embedUrl,
      ...(item.number === undefined ? {} : { number: item.number }), ...(item.available === undefined ? {} : { available: item.available }),
      ...(item.lastSeenAt === undefined ? {} : { lastSeenAt: item.lastSeenAt }) };
  });
  const sync = (data.sync ?? unconfiguredVrmSync()) as VrmSync;
  if (!sync || !['not_configured','idle','syncing','current','stale','error'].includes(sync.state) ||
    ![sync.lastAttemptAt,sync.lastSuccessAt,sync.nextSyncAt].every(validTime) ||
    typeof sync.scheduleActive !== 'boolean' || sync.connectionConfigured !== undefined && typeof sync.connectionConfigured !== 'boolean' ||
    sync.error !== null && (typeof sync.error !== 'string' || sync.error.length > 300)) throw new Error('VRM returned invalid sync status.');
  return { items, sync: { state: sync.state, lastAttemptAt: sync.lastAttemptAt, lastSuccessAt: sync.lastSuccessAt,
    nextSyncAt: sync.nextSyncAt, error: sync.error, scheduleActive: sync.scheduleActive,
    ...(sync.connectionConfigured === undefined ? {} : { connectionConfigured: sync.connectionConfigured }) } };
}
export function readVrmPortalConfig(value: unknown): VrmUnit[] { return readVrmFleetConfig(value).items; }
