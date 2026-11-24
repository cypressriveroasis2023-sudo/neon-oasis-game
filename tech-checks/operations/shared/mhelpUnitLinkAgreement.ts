/**
 * A link is written only where both of COS's unit-name readers agree.
 *
 * There are two readers in this codebase, and they do not mean the same thing
 * by a name:
 *
 *   mhelpUnitIdentity  - the older one. The placement sync and the bundled
 *                        camera-status function identify units with it. It
 *                        keeps the model in the identity, so SPOTTER 028 and
 *                        SPOTTER 028.1HDC4S are different units, and it reads
 *                        RSU as CAMV and ST as SOLARPOLE.
 *   unitIdentity       - the newer one, in mhelpUnitLink.ts. It ignores the
 *                        model, covers the seven camera families COS checks
 *                        itself, and does not read decimal unit numbers.
 *
 * On most names they agree. Where they do not, writing the A# by one reader's
 * rules would attach it to a camera the placement authority considers a
 * different unit, and the counts would then be confidently wrong, which is
 * worse than being visibly incomplete.
 *
 * So this module takes the plan mhelpUnitLink.ts produces and keeps only the
 * links the older reader also confirms. The rest are not guessed and not
 * dropped: they come back as `disagreed`, for a person to settle. Holding a
 * unit costs a line on the punch list. Linking the wrong one costs trust in
 * every number on the board.
 *
 * This module reads and writes nothing.
 */

import {planUnitLinks} from './mhelpUnitLink.ts';
import type {LinkCandidate, LinkPlan} from './mhelpUnitLink.ts';
import {mhelpUnitIdentity} from './mhelpUnitIdentity.ts';

/** Why the two readers could not be made to agree about a proposed link. */
export type DisagreementReason =
  /** The placement reader does not recognise the COS name at all. */
  | 'placement_reader_rejects_cos_name'
  /** The placement reader does not recognise the mHelp name at all. */
  | 'placement_reader_rejects_mhelp_name'
  /** Both names are recognised, but as different units. */
  | 'readers_disagree'
  /**
   * Two names this run would link separately are one unit to the placement
   * reader, so linking both would put two A#s on one unit.
   *
   * The known case is RSU and CAMV: the placement reader folds RSU into CAMV,
   * so RSU 001 and CAMV 001 are one unit to it and two to the newer reader.
   * Neither is linked; a person decides which record is real.
   */
  | 'one_unit_to_the_placement_reader';

export type Disagreement = {
  unitId: string;
  unitName: string;
  mhelpName: string;
  productId: string;
  reason: DisagreementReason;
  /** What each reader made of the pair, so a person can see the difference. */
  linkReaderKey: string;
  placementCosKey: string | null;
  placementMhelpKey: string | null;
};

export type AgreedLinkPlan = LinkPlan & {disagreed: Disagreement[]};

/**
 * The links both readers confirm, the holds from the first reader, and the
 * pairs the two readers could not agree on.
 *
 * `takenProductIds` are A#s already saved on other COS records; they are never
 * reused. An A# that reaches `disagreed` is not consumed, so a later run, or a
 * person, can still use it.
 */
export function planAgreedUnitLinks(
  cosUnits: LinkCandidate[], mhelpRows: LinkCandidate[], takenProductIds: Iterable<string> = [],
): AgreedLinkPlan {
  const plan = planUnitLinks(cosUnits, mhelpRows, takenProductIds);
  const links: AgreedLinkPlan['links'] = [];
  const disagreed: Disagreement[] = [];
  // Proposed links that are one unit to the placement reader, counted first so
  // every one of them is held, not just the second to come along.
  const crowded = new Map<string, number>();
  for (const link of plan.links) {
    const cos = mhelpUnitIdentity(link.unitName);
    if (cos) crowded.set(cos.key, (crowded.get(cos.key) || 0) + 1);
  }
  for (const link of plan.links) {
    const cos = mhelpUnitIdentity(link.unitName);
    const mhelp = mhelpUnitIdentity(link.mhelpName);
    const shared = {
      unitId: link.unitId, unitName: link.unitName, mhelpName: link.mhelpName,
      productId: link.productId, linkReaderKey: link.key,
      placementCosKey: cos ? cos.key : null, placementMhelpKey: mhelp ? mhelp.key : null,
    };
    if (!cos) { disagreed.push({...shared, reason: 'placement_reader_rejects_cos_name'}); continue; }
    if (!mhelp) { disagreed.push({...shared, reason: 'placement_reader_rejects_mhelp_name'}); continue; }
    if (cos.key !== mhelp.key) { disagreed.push({...shared, reason: 'readers_disagree'}); continue; }
    if ((crowded.get(cos.key) || 0) > 1) {
      disagreed.push({...shared, reason: 'one_unit_to_the_placement_reader'});
      continue;
    }
    links.push(link);
  }
  return {links, held: plan.held, disagreed};
}
