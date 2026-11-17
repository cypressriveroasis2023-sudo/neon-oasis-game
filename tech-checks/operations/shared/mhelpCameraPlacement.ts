import type {UnitCameraStatus} from './starUnitStatus.ts';

export type MhelpCameraRecord = {
  productId: string;
  placement: 'FIELD' | 'SHOP';
  lifecycle?: string;
  unitNumber?: string;
};

export type PlacementReview = { unit: string; productId: string; detail: string };

const time = (value?: string | null) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : NaN;
};

/** Display placement from the newest mHelp Product ID. No tracker row is rewritten. */
export function applyMhelpCameraPlacement(units: UnitCameraStatus[], records: MhelpCameraRecord[], mhelpAt?: string | null): { units: UnitCameraStatus[]; reviews: PlacementReview[] } {
  const byId = new Map(records.filter(record => /^[1-9]\d*$/.test(record.productId)).map(record => [record.productId, record]));
  const reviews: PlacementReview[] = [];
  const next = units.map(unit => {
    if (!unit.productIdKnown || unit.source !== 'ip_check') return unit;
    if (!unit.mhelpProductId) {
      return {...unit, deviceLinkNeeded: true, placementReview: unit.unit+' has no mHelp Product ID. It needs a device link.'};
    }
    const record = byId.get(unit.mhelpProductId);
    if (!record) return {...unit, deviceLinkNeeded: true, placementReview: unit.unit+' Product ID '+unit.mhelpProductId+' is not on the current mHelp list.'};
    const unused = record.lifecycle === 'DO_NOT_USE' || record.lifecycle === 'MISSING';
    const hand = unit.handEdits?.placement;
    const handWins = Boolean(hand?.at && time(hand.at) > time(mhelpAt));
    const placement = handWins && (hand!.value === 'FIELD' || hand!.value === 'SHOP') ? hand!.value : record.placement;
    const trackerSaid = unit.providerPlacement || unit.placement;
    const copy = {...unit, placement, onlineInShop: placement === 'SHOP' && unit.online > 0, notInUse: unused || undefined, deviceLinkNeeded: undefined};
    if (unit.trackerActive === false && record.placement === 'FIELD') {
      copy.state = 'UNKNOWN';
      copy.online = 0;
      copy.offline = 0;
      copy.unknown = unit.cameras || 1;
      copy.observedAt = null;
    }
    if (!handWins && trackerSaid !== record.placement) {
      const detail = unit.unit+' — mHelp says '+record.placement+' and the tracker says '+trackerSaid+'. mHelp wins. Confirm.';
      copy.placementReview = detail;
      reviews.push({unit: unit.unit, productId: unit.mhelpProductId, detail});
    }
    return copy;
  });
  return {units: next, reviews};
}

/** Queue a device only when the stored Product ID column was read and does not
 * match the current mHelp list. A unit name is never a link. */
export function queueMissingProductLinks(units: UnitCameraStatus[], currentProductIds: ReadonlySet<string>): string[] {
  const lines: string[] = [];
  for (const unit of units) {
    if (!unit.productIdKnown) continue;
    if (!unit.mhelpProductId || !currentProductIds.has(unit.mhelpProductId)) lines.push(unit.unit+' — device link needed');
  }
  return lines;
}
