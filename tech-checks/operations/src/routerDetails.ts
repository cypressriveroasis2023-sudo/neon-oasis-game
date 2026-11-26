// InHand router facts for the unit card and the Link router list (cos-router-details, Tech Check).
// Owner and IT only. Best-effort: when it cannot be read, the card says so and nothing else changes.
import {readParentAccessToken} from './cosPowerAlarms';

const URL_ = 'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/cos-router-details';
/** The pull runs every 30 minutes. Two missed pulls and the reading is no longer called current. */
export const ROUTER_DETAIL_FRESH_MS = 75 * 60 * 1000;

export type RouterSignal = {level?: number; radio?: string; band?: string; rsrp?: number; rsrq?: number; sinr?: number; ts?: string};
export type RouterDetail = {
  unit: string; serial: string; model?: string; status?: 'online' | 'offline'; at?: string;
  ip?: string; ipFrom?: 'inhand' | 'cos'; cosDiffers?: boolean; port: number;
  sig?: RouterSignal; carrier?: string; fw?: string; gps?: {lat: number; lng: number; t?: string}; detailsAt?: string;
};
export type UnmatchedRouter = {serial: string; name: string | null; model: string | null; online: boolean; lastSeen: string | null; at: string};
export type RouterDetails = {routers: RouterDetail[]; unmatched: UnmatchedRouter[]; units: string[]};
export type RouterDetailsResult = {ok: true; data: RouterDetails} | {ok: false; denied: boolean; message: string};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const str = (v: unknown, max = 120) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined;
const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Same key the board uses for a unit: whole name, spaces collapsed, case ignored. */
export const unitKeyOf = (name: string) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function parseRouterDetails(value: unknown): RouterDetails {
  const v = value as Record<string, unknown>;
  if (!v || !Array.isArray(v.routers) || !Array.isArray(v.unmatched) || !Array.isArray(v.units)) throw Error('Router details unavailable');
  const routers = (v.routers as any[]).flatMap((r): RouterDetail[] => {
    const unit = str(r?.unit, 80), serial = str(r?.serial, 40);
    if (!unit || !serial) return [];
    const s = r.sig && typeof r.sig === 'object' ? r.sig : null;
    const sig: RouterSignal | undefined = s ? {level: fin(s.level), radio: str(s.radio, 8), band: str(s.band, 8), rsrp: fin(s.rsrp), rsrq: fin(s.rsrq), sinr: fin(s.sinr), ts: time(s.ts)} : undefined;
    const g = r.gps && typeof r.gps === 'object' ? r.gps : null;
    const gps = g && fin(g.lat) !== undefined && fin(g.lng) !== undefined && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180 ? {lat: g.lat, lng: g.lng, t: time(g.t)} : undefined;
    return [{
      unit, serial, model: str(r.model, 40),
      status: r.status === 'online' || r.status === 'offline' ? r.status : undefined, at: time(r.at),
      ip: typeof r.ip === 'string' && IPV4.test(r.ip) ? r.ip : undefined,
      ipFrom: r.ipFrom === 'inhand' || r.ipFrom === 'cos' ? r.ipFrom : undefined, cosDiffers: r.cosDiffers === true,
      port: 8080, sig, carrier: str(r.carrier, 24), fw: str(r.fw, 24), gps, detailsAt: time(r.detailsAt),
    }];
  });
  const unmatched = (v.unmatched as any[]).flatMap((u): UnmatchedRouter[] => {
    const serial = str(u?.serial, 40);
    return serial && /^[A-Z0-9-]{6,40}$/.test(serial) ? [{serial, name: str(u.name, 80) ?? null, model: str(u.model, 24) ?? null,
      online: u.online === true, lastSeen: time(u.lastSeen) ?? null, at: time(u.at) ?? ''}] : [];
  });
  const units = (v.units as unknown[]).flatMap(u => typeof u === 'string' && u.trim() ? [u.trim().slice(0, 80)] : []);
  return {routers, unmatched, units};
}

async function call(body: unknown, fetcher: typeof fetch, token?: string | null) {
  const access = token === undefined ? await readParentAccessToken() : token;
  if (!access) return {status: 401, json: {error: 'Sign in to COS to continue.'}};
  const response = await fetcher(URL_, {method: 'POST', headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json'}, body: JSON.stringify(body), cache: 'no-store'});
  let json: any = null;
  try { json = await response.json(); } catch { /* no body */ }
  return {status: response.status, json};
}

export async function readRouterDetails(fetcher: typeof fetch = fetch, token?: string | null): Promise<RouterDetailsResult> {
  try {
    const {status, json} = await call({action: 'read'}, fetcher, token);
    if (status === 200) return {ok: true, data: parseRouterDetails(json)};
    return {ok: false, denied: status === 401 || status === 403, message: (json && typeof json.error === 'string' && json.error) || 'Router details are unavailable right now.'};
  } catch { return {ok: false, denied: false, message: 'Router details are unavailable right now.'}; }
}

export async function linkRouter(unit: string, serial: string, fetcher: typeof fetch = fetch, token?: string | null): Promise<{ok: boolean; message: string}> {
  try {
    const {status, json} = await call({action: 'link', unit, serial}, fetcher, token);
    const message = (json && (typeof json.message === 'string' ? json.message : typeof json.error === 'string' ? json.error : '')) || 'The link could not be saved.';
    return {ok: status === 200 && json?.ok === true, message};
  } catch { return {ok: false, message: 'The link could not be saved. Check your connection and try again.'}; }
}

/** Signal in plain words, by LTE RSRP when known, else InHand's 0-5 level. */
export function signalWord(sig?: RouterSignal): 'Good' | 'Fair' | 'Poor' | null {
  if (!sig) return null;
  if (sig.rsrp !== undefined) return sig.rsrp >= -90 ? 'Good' : sig.rsrp >= -105 ? 'Fair' : 'Poor';
  if (sig.level !== undefined) return sig.level >= 4 ? 'Good' : sig.level >= 2 ? 'Fair' : 'Poor';
  return null;
}

/** Miles between two points. */
export function milesBetween(a: {lat: number; lng: number}, b: {lat: number; lng: number}): number {
  const r = (d: number) => d * Math.PI / 180, R = 3958.8;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** A suggested COS unit for an unlinked InHand router: same name once spaces and case are ignored, and only if exactly one. */
export function suggestUnit(name: string | null, units: string[]): string | null {
  if (!name) return null;
  const key = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/^SS(?=\d)/, 'SOLARSPOTTER');
  const hits = units.filter(u => u.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === key);
  return hits.length === 1 ? hits[0] : null;
}

/** 7 days of one router's signal, hourly, for the unit card (James, 25 Nov: tell a failing antenna from a one-off drop). */
export type TrendPoint = {t: string; rsrp?: number; level?: number; on: boolean};
export type RouterTrend = {unit: string; since: string | null; points: TrendPoint[]; recent: number | null; before: number | null;
  verdict: 'none' | 'offline' | 'young' | 'worse' | 'better' | 'steady'};
const VERDICTS = new Set(['none', 'offline', 'young', 'worse', 'better', 'steady']);
export function parseTrend(json: any): RouterTrend | null {
  if (!json || typeof json !== 'object' || !Array.isArray(json.points)) return null;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > -200 && v < 100 ? v : undefined;
  const points: TrendPoint[] = json.points.slice(-200).filter((p: any) => p && typeof p.t === 'string' && Number.isFinite(Date.parse(p.t)))
    .map((p: any) => ({t: p.t, rsrp: num(p.rsrp), level: typeof p.level === 'number' && p.level >= 0 && p.level <= 5 ? p.level : undefined, on: p.on === true}));
  return {unit: String(json.unit || ''), since: typeof json.since === 'string' ? json.since : null, points,
    recent: num(json.recent) ?? null, before: num(json.before) ?? null, verdict: VERDICTS.has(json.verdict) ? json.verdict : 'none'};
}
export async function readRouterTrend(unit: string, fetcher: typeof fetch = fetch, token?: string | null): Promise<RouterTrend | null> {
  try {
    const {status, json} = await call({action: 'trend', unit}, fetcher, token);
    return status === 200 ? parseTrend(json) : null;
  } catch { return null; }
}
/** The trend in one plain sentence. */
export function trendWords(t: RouterTrend | null): string {
  if (!t) return '';
  const d = t.recent !== null && t.before !== null ? Math.abs(Math.round(t.recent - t.before)) : 0;
  switch (t.verdict) {
    case 'worse': return 'Getting weaker: about ' + d + ' dB below the week before. A slow drop like this usually means the antenna, its cable or something new blocking it.';
    case 'better': return 'Better than the week before by about ' + d + ' dB.';
    case 'steady': return 'Steady over the week.';
    case 'offline': return 'Offline for most of the last day, so there is no recent signal to compare.';
    case 'young': return 'Signal history started ' + (t.since ? new Date(t.since).toLocaleDateString() : 'recently') + '; the week fills in day by day.';
    default: return 'No signal history yet.';
  }
}
