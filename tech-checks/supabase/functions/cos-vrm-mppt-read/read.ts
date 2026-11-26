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
