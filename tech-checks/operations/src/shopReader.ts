/** How a Shop unit is shown. The saved probe stays on the record. */
export const SHOP_LABEL = 'In Shop';
export const SHOP_COLOR = '#64748b';
export const OFFLINE_COLOR = '#ff2734';

export type ShopRole = 'Owner' | 'IT' | string | null | undefined;

export function isShopPlacement(value: unknown): boolean {
  const text = String(value || '').trim().toLowerCase();
  return text === 'shop' || text === 'root' || text === 'warehouse' || text === 'yard';
}

export function shopLastCheck(input: {
  savedReading?: string | null;
  checkedAt?: string | null;
  reason?: string | null;
  role?: ShopRole;
}): string | null {
  if (input.savedReading !== 'offline') return null;
  if (input.role !== 'Owner' && input.role !== 'IT') return null;
  const when = input.checkedAt && Number.isFinite(Date.parse(input.checkedAt)) ? input.checkedAt : 'time not recorded';
  const reason = String(input.reason || 'The saved check did not answer.').replace(/\boffline\b/gi, 'not answering');
  return 'Last check failed. ' + when + '. ' + reason;
}

export function shopRouterReading(probeStatus: string, placement: unknown, checkedAt: string | null, role?: ShopRole) {
  if (!isShopPlacement(placement)) return null;
  return {
    primary: SHOP_LABEL,
    color: SHOP_COLOR,
    alert: false as const,
    visibleProbe: SHOP_LABEL,
    detail: shopLastCheck({ savedReading: probeStatus === 'offline' ? 'offline' : probeStatus, checkedAt, reason: 'The saved port check did not answer.', role }),
  };
}

export function shopCameraLine(placement: unknown, status: string): string | null {
  if (!isShopPlacement(placement)) return null;
  return SHOP_LABEL;
}

export function countsShopOutage(): { offline: 0; online: 0; unknown: 0; outage: 0; alert: false } {
  return { offline: 0, online: 0, unknown: 0, outage: 0, alert: false };
}
