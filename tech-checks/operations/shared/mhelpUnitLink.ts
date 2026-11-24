/**
 * Tying a COS unit to its mHelp row by name, so the A# can be saved.
 *
 * The A# is mHelpDesk's equipment id. mHelp shows it on the equipment record
 * as the Barcode ID, written A#1998523, and prints it on the unit's barcode
 * label. mHelp's own API calls it equipmentId; COS stores it as
 * mhelp_product_id. One number, three names.
 *
 * James, Mon 11/23/2026: "cos will check mhelp and it should auto populate ...
 * we have all mhelp inventory on cos so back and forth shoul dbe a snap."
 *
 * Six Snipers that mHelp had in the field went three weeks with no status
 * reading because COS had not saved their mHelp A#, and the health sweep will
 * not check a unit whose ownership it cannot confirm. mHelp writes the same
 * unit as "Sniper 2-344" and COS writes it as "SNIPER 2 344", so a name match
 * has to ignore how the name is spelled.
 *
 * This module decides nothing else. It never reads or writes; it takes the two
 * lists and says which pairs are the same unit, and which are too uncertain to
 * link. The spec is the doc "COS <-> mHelp A# auto-link".
 */

/** The identity of a unit, as both sides spell it: a family and a number. */
export type UnitIdentity = {family: string; number: number; key: string};

/** The families COS checks itself, and the only ones this match covers. */
export const LINK_FAMILIES = Object.freeze([
  'CAMV', 'SNIPER', 'SNIPER 2', 'SNIPER 4', 'RSU', 'RADAR SNIPER', 'THERMAL SNIPER',
]);

const DO_NOT_USE = /[\s-]*\bDO\s+NOT\s+USE\b\s*$/i;
const TERMINAL = /(?:^|\W)(?:RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i;

/** True when a name or state says the unit is out of service. Those are never linked. */
export const outOfService = (value: unknown): boolean => typeof value === 'string' && TERMINAL.test(value);

/**
 * The identity in a unit name, or null when the name is not one this match covers.
 *
 * Upper case, one space between words, a hyphen before the number read as a
 * space, CAM V read as CAMV, and a trailing model word (ES) left off: the model
 * is not part of which unit this is. The number is the last run of digits, read
 * without leading zeros, so 013 and 13 are one unit.
 */
export function unitIdentity(name: unknown): UnitIdentity | null {
  if (typeof name !== 'string') return null;
  let text = name.trim().replace(/\s+/g, ' ').toUpperCase();
  text = text.replace(DO_NOT_USE, '').trim();
  text = text.replace(/^CAM[\s-]*V\b/, 'CAMV');
  text = text.replace(/\bES\s*$/, '').trim();
  // A hyphen or an en dash between words is a space: SNIPER 2-344 is SNIPER 2 344.
  text = text.replace(/[‐-―-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const match = /^(.*?)\s*(\d{1,6})$/.exec(text);
  if (!match) return null;
  const family = match[1].trim(), number = Number(match[2]);
  if (!LINK_FAMILIES.includes(family) || !Number.isSafeInteger(number) || number <= 0) return null;
  return {family, number, key: family + ':' + number};
}

/**
 * One side of the match: a COS unit, or an mHelp row.
 *
 * Every COS unit is passed in, not only the ones with no A#. A unit that
 * already carries one is never written to again, but it still answers for its
 * name, so an mHelp row that COS does in fact hold is never reported missing.
 */
export type LinkCandidate = {id: string; name: string; productId?: string | null; lifecycle?: string | null};
/** Why a candidate was not linked. Each one is a line on James's punch list, never a guess. */
export type LinkHoldReason =
  | 'name_not_recognised' | 'out_of_service' | 'two_mhelp_rows' | 'two_cos_units'
  | 'no_mhelp_row' | 'no_cos_unit' | 'product_id_taken';
export type LinkPlan = {
  links: {unitId: string; unitName: string; productId: string; mhelpName: string; key: string}[];
  held: {side: 'cos' | 'mhelp'; id: string; name: string; reason: LinkHoldReason}[];
};

/**
 * What a run would write, and what it would hold back.
 *
 * A link is made only where exactly one COS unit and exactly one mHelp row
 * carry the same family and number. Everything else is held with its reason:
 * ambiguity goes to a person. `takenProductIds` are A#s already saved on other
 * COS units, which are never reused.
 */
export function planUnitLinks(
  cosUnits: LinkCandidate[], mhelpRows: LinkCandidate[], takenProductIds: Iterable<string> = [],
): LinkPlan {
  const plan: LinkPlan = {links: [], held: []};
  const taken = new Set([...takenProductIds].filter(value => typeof value === 'string'));
  const index = (rows: LinkCandidate[], side: 'cos' | 'mhelp') => {
    const byKey = new Map<string, LinkCandidate[]>();
    for (const row of rows) {
      if (side === 'mhelp' && (row.lifecycle === 'DO_NOT_USE' || outOfService(row.name))) {
        plan.held.push({side, id: row.id, name: row.name, reason: 'out_of_service'});
        continue;
      }
      if (side === 'cos' && outOfService(row.name)) {
        plan.held.push({side, id: row.id, name: row.name, reason: 'out_of_service'});
        continue;
      }
      const identity = unitIdentity(row.name);
      if (!identity) { plan.held.push({side, id: row.id, name: row.name, reason: 'name_not_recognised'}); continue; }
      byKey.set(identity.key, [...(byKey.get(identity.key) || []), row]);
    }
    return byKey;
  };
  const cos = index(cosUnits, 'cos'), mhelp = index(mhelpRows, 'mhelp');
  for (const [key, all] of cos) {
    const rows = mhelp.get(key) || [];
    // A unit that already carries an A# is left alone: it is here to answer for its name.
    const units = all.filter(unit => !(typeof unit.productId === 'string' && /^[1-9][0-9]*$/.test(unit.productId)));
    const hold = (reason: LinkHoldReason) => {
      for (const unit of units) plan.held.push({side: 'cos', id: unit.id, name: unit.name, reason});
    };
    if (!units.length) continue;
    if (all.length > 1) { hold('two_cos_units'); continue; }
    if (rows.length === 0) { hold('no_mhelp_row'); continue; }
    if (rows.length > 1) { hold('two_mhelp_rows'); continue; }
    const unit = units[0], row = rows[0], productId = typeof row.productId === 'string' ? row.productId : '';
    if (!/^[1-9][0-9]*$/.test(productId)) { hold('name_not_recognised'); continue; }
    if (taken.has(productId)) { hold('product_id_taken'); continue; }
    taken.add(productId);
    plan.links.push({unitId: unit.id, unitName: unit.name, productId, mhelpName: row.name, key});
  }
  // An mHelp row with no COS record at all is the other thing worth knowing: it
  // cannot be linked, and nothing in COS will ever report that unit.
  for (const [key, rows] of mhelp) {
    if (cos.has(key)) continue;
    for (const row of rows) plan.held.push({side: 'mhelp', id: row.id, name: row.name, reason: 'no_cos_unit'});
  }
  return plan;
}
