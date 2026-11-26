/** Pure rules for cos-router-details, kept apart so they can be tested without a server. */
export type Profile = { id: string; name: string; role: string; active: boolean };
export type Request_ = { action: 'read' } | { action: 'link'; unit: string; serial: string } | { action: 'trend'; unit: string };

/** Owner and IT only, active, not archived. Service techs do not see router addresses. */
export function allowed(profile: Profile | null): boolean {
  return !!profile && profile.active && (profile.role === 'owner' || profile.role === 'it');
}

export function readRequest(body: unknown): Request_ | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.action === 'read' && Object.keys(b).length === 1) return { action: 'read' };
  if (b.action === 'trend' && typeof b.unit === 'string' && Object.keys(b).length === 2) {
    const unit = b.unit.trim();
    return unit && unit.length <= 80 ? { action: 'trend', unit } : null;
  }
  if (b.action === 'link' && typeof b.unit === 'string' && typeof b.serial === 'string') {
    const unit = b.unit.trim(), serial = b.serial.trim().toUpperCase();
    if (!unit || unit.length > 80 || !/^[A-Z0-9-]{6,40}$/.test(serial)) return null;
    return { action: 'link', unit, serial };
  }
  return null;
}
