import { hasGpsCoordinates } from '../shared/gpsValidation';
import { routerStatus, type RouterRow, type RouterStatus } from '../../supabase/functions/cos-operations-pages/routers';
export type FieldLocation = {
  id: string; unitNumber: string; placementAuditId?:string; placementUnitKey?:string; locationGeocode?:Record<string,any>;
  addressEstimateTrackerId?: string|null; addressEstimateUnitNumber?: string|null; address?: string; latitude?: number|string|null; longitude?: number|string|null;
  coordinateSource?: string|null; gpsRecordedAt?: string|null; hasUnitGps?: boolean; readOnly?: boolean;
  addressSource?: string|null; addressUpdatedAt?: string|null; sourceVerifiedAt?: string|null;
  locationVerification?: string|null; locationVerifiedAt?: string|null; locationNote?: string|null;
  historicalLatitude?:number|string|null; historicalLongitude?:number|string|null;
  historicalCoordinateSource?:string|null; historicalRecordedAt?:string|null;
};
/** Only a reviewed current-address pin belongs in current locations / nearby routing. */
export function isCurrentFieldPin(unit: FieldLocation) {
  return unit.locationVerification==='owner_verified' && Boolean(unit.address?.trim()) && hasGpsCoordinates(unit)
    && typeof unit.locationVerifiedAt==='string' && Number.isFinite(Date.parse(unit.locationVerifiedAt))
    && unit.locationVerifiedAt===unit.gpsRecordedAt;
}
export function historicalFieldCoordinates(unit: FieldLocation) {
  if (isCurrentFieldPin(unit)) return null;
  const saved={latitude:unit.historicalLatitude,longitude:unit.historicalLongitude};
  if (hasGpsCoordinates(saved)) return {latitude:Number(saved.latitude),longitude:Number(saved.longitude),source:unit.historicalCoordinateSource||'Stored source',recordedAt:unit.historicalRecordedAt||null};
  // Older API snapshots retain history for review but never make it a current pin.
  return !isCurrentFieldPin(unit)&&hasGpsCoordinates(unit) ? {latitude:Number(unit.latitude),longitude:Number(unit.longitude),source:unit.coordinateSource||'Stored source',recordedAt:unit.gpsRecordedAt||null} : null;
}
export function locationTag(unit: FieldLocation) {
  if(unit.locationGeocode?.status==='unavailable')return 'LOOKUP UNAVAILABLE';
  if(unit.locationGeocode?.status==='not_requested')return 'ADDRESS LOOKUP NEEDED';
  if(unit.locationGeocode?.status==='pending')return 'LOCATING ADDRESS';
  if(['no_match','invalid_address'].includes(unit.locationGeocode?.status))return 'ADDRESS NEEDS REVIEW';
  if(unit.locationGeocode?.status==='provider_error')return 'LOOKUP DELAYED';
  if (unit.locationVerification==='address_changed') return 'ADDRESS CHANGED';
  if (isCurrentFieldPin(unit)) return unit.coordinateSource==='site'?'VERIFIED ADDRESS PIN':'VERIFIED PIN';
  if (historicalFieldCoordinates(unit)) return 'HISTORICAL PIN';
  return unit.address?.trim()?'ADDRESS ONLY':'LOCATION NEEDED';
}
export function locationExplanation(unit: FieldLocation) {
  if(unit.locationGeocode){const status=unit.locationGeocode.status;if(status==='unavailable')return 'Saved address lookup results are temporarily unavailable. Refresh later; existing verified locations and camera health are unchanged.';if(status==='not_requested')return 'This placement predates automatic address lookup. Open Camera Health, review the complete installation address and save it to create the map pin.';if(status==='pending')return 'Installation saved. Address lookup is pending; background processing runs every 15 minutes.';if(status==='invalid_address')return 'Add a complete installation street, city, state and ZIP in Camera Health → Edit field address.';if(status==='no_match')return 'No single exact address matched. Correct the installation address or manually verify the installation pin.';if(status==='provider_error')return unit.locationGeocode.attempts>=3?'Address lookup failed after three attempts. Correct and save the address to retry, or verify the installation pin.':'The address service is unavailable. COS will retry automatically; camera health is unchanged.';}
  if (unit.locationVerification==='address_changed') return 'The recorded address changed after this pin was saved. Verify the new location before placing it on the map.';
  if (isCurrentFieldPin(unit)) return unit.coordinateSource==='site'?'An owner confirmed an address-derived pin. It is not a live GPS observation.':'An owner confirmed this pin for the recorded address. It is not live router GPS.';
  if (historicalFieldCoordinates(unit)) return 'Historical coordinates are preserved for review and excluded from the current map and nearby-unit results. Confirm the actual installation location before using them.';
  return unit.address?.trim()?'Address-based location. Coordinates pending verification.':'No installation address or coordinates are recorded.';
}
/** Parse a deliberately supplied coordinate pair. Never geocode or infer coordinates from an address. */
export function parseLocationCoordinates(value: string): {latitude:number;longitude:number} {
  let text=value.trim();
  if (/^https?:\/\//i.test(text)) {
    let url:URL;
    try { url=new URL(text); } catch { throw new Error('Paste a latitude, longitude pair or a Google Maps point link.'); }
    if (url.protocol!=='https:' || url.username || url.password || url.port || !['google.com','www.google.com','maps.google.com'].includes(url.hostname) || !/^\/maps(?:\/|$)/.test(url.pathname)) throw new Error('Use a Google Maps point link or paste latitude, longitude directly.');
    // @lat,lng is the map camera center, not necessarily the selected destination.
    // Only an explicit coordinate query/destination is safe to propose.
    const targets=[...url.searchParams].filter(([key])=>['query','q','destination'].includes(key));
    const supportedPath=/^\/maps(?:\/search)?\/?$/.test(url.pathname) || /^\/maps\/dir\/?$/.test(url.pathname);
    const direction=/^\/maps\/dir\/?$/.test(url.pathname);
    const conflicting=[...url.searchParams.keys()].some(key=>/place_id/i.test(key)||['cid','ftid','data'].includes(key));
    if (!supportedPath || targets.length!==1 || conflicting || (direction ? targets[0][0]!=='destination' : targets[0][0]==='destination')) throw new Error('The Maps link has an ambiguous point. Paste latitude, longitude directly.');
    text=targets[0][1];
  }
  if (text.startsWith('(')&&text.endsWith(')')) text=text.slice(1,-1).trim();
  const match=/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(text);
  if (!match) throw new Error('Paste a latitude, longitude pair. Address links and map-view centers cannot identify the unit pin.');
  const latitude=Number(match[1]),longitude=Number(match[2]);
  if (!hasGpsCoordinates({latitude,longitude})) throw new Error('Coordinates must use latitude -90 to 90 and longitude -180 to 180.');
  return {latitude,longitude};
}
/** Address lookup is explicit user navigation, never background geocoding. */
export function installationAddressLink(unit: FieldLocation) {
  const address=unit.address?.trim();
  return address ? 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address) : null;
}
/** A unique saved unit identity is mandatory. Name candidates are never equipment health. */
export function fieldRouter(unit: FieldLocation, rows: RouterRow[] = []) {
  const candidates=rows.filter(row=>row.match==='exact_name'&&row.candidateUnit?.id===unit.id);
  return candidates.length===1 ? candidates[0] : null;
}
export function fieldReachability(unit: FieldLocation, rows: RouterRow[] = [], now=Date.now()): RouterStatus {
  const row=fieldRouter(unit,rows); return row ? routerStatus(row,now) : 'unknown';
}
export const fieldReachabilityLabels: Record<RouterStatus,string> = {reachable:'Router port up',unreachable:'Router port down',stale:'Router check stale',unknown:'Health unknown'};
export const fieldReachabilityColors: Record<RouterStatus,string> = {reachable:'#35d48a',unreachable:'#ff737d',stale:'#f0bd57',unknown:'#94a3b8'};
export const normalizeLocationAddress = (value: string) => value.replace(/\s+/g,' ').trim().toLowerCase();
export async function locationVerificationNote(address: string|undefined, note: string) {
  if (!address?.trim()) throw new Error('Record the installation address before verifying its pin.');
  const bytes=new TextEncoder().encode(normalizeLocationAddress(address));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  return 'COS_FIELD_LOCATION_V1|address_sha256='+hash+'|confirmed=true\n'+note.trim();
}
export function locationHistoryNote(note: string|undefined) {
  if (!note) return '';
  const lines=note.split('\n');
  return /^COS_FIELD_LOCATION_V1\|address_sha256=[a-f0-9]{64}\|confirmed=true$/.test(lines[0]) ? 'Address-verification note.'+(lines.slice(1).join('\n').trim()?' '+lines.slice(1).join('\n').trim():'') : note;
}
