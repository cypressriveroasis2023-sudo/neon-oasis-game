// Sun forecast for Field Helios units: "cloudy days ahead" with the battery already down.
// One batched, keyless Open-Meteo read (the same service the header weather uses). Coordinates are rounded to
// 2 decimals (~1 km) before they leave the browser. Display only: nothing is stored.
import {canonicalCameraUnit} from './fieldCameraHealth';
import {inventoryPlacement} from './fleetSnapshot';

export const GRAY_SUN_MJ = 5;          // a day under 5 MJ/m² of sunlight barely charges a Helios
export const GRAY_CLOUD_PERCENT = 85;  // ... or a day that is mostly overcast
export const CLOUDY_TWO_DAYS_BELOW = 80; // two gray days ahead and battery under 80% now -> warn
export const CLOUDY_ONE_DAY_BELOW = 60;  // the next day gray and battery under 60% now -> warn

export type Spot = {lat: number; lon: number};
export type SunDay = {date: string; mj: number | null; cloud: number | null};
export type OutlookDay = {date: string; label: string; gray: boolean; mj: number | null; cloud: number | null};

const num = (v: unknown) => { const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Field Helios units with usable coordinates, keyed by canonical Helios number. Shop units have no weather worry. */
export function heliosSpots(inventory: readonly unknown[] | null | undefined): Map<string, Spot> {
  const out = new Map<string, Spot>(), dupes = new Set<string>();
  for (const raw of inventory ?? []) {
    const unit = raw as {unitNumber?: unknown; latitude?: unknown; longitude?: unknown} | null;
    if (!unit || typeof unit.unitNumber !== 'string') continue;
    const key = canonicalCameraUnit(unit.unitNumber);
    if (!key?.startsWith('HELIOS|')) continue;
    if (out.has(key) || dupes.has(key)) { out.delete(key); dupes.add(key); continue; }
    let placement: string;
    try { placement = inventoryPlacement(unit as Parameters<typeof inventoryPlacement>[0]); } catch { continue; }
    const lat = num(unit.latitude), lon = num(unit.longitude);
    if (placement !== 'field' || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    out.set(key, {lat: r2(lat), lon: r2(lon)});
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
export const isGray = (d: SunDay) => (d.mj !== null && d.mj < GRAY_SUN_MJ) || (d.cloud !== null && d.cloud >= GRAY_CLOUD_PERCENT);

/** The next two days that still have sun to give: today (before 3 PM) and tomorrow, or tomorrow and the day after. */
export function sunOutlook(days: readonly SunDay[] | null | undefined, now: number): OutlookDay[] {
  if (!days?.length) return [];
  const d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getHours() >= 15 ? 1 : 0));
  const out: OutlookDay[] = [];
  for (let i = 0; i < 2; i++) {
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
