// Installation IDs verified against the signed-in COS VRM fleet, 2026-10-05.
// These dashboard links require VRM sign-in; sharing tokens never live in source.
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
export type VrmUnit = { number: number; name: string; installationId: number; portalUrl: string; embedUrl: string | null };
export const vrmPortalUrl = (id: number) => 'https://vrm.victronenergy.com/installation/' + id + '/dashboard';
export function validVrmEmbed(value: unknown, id: number): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://vrm.victronenergy.com' && !url.username && !url.password && !url.hash &&
      new RegExp('^/installation/' + id + '/embed/[A-Za-z0-9_-]+/?$').test(url.pathname);
  } catch { return false; }
}
export function vrmPortalConfig(raw?: string): { items: VrmUnit[] } {
  const config: unknown = raw ? JSON.parse(raw) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
    Object.keys(config).some(id => !heliosVrmUnits.some(unit => String(unit.installationId) === id))) throw new Error('VRM dashboard configuration is unavailable.');
  const links = config as Record<string, unknown>;
  return { items: heliosVrmUnits.map(unit => {
    const embedUrl = links[String(unit.installationId)];
    if (embedUrl != null && !validVrmEmbed(embedUrl, unit.installationId)) throw new Error('VRM dashboard configuration is unavailable.');
    return { ...unit, portalUrl: vrmPortalUrl(unit.installationId), embedUrl: typeof embedUrl === 'string' ? embedUrl : null };
  }) };
}
export function readVrmPortalConfig(value: unknown): VrmUnit[] {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length !== heliosVrmUnits.length) throw new Error('VRM returned an incomplete unit list.');
  return heliosVrmUnits.map(expected => {
    const matching = items.filter(unit => unit?.installationId === expected.installationId);
    const item = matching[0];
    if (matching.length !== 1 || item.number !== expected.number || item.name !== expected.name || item.portalUrl !== vrmPortalUrl(expected.installationId) ||
      (item.embedUrl !== null && !validVrmEmbed(item.embedUrl, expected.installationId))) throw new Error('VRM returned inconsistent unit links.');
    return { ...expected, portalUrl: item.portalUrl, embedUrl: item.embedUrl };
  });
}

