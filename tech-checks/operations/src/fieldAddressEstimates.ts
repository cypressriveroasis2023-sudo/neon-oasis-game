import { hasGpsCoordinates } from '../shared/gpsValidation';
import { isCurrentFieldPin, normalizeLocationAddress, type FieldLocation } from './fieldLocations';

export const addressEstimateSource = 'us_census_address_range_estimate';
export const addressEstimatePrefix = 'COS_ADDRESS_ESTIMATE_V1|';
export type AddressEstimate = {
  latitude:number; longitude:number; matchedAddress:string; geocodedAt:string;
  confidence:'address_range_interpolation'; source:typeof addressEstimateSource; providerMatchQuality:'Exact'|'Non_Exact';
};
type EstimateRow = FieldLocation & { status?:string; currentLocationType?:string };
const object = (value:unknown):value is Record<string,unknown> => Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const text = (value:unknown,max:number):value is string => typeof value==='string'&&value.trim().length>0&&value.length<=max;
const date = (value:unknown,now:number):value is string => {
  if(typeof value!=='string')return false;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if(!parts||!Number.isFinite(Date.parse(value))||Date.parse(value)>now)return false;
  const calendar=new Date(Date.UTC(Number(parts[1]),Number(parts[2])-1,Number(parts[3])));
  return calendar.getUTCFullYear()===Number(parts[1])&&calendar.getUTCMonth()+1===Number(parts[2])&&calendar.getUTCDate()===Number(parts[3]);
};
/** Machine provenance is not human warning text; preserve every appended note even when validation fails. */
export function addressEstimateHumanNote(note:string|null|undefined) {
  if(!note?.startsWith(addressEstimatePrefix))return note||'';
  const newline=note.indexOf('\n');return newline<0?'':note.slice(newline+1);
}
function addressParts(value:string) {
  const m=/^(.+),\s*([^,]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(?:-\d{4})?\s*$/i.exec(value.trim());
  if (!m||!/^\d+[A-Z]?\s/i.test(m[1])) return null;
  const aliases:Record<string,string>={COUNTY:'CO',ROAD:'RD',STREET:'ST',AVENUE:'AVE',BOULEVARD:'BLVD',DRIVE:'DR',LANE:'LN',COURT:'CT',PLACE:'PL',PARKWAY:'PKWY',HIGHWAY:'HWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W'};
  const street=m[1].toUpperCase().replace(/\./g,'').replace(/\b[A-Z]+\b/g,word=>aliases[word]||word).replace(/\s+/g,' ').trim();
  return {street,city:m[2].trim().toUpperCase(),state:m[3].toUpperCase(),zip:m[4]};
}

/** An address estimate is a separate, unverified presentation; it never passes isCurrentFieldPin. */
export async function checkedAddressEstimate(unit:EstimateRow,now=Date.now()):Promise<AddressEstimate|null> {
  const automatic=unit.locationGeocode;
  if(automatic?.status==='success'&&!isCurrentFieldPin(unit)&&unit.status==='field'&&unit.currentLocationType==='field'&&unit.address?.trim()){
    if(automatic.auditId!==unit.placementAuditId||automatic.unitKey!==unit.placementUnitKey||automatic.provider!=='us_census_address_range'||automatic.benchmark!=='Public_AR_Current'||!text(automatic.matchedAddress,300)||!date(automatic.geocodedAt,now)||!hasGpsCoordinates(automatic)||typeof automatic.latitude!=='number'||typeof automatic.longitude!=='number')return null;
    const original=addressParts(unit.address),matched=addressParts(automatic.matchedAddress);
    if(!original||!matched||JSON.stringify(original)!==JSON.stringify(matched))return null;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeLocationAddress(unit.address)))),x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==automatic.addressSha256)return null;
    return {latitude:automatic.latitude,longitude:automatic.longitude,matchedAddress:automatic.matchedAddress,geocodedAt:automatic.geocodedAt,confidence:'address_range_interpolation',source:addressEstimateSource,providerMatchQuality:'Exact'};
  }
  if (isCurrentFieldPin(unit)||unit.hasUnitGps===true||unit.status!=='field'||!unit.address?.trim()||unit.locationVerification==='address_changed') return null;
  // Registered units use their equipment ID. Only the server's exact, unique FIELD tracker
  // join can bind that ID to an estimate; never infer a binding from a label or an IP.
  const trackerOnly=unit.readOnly===true;
  const trackerId=trackerOnly?unit.id:unit.addressEstimateTrackerId;
  const trackerUnitNumber=trackerOnly?unit.unitNumber:unit.addressEstimateUnitNumber;
  if (trackerOnly ? unit.currentLocationType!=='field' :
    unit.readOnly!==false || !text(trackerId,100) || !text(trackerUnitNumber,160) ||
    ![null,undefined,'','field'].includes(unit.currentLocationType)) return null;
  const historical=unit.historicalCoordinateSource===addressEstimateSource;
  const saved=historical?{latitude:unit.historicalLatitude,longitude:unit.historicalLongitude}:{latitude:unit.latitude,longitude:unit.longitude};
  if ((!historical&&unit.coordinateSource!==addressEstimateSource)||!hasGpsCoordinates(saved)) return null;
  const first=unit.locationNote?.split('\n',1)[0];
  if (!first?.startsWith(addressEstimatePrefix)||first.length>4096) return null;
  let note:unknown;
  try { note=JSON.parse(first.slice(addressEstimatePrefix.length)); } catch { return null; }
  if (!object(note)||note.schemaVersion!==1||note.trackerId!==trackerId||note.unitNumber!==trackerUnitNumber||note.verified!==false||note.liveGps!==false||note.requiresOwnerConfirmation!==true
    ||note.provider!=='us_census_address_range'||note.benchmark!=='Public_AR_Current'||!['Exact','Non_Exact'].includes(String(note.providerMatchQuality))||note.confidence!=='address_range_interpolation'
    ||!text(note.batchId,100)||!text(note.approvalReference,200)||!text(note.appliedByDatabaseRole,100)||!text(note.matchedAddress,300)
    ||!date(note.geocodedAt,now)||!date(note.appliedAt,now)||Date.parse(note.appliedAt)<Date.parse(note.geocodedAt)
    ||typeof note.addressSha256!=='string'||! /^[a-f0-9]{64}$/.test(note.addressSha256)
    ||typeof note.latitude!=='number'||typeof note.longitude!=='number'||!hasGpsCoordinates(note)
    ||note.latitude!==Number(saved.latitude)||note.longitude!==Number(saved.longitude)) return null;
  const sourceAddress=addressParts(unit.address),matchedAddress=addressParts(note.matchedAddress);
  if (!sourceAddress||!matchedAddress||JSON.stringify(sourceAddress)!==JSON.stringify(matchedAddress)) return null;
  // A narrowly accepted provider Non_Exact result may only drop the supplied ZIP+4.
  // Street number/name/direction, city, state and ZIP5 still must match above.
  if (note.providerMatchQuality==='Non_Exact' &&
    (!/\b\d{5}-\d{4}\s*$/.test(unit.address)||!/\b\d{5}\s*$/.test(note.matchedAddress))) return null;
  // Fresh hash computation binds the candidate to the current installation address, not an old tracker snapshot.
  try {
    const bytes=new TextEncoder().encode(normalizeLocationAddress(unit.address));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if (hash!==note.addressSha256) return null;
  } catch { return null; }
  return {latitude:note.latitude,longitude:note.longitude,matchedAddress:note.matchedAddress,geocodedAt:note.geocodedAt,confidence:'address_range_interpolation',source:addressEstimateSource,providerMatchQuality:note.providerMatchQuality as 'Exact'|'Non_Exact'};
}
