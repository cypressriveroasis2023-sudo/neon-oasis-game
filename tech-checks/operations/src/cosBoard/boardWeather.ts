/* Weather at a unit's own site.
 *
 * A tech looking at a down unit wants to know what it is like where the unit
 * stands before deciding whether to roll a truck today or wait. The forecast
 * comes from Open-Meteo, which needs no API key and no account, so there is no
 * credential anywhere in this path and nothing to keep secret.
 *
 * Rules this file keeps:
 *  - the board must never wait on weather. Every read is guarded, a failure is
 *    reported in one line, and the unit card is drawn whether or not it works.
 *  - only a unit with a real point asks. A shop unit has lat/lng 0 and is skipped,
 *    so no request is made for a site that does not exist.
 *  - one read per site per session. Sites are rounded to ~1km, so twelve units on
 *    one yard share a single answer.
 */

export const WEATHER_DAYS = 14;            // this week and next
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const STALE_MS = 30 * 60 * 1000;           // a forecast is good for half an hour

export type WeatherDay = {date:string; hi:number|null; lo:number|null; code:number|null; rain:number|null};
export type SiteWeather = {
  nowF:number|null; nowCode:number|null; windMph:number|null;
  days:WeatherDay[]; readAt:number;
};
type Entry = {at:number; value:SiteWeather|null; error:string|null; inflight:Promise<void>|null};

const cache = new Map<string,Entry>();

/** ~1km buckets, so a yard full of units asks once. */
export function siteKey(lat:number, lng:number):string {
  return lat.toFixed(2) + ',' + lng.toFixed(2);
}

/** A unit only has weather if it has a real point. Shop units carry 0,0. */
export function hasSite(lat:unknown, lng:unknown):boolean {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) > 0.0001 && Math.abs(lng) > 0.0001
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/* WMO weather codes, in the words a tech would use. */
const WORDS:Record<number,string> = {
  0:'Clear', 1:'Mostly clear', 2:'Partly cloudy', 3:'Cloudy',
  45:'Fog', 48:'Freezing fog',
  51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
  56:'Freezing drizzle', 57:'Freezing drizzle',
  61:'Light rain', 63:'Rain', 65:'Heavy rain',
  66:'Freezing rain', 67:'Freezing rain',
  71:'Light snow', 73:'Snow', 75:'Heavy snow', 77:'Snow grains',
  80:'Showers', 81:'Showers', 82:'Heavy showers',
  85:'Snow showers', 86:'Snow showers',
  95:'Thunderstorms', 96:'Thunderstorms with hail', 99:'Thunderstorms with hail',
};
export function weatherWords(code:number|null|undefined):string {
  if(code==null) return '';
  return WORDS[code] || 'Unsettled';
}

/** True when the forecast is the kind that keeps a truck in the yard. */
export function roughDay(code:number|null|undefined, rainChance:number|null|undefined):boolean {
  if(code!=null && (code>=95 || (code>=65&&code<=67) || code===75 || code===82 || code===86)) return true;
  return typeof rainChance === 'number' && rainChance >= 70;
}

function parse(json:any):SiteWeather {
  const d = json && json.daily, c = json && json.current;
  const days:WeatherDay[] = [];
  const times:string[] = (d && Array.isArray(d.time)) ? d.time : [];
  for(let i=0;i<times.length && i<WEATHER_DAYS;i++) days.push({
    date: times[i],
    hi: num(d.temperature_2m_max?.[i]),
    lo: num(d.temperature_2m_min?.[i]),
    code: num(d.weather_code?.[i]),
    rain: num(d.precipitation_probability_max?.[i]),
  });
  return {
    nowF: num(c && c.temperature_2m),
    nowCode: num(c && c.weather_code),
    windMph: num(c && c.wind_speed_10m),
    days, readAt: Date.now(),
  };
}
function num(value:unknown):number|null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** What is known right now. Never throws, never waits. */
export function peekSiteWeather(lat:number, lng:number):{value:SiteWeather|null; error:string|null; loading:boolean} {
  const entry = cache.get(siteKey(lat,lng));
  if(!entry) return {value:null, error:null, loading:false};
  return {value:entry.value, error:entry.error, loading:entry.inflight!==null};
}

/**
 * Ask for a site's weather if it is not already known and fresh. Returns a
 * promise that settles when there is something new to draw, or null when the
 * cached answer already stands. Rejection is impossible by construction.
 */
export function loadSiteWeather(lat:number, lng:number, fetchImpl?:typeof fetch):Promise<void>|null {
  if(!hasSite(lat,lng)) return null;
  const key = siteKey(lat,lng), existing = cache.get(key);
  if(existing){
    if(existing.inflight) return existing.inflight;
    if(existing.value && Date.now()-existing.at < STALE_MS) return null;
  }
  const doFetch = fetchImpl || (typeof fetch==='function' ? fetch : null);
  if(!doFetch){
    cache.set(key,{at:Date.now(), value:null, error:'Weather is not available here.', inflight:null});
    return null;
  }
  const url = ENDPOINT
    + '?latitude=' + encodeURIComponent(lat.toFixed(4))
    + '&longitude=' + encodeURIComponent(lng.toFixed(4))
    + '&current=temperature_2m,weather_code,wind_speed_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
    + '&timezone=auto&forecast_days=' + WEATHER_DAYS;

  const entry:Entry = existing || {at:0, value:null, error:null, inflight:null};
  cache.set(key, entry);
  entry.inflight = (async () => {
    try{
      const response = await doFetch(url, {headers:{accept:'application/json'}});
      if(!response || !response.ok) throw new Error('read failed');
      const parsed = parse(await response.json());
      if(!parsed.days.length && parsed.nowF==null) throw new Error('empty');
      entry.value = parsed; entry.error = null;
    }catch{
      // A missing forecast is never worth breaking a unit card over.
      entry.error = 'Weather could not be read for this site.';
    }finally{
      entry.at = Date.now(); entry.inflight = null;
    }
  })();
  return entry.inflight;
}

/** Only for tests: forget everything read so far. */
export function resetSiteWeather():void { cache.clear(); }

export const WEATHER_CSS = `
.wx{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.wx b{font-size:22px;font-weight:700}
.wx span{opacity:.85}
.wxdays{display:flex;gap:6px;overflow-x:auto;margin-top:8px;padding-bottom:2px}
.wxday{flex:0 0 auto;min-width:62px;text-align:center;border:1px solid var(--line,#2a3342);border-radius:8px;padding:6px 4px}
.wxday em{display:block;font-style:normal;font-size:11px;opacity:.75}
.wxday strong{display:block;font-size:15px}
.wxday u{display:block;text-decoration:none;font-size:12px;opacity:.7}
.wxday i{display:block;font-style:normal;font-size:10px;opacity:.7;margin-top:2px}
.wxday.rough{border-color:#c2410c}
.wxnote{opacity:.75;font-size:12px;margin-top:6px}
`;
