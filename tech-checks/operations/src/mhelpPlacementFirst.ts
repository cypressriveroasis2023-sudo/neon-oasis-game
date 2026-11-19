/**
 * Proposal for the owner. Not applied to counts.
 * mHelp decides Field or Shop. An owner placement override that disagrees
 * is a flagged exception, not the placement the board counts.
 */
export const PLACEMENT_EXCEPTION = 'Owner placement override disagrees with mHelp';

export function placementWithMhelpFirst(ownerPlacement: 'FIELD' | 'SHOP', mhelpPlacement: 'FIELD' | 'SHOP' | null | undefined): 'FIELD' | 'SHOP' {
  return mhelpPlacement === 'FIELD' || mhelpPlacement === 'SHOP' ? mhelpPlacement : ownerPlacement;
}

export function placementException(ownerPlacement: 'FIELD' | 'SHOP', mhelpPlacement: 'FIELD' | 'SHOP' | null | undefined): string | null {
  if (mhelpPlacement !== 'FIELD' && mhelpPlacement !== 'SHOP') return null;
  return mhelpPlacement === ownerPlacement ? null : PLACEMENT_EXCEPTION;
}
