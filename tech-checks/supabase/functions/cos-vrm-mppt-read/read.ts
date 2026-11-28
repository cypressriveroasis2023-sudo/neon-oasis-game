// MPPT summary for Helios units: the pure part, kept separate so it can be tested without Deno.
export type VrmMpptUnit = {
  installationId: number; name: string; observedAt: number | null;
  yieldToday: number | null; yieldYesterday: number | null; peakToday: number | null; peakYesterday: number | null;
  panelVolts: number | null; errorCode: number | null;
};
const num = (v: unknown, lo: number, hi: number) => v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/** Bounded, numeric only. Anything unexpected fails the whole answer rather than showing a guess. */
export function safeVrmMppt(value: unknown, now = Date.now()): {units: VrmMpptUnit[]} {
  const v = value as {units?: unknown};
  if (!v || typeof v !== 'object' || !Array.isArray(v.units) || v.units.length > 200) throw Error('MPPT unavailable');
  const seen = new Set<number>();
  const units = v.units.map((u: any): VrmMpptUnit => {
    if (!u || !Number.isSafeInteger(u.installationId) || u.installationId < 1 || seen.has(u.installationId) || typeof u.name !== 'string' || !/^HELIOS\s+\d{1,3}$/i.test(u.name)) throw Error('MPPT inconsistent');
    seen.add(u.installationId);
    const observedAt = num(u.observedAt, 946684800, now / 1000 + 300);
    const fields = [num(u.yieldToday, 0, 1000), num(u.yieldYesterday, 0, 1000), num(u.peakToday, 0, 100000), num(u.peakYesterday, 0, 100000), num(u.panelVolts, 0, 500), num(u.errorCode, 0, 300)];
    if (observedAt === undefined || fields.includes(undefined) || observedAt !== null && !Number.isSafeInteger(observedAt)) throw Error('MPPT reading invalid');
    const [yieldToday, yieldYesterday, peakToday, peakYesterday, panelVolts, errorCode] = fields as (number | null)[];
    return {installationId: u.installationId, name: u.name, observedAt, yieldToday, yieldYesterday, peakToday, peakYesterday, panelVolts, errorCode};
  });
  return {units};
}

/** Field or Shop for one Helios from mHelp's own current list (ZIP for Field units only). */
export type VrmPlacementUnit = {installationId: number; name: string; placement: 'FIELD' | 'SHOP'; zip: string | null};

/** Same rule: anything unexpected fails the whole placement answer, and the page falls back to what it had. */
export function safeVrmPlacement(value: unknown): {units: VrmPlacementUnit[]} {
  const v = value as {units?: unknown};
  if (!v || typeof v !== 'object' || !Array.isArray(v.units) || v.units.length > 200) throw Error('Placement unavailable');
  const seen = new Set<number>(), names = new Set<string>();
  const units = v.units.map((u: any): VrmPlacementUnit => {
    const name = typeof u?.name === 'string' ? u.name.replace(/\s+/g, ' ').trim().toUpperCase() : '';
    if (!u || !Number.isSafeInteger(u.installationId) || u.installationId < 1 || seen.has(u.installationId) || !/^HELIOS \d{1,3}$/.test(name) || names.has(name)
      || u.placement !== 'FIELD' && u.placement !== 'SHOP' || u.zip !== null && u.zip !== undefined && !(typeof u.zip === 'string' && /^\d{5}$/.test(u.zip))) throw Error('Placement inconsistent');
    seen.add(u.installationId); names.add(name);
    return {installationId: u.installationId, name: u.name, placement: u.placement, zip: u.placement === 'FIELD' ? u.zip ?? null : null};
  });
  return {units};
}

/** Nightly battery capacity per Helios (last 60 nights): [date, Wh]. Same rule: anything odd fails the extra. */
export type VrmHealthUnit = {installationId: number; nights: [string, number][]};
export function safeVrmHealth(value: unknown): {units: VrmHealthUnit[]} {
  const v = value as {units?: unknown};
  if (!v || typeof v !== 'object' || !Array.isArray(v.units) || v.units.length > 200) throw Error('Health unavailable');
  const seen = new Set<number>();
  const units = v.units.map((u: any): VrmHealthUnit => {
    if (!u || !Number.isSafeInteger(u.installationId) || u.installationId < 1 || seen.has(u.installationId) || !Array.isArray(u.nights) || u.nights.length > 400) throw Error('Health inconsistent');
    seen.add(u.installationId);
    const nights = u.nights.map((n: any): [string, number] => {
      if (!Array.isArray(n) || n.length !== 2 || typeof n[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(n[0]) || !Number.isSafeInteger(n[1]) || n[1] < 200 || n[1] > 20000) throw Error('Health night invalid');
      return [n[0], n[1]];
    });
    return {installationId: u.installationId, nights};
  });
  return {units};
}
