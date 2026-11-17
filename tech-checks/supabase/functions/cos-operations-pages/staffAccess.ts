/** Three staff roles. This only refuses. It never grants a route the older checks deny. */

export type StaffRole = 'owner' | 'it' | 'service';

const ACCOUNT_PREFIXES = [
  '/api/account',
  '/api/users',
  '/api/roles',
  '/api/security',
  '/api/auth/settings',
];

const SERVICE_GET = new Set([
  '/api/session',
  '/api/fleet-saved-board',
  '/api/field-map',
  '/api/unit-camera-status',
  '/api/camera-health/summary-v3',
  '/api/routers',
  '/api/vrm-fleet',
  '/api/product-connections',
]);

const SERVICE_POST = new Set([
  '/api/tech-checklist/check-off',
  '/api/fleet-saved-board/refresh',
]);

export function staffRole(input: { role?: unknown; department?: unknown; legacyOwner?: unknown } | null | undefined): StaffRole | null {
  const role = String(input?.role || input?.department || '').toLowerCase();
  if (input?.legacyOwner === true || role === 'owner') return 'owner';
  if (role === 'it') return 'it';
  if (role === 'service') return 'service';
  return null;
}

export function accountPath(path: string): boolean {
  return ACCOUNT_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'));
}

/** Null means this rule does not refuse. Older owner and IT checks still run. */
export function denyStaffRoute(role: StaffRole | null, method: string, path: string): string | null {
  if (role === 'owner') return null;
  if (accountPath(path)) return 'Account, password, and security changes stay with the owner.';
  if (role === 'it') return null;
  if (role !== 'service') return 'A signed-in staff account is required.';
  const checklist = method === 'GET' && SERVICE_GET.has(path)
    || method === 'POST' && SERVICE_POST.has(path);
  return checklist ? null : 'Service can only work the tech check inventory list.';
}
