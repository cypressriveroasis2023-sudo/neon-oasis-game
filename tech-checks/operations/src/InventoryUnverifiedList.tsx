import {inventoryUnverifiedBreakdown, UNVERIFIED_REASON_LABEL, type InventoryUnverifiedItem, type UnverifiedReason} from './sharedFleetCounts';

const ORDER: UnverifiedReason[] = ['no_recorder_link', 'no_device_link', 'no_router_link', 'stale_reading', 'no_reading', 'identity_hold', 'source_conflict', 'address_unmapped'];

/** The parts add up to the inventory unverified total. This is not the camera-unit headline. */
export default function InventoryUnverifiedList({items}:{items: readonly InventoryUnverifiedItem[] | null | undefined}) {
  if (!items) return null;
  const breakdown = inventoryUnverifiedBreakdown(items);
  const shown = ORDER.filter(reason => breakdown.counts[reason] > 0);
  return <section className='cos-unverified-breakdown' aria-label='Inventory unverified breakdown'>
    <h3>Inventory unverified · {breakdown.total}</h3>
    <p>These are field inventory rows still unverified. They are not the camera-unit unknown headline.</p>
    {shown.length ? <ul>{shown.map(reason => <li key={reason}><b>{breakdown.counts[reason]}</b> {UNVERIFIED_REASON_LABEL[reason]}</li>)}</ul> : <p>None of the inventory rows are unverified.</p>}
  </section>;
}
