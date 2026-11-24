/**
 * When a fix made by hand in COS stops standing.
 *
 * James, Mon 11/23/2026: "why cant i see something where when i change
 * something in cos it stays permenent until the unit is swapped or taken out
 * of the field."
 *
 * Until now a hand fix stood until someone undid it, which is the rule he set
 * and the right default: mHelp is often behind, and the fix is the only truth
 * in between. His new rule adds the other half - once the unit really has gone
 * back to the shop, the fix that put it in the field has served its purpose.
 *
 * Two limits make that safe:
 *
 *   1. Only where it is. A placement or a site can go stale, because the unit
 *      moved. An IP or an address cannot: the same unit at the same site keeps
 *      the same address next time it goes out, and clearing those would send it
 *      straight back to Unknown.
 *   2. Only on a later reading. mHelp has to have observed the unit in the shop
 *      AFTER the fix was made. mHelp simply being behind never retires a fix,
 *      which is the whole reason hand fixes exist.
 */
import type {HandEditField} from './starUnitStatus';

/** The fields a later mHelp reading can retire. Everything else stands until undone by hand. */
export const RETIRABLE_FIELDS: readonly HandEditField[] = Object.freeze(['placement', 'site']);

export type RetirementInput = {
  /** Which fix is being judged. */
  field: HandEditField;
  /** When the fix was made, as COS recorded it. */
  fixedAt: string | null | undefined;
  /** Where mHelp says the unit is now. */
  mhelpPlacement: 'FIELD' | 'SHOP' | null | undefined;
  /** When mHelp observed that placement - not when the list was read. */
  mhelpObservedAt: string | null | undefined;
};
export type Retirement = {retired: boolean; reason: string};

const time = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Whether this fix has been retired by a later mHelp reading, and the line the
 * card shows for it. A missing or unreadable time never retires anything.
 */
export function handFixRetirement(input: RetirementInput): Retirement {
  const keep = (reason: string): Retirement => ({retired: false, reason});
  if (!RETIRABLE_FIELDS.includes(input.field)) return keep('An IP or address fix stands until someone undoes it.');
  if (input.mhelpPlacement !== 'SHOP') return keep('mHelp does not have this unit in the shop.');
  const observed = time(input.mhelpObservedAt), fixed = time(input.fixedAt);
  if (observed === null) return keep('mHelp has given no time for that reading, so the fix stands.');
  if (fixed === null) return keep('COS has no time for this fix, so it stands.');
  if (observed <= fixed) return keep('mHelp saw the shop before this fix, so the fix still stands.');
  return {retired: true, reason: 'Retired: mHelp saw this unit back in the shop after the fix was made.'};
}

/** The same question for a whole unit: which of its hand fixes a later reading has retired. */
export function retiredFields(
  fixes: {field: HandEditField; fixedAt: string | null | undefined}[],
  mhelp: {placement: 'FIELD' | 'SHOP' | null | undefined; observedAt: string | null | undefined},
): HandEditField[] {
  return fixes
    .filter(fix => handFixRetirement({
      field: fix.field, fixedAt: fix.fixedAt,
      mhelpPlacement: mhelp.placement, mhelpObservedAt: mhelp.observedAt,
    }).retired)
    .map(fix => fix.field);
}
