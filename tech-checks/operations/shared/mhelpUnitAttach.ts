/**
 * Deciding which mHelp A# belongs to which COS unit, for the one-time attachment.
 *
 * The problem, in James's words on 2026-11-23: "cos will check mhelp and it
 * should auto populate ... we have all mhelp inventory on cos so back and forth
 * shoul dbe a snap."
 *
 * It is not a snap because the two systems spell a unit differently. COS writes
 * SPOTTER 236; mHelp writes Spotter 236HDC2. The model suffix is part of how
 * the placement reader identifies a unit, so to it those are two units, and the
 * A# never gets attached. 374 of COS's 471 units carry no A#, and the camera
 * health sweep will not check a unit whose ownership it cannot confirm, so the
 * 672 cameras on those units are never checked at all.
 *
 * So this module identifies a unit by family and number and deliberately
 * ignores the model suffix. That is only safe if it cannot merge two real
 * units, and it was checked against the live data on 2026-11-24 before being
 * written:
 *
 *   - across all 925 live mHelp records, no two share a family and number;
 *   - across COS's 471 units, exactly two do, both duplicate Recon records
 *     carrying site text in the name, and both are held here rather than linked.
 *
 * It uses mhelpUnitIdentity for the families, so the families, the aliases
 * (RSU reads as CAMV, ST as SOLARPOLE) and the decimal unit numbers are the
 * placement system's own, not a second opinion. The only thing dropped is the
 * variant.
 *
 * A link is made only where exactly one COS unit and exactly one mHelp row
 * share a family and number. Everything else is held with a reason, for a
 * person. This module reads and writes nothing.
 */

import {mhelpUnitIdentity} from './mhelpUnitIdentity.ts';

/** A unit named on one side of the match. */
export type AttachCandidate = {
  /** The COS unit_key, or the mHelp A#. */
  id: string;
  name: string;
  /** mHelp rows only: the A# to attach. */
  productId?: string | null;
  /** mHelp rows only: DO_NOT_USE is never attached. */
  lifecycle?: string | null;
};

export type AttachHoldReason =
  /** The name is not one the placement reader recognises as a unit. */
  | 'name_not_recognised'
  /** The name or lifecycle says the unit is out of service. */
  | 'out_of_service'
  /** Two COS units share this family and number, so which one is meant is unclear. */
  | 'two_cos_units'
  /** Two mHelp rows share this family and number. */
  | 'two_mhelp_rows'
  /** mHelp has no row for this unit, so COS will never report it from mHelp. */
  | 'no_mhelp_row'
  /** COS has no record of a unit mHelp holds. */
  | 'no_cos_unit'
  /** That A# is already attached to another COS unit. */
  | 'product_id_taken';

export type AttachPlan = {
  links: {
    unitKey: string; cosName: string; productId: string; mhelpName: string;
    key: string;
    /** The model suffix each side wrote, kept so a link can be explained. */
    cosVariant: string; mhelpVariant: string;
  }[];
  held: {side: 'cos' | 'mhelp'; id: string; name: string; reason: AttachHoldReason}[];
};

const TERMINAL = /(?:^|\W)(?:RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i;

/** True when a name or lifecycle says the unit is out of service. */
export const outOfService = (name: unknown, lifecycle?: unknown): boolean =>
  (typeof name === 'string' && TERMINAL.test(name)) || lifecycle === 'DO_NOT_USE';

/**
 * Family and number, with the model suffix left out of the key.
 *
 * SPOTTER 236 and Spotter 236HDC2 both give SPOTTER|236; the suffix each side
 * wrote comes back separately so a link can be shown with both spellings.
 */
export function attachIdentity(name: unknown): {key: string; family: string; tag: string; variant: string} | null {
  const identity = mhelpUnitIdentity(name);
  if (!identity) return null;
  // mhelpUnitIdentity's key is family|tag|variant. Drop the variant only.
  const [family, tag, variant = ''] = identity.key.split('|');
  if (!family || !tag) return null;
  return {key: family + '|' + tag, family, tag, variant};
}

/**
 * What an attachment run would write, and what it would hold back.
 *
 * `takenProductIds` are A#s already attached to other units; they are never
 * reused. A unit already in `linkedUnitKeys` is skipped entirely: an existing
 * link, whoever made it, is never overwritten here.
 */
export function planUnitAttachments(
  cosUnits: AttachCandidate[],
  mhelpRows: AttachCandidate[],
  takenProductIds: Iterable<string> = [],
  linkedUnitKeys: Iterable<string> = [],
): AttachPlan {
  const plan: AttachPlan = {links: [], held: []};
  const taken = new Set([...takenProductIds].filter(value => typeof value === 'string'));
  const linked = new Set([...linkedUnitKeys].filter(value => typeof value === 'string'));

  const index = (rows: AttachCandidate[], side: 'cos' | 'mhelp') => {
    const byKey = new Map<string, (AttachCandidate & {identity: NonNullable<ReturnType<typeof attachIdentity>>})[]>();
    for (const row of rows) {
      if (outOfService(row.name, row.lifecycle)) {
        plan.held.push({side, id: row.id, name: row.name, reason: 'out_of_service'});
        continue;
      }
      const identity = attachIdentity(row.name);
      if (!identity) {
        plan.held.push({side, id: row.id, name: row.name, reason: 'name_not_recognised'});
        continue;
      }
      byKey.set(identity.key, [...(byKey.get(identity.key) || []), {...row, identity}]);
    }
    return byKey;
  };

  const cos = index(cosUnits, 'cos'), mhelp = index(mhelpRows, 'mhelp');

  for (const [key, all] of cos) {
    const rows = mhelp.get(key) || [];
    // A unit that already has a link answers for its name but is never rewritten.
    const units = all.filter(unit => !linked.has(unit.id));
    const hold = (reason: AttachHoldReason) => {
      for (const unit of units) plan.held.push({side: 'cos', id: unit.id, name: unit.name, reason});
    };
    if (!units.length) continue;
    if (all.length > 1) { hold('two_cos_units'); continue; }
    if (rows.length === 0) { hold('no_mhelp_row'); continue; }
    if (rows.length > 1) { hold('two_mhelp_rows'); continue; }
    const unit = units[0], row = rows[0];
    const productId = typeof row.productId === 'string' ? row.productId : '';
    if (!/^[1-9][0-9]{0,14}$/.test(productId)) { hold('name_not_recognised'); continue; }
    if (taken.has(productId)) { hold('product_id_taken'); continue; }
    taken.add(productId);
    plan.links.push({
      unitKey: unit.id, cosName: unit.name, productId, mhelpName: row.name, key,
      cosVariant: unit.identity.variant, mhelpVariant: row.identity.variant,
    });
  }

  // An mHelp unit COS has no record of: nothing in COS will ever report it.
  for (const [key, rows] of mhelp) {
    if (cos.has(key)) continue;
    for (const row of rows) plan.held.push({side: 'mhelp', id: row.id, name: row.name, reason: 'no_cos_unit'});
  }
  return plan;
}

/** Counts for a run's receipt, so a scheduled run can be read at a glance. */
export function summariseAttachPlan(plan: AttachPlan) {
  const reasons: Record<string, number> = {};
  for (const held of plan.held) reasons[held.reason] = (reasons[held.reason] || 0) + 1;
  return {
    links: plan.links.length,
    held: plan.held.length,
    heldByReason: reasons,
    suffixDiffers: plan.links.filter(link => link.cosVariant !== link.mhelpVariant).length,
  };
}
