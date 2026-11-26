/** What one alert looks like as a phone push. Pure, so it can be tested without a server. */
export type Alert = { kind: 'down' | 'back'; unit: string | null; title: string; body: string };

/** The Tech Check app opens ./?fieldUnit=<unit>, which lands on the board's own unit card. */
export function pushPayload(alert: Alert, badge: number): string {
  const unit = typeof alert.unit === 'string' && alert.unit.length <= 120 && !/[\u0000-\u001f]/.test(alert.unit) ? alert.unit : '';
  return JSON.stringify({
    title: String(alert.title || 'Router alert').slice(0, 120),
    body: String(alert.body || '').slice(0, 400),
    url: unit ? './?fieldUnit=' + encodeURIComponent(unit) : './?fleetDashboard=1',
    kind: alert.kind === 'back' ? 'router_back' : 'router_down',
    badge_count: String(Math.max(1, badge)),
  });
}

export function readAlerts(value: unknown): Alert[] {
  const list = (value as { alerts?: unknown })?.alerts;
  if (!Array.isArray(list)) return [];
  return list.filter(a => a && typeof a === 'object' && typeof (a as Alert).title === 'string')
    .map(a => ({ kind: (a as Alert).kind === 'back' ? 'back' : 'down', unit: typeof (a as Alert).unit === 'string' ? (a as Alert).unit : null,
      title: (a as Alert).title, body: typeof (a as Alert).body === 'string' ? (a as Alert).body : '' }));
}
