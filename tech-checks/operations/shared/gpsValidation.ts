export class GpsValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'GpsValidationError'; }
}
export type GpsCoordinates = { latitude: number; longitude: number; accuracyM: number | null };
export type GpsWrite = GpsCoordinates & { source: string; note: string | null };
const sources = new Set(['manual', 'device_gps', 'phone_gps', 'site', 'router', 'import']);
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function numeric(value: unknown, label: string, allowText: boolean): number {
  if (allowText && typeof value === 'string' && value.trim() && decimal.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GpsValidationError(label + ' is required and must be a finite number.');
  return value;
}
/** Text parsing is opt-in for form fields and stored numeric values, never for API request bodies. */
export function gpsCoordinates(input: unknown, allowText = false): GpsCoordinates {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GpsValidationError('GPS coordinates are required.');
  const body = input as Record<string, unknown>;
  const latitude = numeric(body.latitude, 'Latitude', allowText);
  const longitude = numeric(body.longitude, 'Longitude', allowText);
  if (latitude < -90 || latitude > 90) throw new GpsValidationError('Latitude must be between -90 and 90.');
  if (longitude < -180 || longitude > 180) throw new GpsValidationError('Longitude must be between -180 and 180.');
  const rawAccuracy = body.accuracyM;
  const absentAccuracy = rawAccuracy == null || (allowText && typeof rawAccuracy === 'string' && !rawAccuracy.trim());
  const accuracyM = absentAccuracy ? null : numeric(rawAccuracy, 'GPS accuracy', allowText);
  if (accuracyM !== null && accuracyM < 0) throw new GpsValidationError('GPS accuracy must be zero or greater.');
  return { latitude, longitude, accuracyM };
}
export function gpsWrite(input: unknown, mode: 'owner' | 'technician', allowText = false): GpsWrite {
  const coordinates = gpsCoordinates(input, allowText);
  const body = input as Record<string, unknown>;
  const allowed = new Set(['latitude', 'longitude', 'accuracyM', 'note', ...(mode === 'owner' ? ['source'] : [])]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new GpsValidationError('GPS request contains unsupported fields.');
  if (body.note != null && typeof body.note !== 'string') throw new GpsValidationError('GPS note must be text.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 4000) throw new GpsValidationError('GPS note must be 4000 characters or fewer.');
  let source = 'phone_gps';
  if (mode === 'owner') {
    if (body.source != null && typeof body.source !== 'string') throw new GpsValidationError('GPS source must be text.');
    source = typeof body.source === 'string' ? body.source.trim().toLowerCase() || 'manual' : 'manual';
    if (!sources.has(source)) throw new GpsValidationError('Unsupported GPS source.');
  }
  return { ...coordinates, source, note: note || null };
}
export function hasGpsCoordinates(record: { latitude?: unknown; longitude?: unknown }): boolean {
  try { gpsCoordinates(record, true); return true; } catch { return false; }
}
export function gpsMatches(record: unknown, expected: GpsCoordinates): boolean {
  try {
    const actual = gpsCoordinates(record, true);
    return Math.abs(actual.latitude - expected.latitude) <= 0.00000051 && Math.abs(actual.longitude - expected.longitude) <= 0.00000051 &&
      (actual.accuracyM === null ? expected.accuracyM === null : expected.accuracyM !== null && Math.abs(actual.accuracyM - expected.accuracyM) <= 0.0051);
  } catch { return false; }
}
