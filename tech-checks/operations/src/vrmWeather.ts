// Sun forecast for Field Helios units: "cloudy days ahead" with the battery already down.
// One batched, keyless Open-Meteo read (the same service the header weather uses). Coordinates are rounded to
// 2 decimals (~1 km) before they leave the browser. Display only: nothing is stored.
// A unit with no map point is aimed at the middle of its mHelp address's 3-digit ZIP area instead: the right
// town is all a two-day sun forecast needs, and that lookup is a table in the app (no extra request).
import {canonicalCameraUnit} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';
import {ZIP3_POINTS} from './zip3Points';

// A gray day is judged by the sunlight that reaches the ground, not by cloud cover: thin high cloud can read 96%
// "cloudy" while the panels still get a full day's sun (seen in the live Houston forecast, 14.8 MJ at 96% cloud).
export const GRAY_SUN_MJ = 7;          // under 7 MJ/m² (about 2 hours of full sun) barely charges a Helios
export const GRAY_CLOUD_PERCENT = 85;  // used only when the forecast has no sunlight figure for that day
export const CLOUDY_TWO_DAYS_BELOW = 80; // two gray days ahead and battery under 80% now -> warn
export const CLOUDY_ONE_DAY_BELOW = 60;  // the next day gray and battery under 60% now -> warn

export type Spot = {lat: number; lon: number};
export type SunDay = {date: string; mj: number | null; cloud: number | null};
export type OutlookDay = {date: string; label: string; gray: boolean; mj: number | null; cloud: number | null};

let zip3: Map<string, Spot> | null = null;
/** Middle of the 3-digit ZIP area at the end of a US address ("…, Houston, TX, 77078"), or null. */
export function zipAreaSpot(address: unknown): Spot | null {
  if (typeof address !== 'string') return null;
  const m = /\b[A-Za-z]{2}[\s,]+(\d{5})(?:-\d{4})?\s*$/.exec(address.trim());
  if (!m) return null;
  if (!zip3) {
    zip3 = new Map();
    for (const part of ZIP3_POINTS.split(';')) { const [lat, lon] = part.slice(3).split(',').map(Number); if (Number.isFinite(lat) && Number.isFinite(lon)) zip3.set(part.slice(0, 3), {lat, lon}); }
  }
  return zip3.get(m[1].slice(0, 3)) ?? null;
}

const num = (v: unknown) => { const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Field Helios units and where to aim their forecast, keyed by canonical Helios number: the saved map point, or
 * failing that the ZIP area of the mHelp service address. Shop units have no weather worry.
 */
export function heliosSpots(inventory: readonly unknown[] | null | undefined): Map<string, Spot> {
  const out = new Map<string, Spot>(), dupes = new Set<string>();
  for (const raw of inventory ?? []) {
    const unit = raw as {unitNumber?: unknown; latitude?: unknown; longitude?: unknown; address?: unknown; mhelpLocation?: {address?: unknown} | null} | null;
    if (!unit || typeof unit.unitNumber !== 'string') continue;
    const key = canonicalCameraUnit(unit.unitNumber);
    if (!key?.startsWith('HELIOS|')) continue;
    if (out.has(key) || dupes.has(key)) { out.delete(key); dupes.add(key); continue; }
    let placement: string;
    try { placement = inventoryPlacement(unit as Parameters<typeof inventoryPlacement>[0]); } catch { continue; }
    if (placement !== 'field') continue;
    const lat = num(unit.latitude), lon = num(unit.longitude);
    const pinned = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    const spot = pinned ? {lat: r2(lat), lon: r2(lon)} : zipAreaSpot(unit.address) ?? zipAreaSpot(unit.mhelpLocation?.address);
    if (spot) out.set(key, spot);
  }
  return out;
}

const URL_ = 'https://api.open-meteo.com/v1/forecast';

/** Daily sun for every spot in one request. Returns null on any failure (the page simply shows no weather). */
export async function readSunForecast(spots: ReadonlyMap<string, Spot>, fetcher: typeof fetch = fetch): Promise<Map<string, SunDay[]> | null> {
  const places: string[] = [], index = new Map<string, number>();
  const coords: Spot[] = [];
  for (const [key, s] of spots) {
    const id = s.lat + ',' + s.lon;
    if (!index.has(id)) { index.set(id, coords.length); coords.push(s); }
    places.push(key);
  }
  if (!coords.length) return new Map();
  const q = '?latitude=' + coords.map(c => c.lat).join(',') + '&longitude=' + coords.map(c => c.lon).join(',')
    + '&daily=shortwave_radiation_sum,cloud_cover_mean&forecast_days=4&timezone=America%2FChicago';
  try {
    const res = await fetcher(URL_ + q, {credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!res.ok) return null;
    const body = await res.json() as unknown;
    const list = Array.isArray(body) ? body : [body];
    if (list.length !== coords.length) return null;
    const days = list.map(parseDaily);
    const out = new Map<string, SunDay[]>();
    for (const key of places) {
      const s = spots.get(key)!; const d = days[index.get(s.lat + ',' + s.lon)!];
      if (d) out.set(key, d);
    }
    return out;
  } catch { return null; }
}

export function parseDaily(item: unknown): SunDay[] | null {
  const daily = (item as {daily?: {time?: unknown; shortwave_radiation_sum?: unknown; cloud_cover_mean?: unknown}} | null)?.daily;
  if (!daily || !Array.isArray(daily.time)) return null;
  const mj = Array.isArray(daily.shortwave_radiation_sum) ? daily.shortwave_radiation_sum : [];
  const cl = Array.isArray(daily.cloud_cover_mean) ? daily.cloud_cover_mean : [];
  return daily.time.filter((t): t is string => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t))
    .map((date, i) => ({date, mj: num(mj[i]), cloud: num(cl[i])}));
}

const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const isGray = (d: SunDay) => d.mj !== null ? d.mj < GRAY_SUN_MJ : d.cloud !== null && d.cloud >= GRAY_CLOUD_PERCENT;

/** The next two days that still have sun to give: today (before 3 PM) and tomorrow, or tomorrow and the day after. */
export function sunOutlook(days: readonly SunDay[] | null | undefined, now: number, count = 2): OutlookDay[] {
  if (!days?.length) return [];
  const d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getHours() >= 15 ? 1 : 0));
  const out: OutlookDay[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), key = ymd(day);
    const hit = days.find(x => x.date === key);
    if (!hit || (hit.mj === null && hit.cloud === null)) return out;
    const today = ymd(d) === key, tomorrow = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) === key;
    out.push({date: key, label: today ? 'Today' : tomorrow ? 'Tomorrow' : day.toLocaleDateString('en-US', {weekday: 'long'}), gray: isGray(hit), mj: hit.mj, cloud: hit.cloud});
  }
  return out;
}

/** "Cloudy days ahead" when the sky will not refill a battery that is already down. */
const said = (label: string) => label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label;
export function cloudyWarning(outlook: readonly OutlookDay[], battery: number | null | undefined): string | null {
  if (battery === null || battery === undefined || outlook.length < 1) return null;
  const gray = outlook.filter(d => d.gray).length;
  if (outlook.length >= 2 && gray >= 2 && battery < CLOUDY_TWO_DAYS_BELOW)
    return 'Cloudy days ahead · ' + said(outlook[0].label) + ' and ' + said(outlook[1].label) + ' look gray, battery ' + Math.round(battery) + '%';
  if (outlook[0].gray && battery < CLOUDY_ONE_DAY_BELOW)
    return 'Cloudy day ahead · ' + said(outlook[0].label) + ' looks gray, battery ' + Math.round(battery) + '%';
  return null;
}

/** Short sky line for one unit: "☀ Today · ☁ Tomorrow". */
export function outlookLine(outlook: readonly OutlookDay[]): string {
  return outlook.map(d => (d.gray ? '☁ ' : '☀ ') + d.label).join(' · ');
}

/** What a day's sun should put into a Helios battery. GAGO DD3 with its ~420 W panel kit (GG-DD3-VBWA-420S;
 * the best unit hit 450 W): sunlight in MJ/m² / 3.6 = kWh/m² = full-sun hours, times the panel watts, times 0.7
 * for heat, dust, angle and charger losses. Rough by design: it only has to tell a 0.2 kWh day from a 1 kWh day. */
export const PANEL_W = 420, PANEL_DERATE = 0.7;
export const harvestWh = (mj: number | null) => mj === null ? null : Math.round(mj / 3.6 * PANEL_W * PANEL_DERATE);

/** Fleet sun strip: the middle forecast across Field Helios for each of the next days. */
export function fleetSky(sky: ReadonlyMap<string, readonly SunDay[]> | null | undefined, keys: readonly string[], now: number, count = 4): OutlookDay[] {
  const per = keys.map(k => sunOutlook(sky?.get(k), now, count)).filter(o => o.length);
  if (!per.length) return [];
  const out: OutlookDay[] = [];
  for (let i = 0; i < count; i++) {
    const day = per.map(o => o[i]).filter(Boolean);
    if (!day.length) break;
    const mid = (v: (number | null)[]) => { const x = v.filter((n): n is number => n !== null).sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)] : null; };
    const mj = mid(day.map(d => d.mj)), cloud = mid(day.map(d => d.cloud));
    out.push({date: day[0].date, label: day[0].label, mj, cloud, gray: isGray({date: day[0].date, mj, cloud})});
  }
  return out;
}

/** Dark spell: walk the coming days with this unit's battery and use. Each night takes ~60% of a day's use before
 * dawn (the low point), the day adds the forecast sun and takes the rest. Only gray stretches can warn. */
export const DARK_SPELL_LOW = 20;
export type DarkSpell = {low: number; by: string; grayDays: number};
export function darkSpell(outlook: readonly OutlookDay[], batteryWh: number, usedWh: number, capacityWh: number): DarkSpell | null {
  if (!outlook.length || usedWh <= 0 || capacityWh <= 0) return null;
  const grayDays = outlook.filter(d => d.gray).length;
  if (!grayDays) return null;
  let b = batteryWh, low = b, by = '';
  for (const d of outlook) {
    if (d.label !== 'Today') b -= usedWh * 0.6;   // this morning's low has already passed
    if (b < low) { low = b; by = d.label; }
    const sun = harvestWh(d.mj) ?? (d.gray ? usedWh * 0.2 : usedWh * 1.3);
    b = Math.min(capacityWh, b + sun - usedWh * 0.4);
  }
  const pct = Math.max(0, Math.round(low / capacityWh * 100));
  return pct < DARK_SPELL_LOW ? {low: pct, by, grayDays} : null;
}
export const sayDay = (label: string) => label === 'Today' ? 'this morning' : label === 'Tomorrow' ? 'tomorrow morning' : label.slice(0, 3) + ' morning';
