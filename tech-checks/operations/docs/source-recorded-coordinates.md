# Source-recorded coordinates

This native-only projection stores literal tracker coordinates separately from existing GPS, tracker coordinate and reviewed-property columns. A source observation timestamp says when the tracker was read; coordinate measurement time remains unknown. SRC pins are unverified, are excluded from nearby distances and do not affect camera health.

## Native integration

Apply `db/source-recorded-coordinates.sql` only after the existing source ledger and bounded read-wrapper SQL. It creates one private ledger, an administrator-only import, invalidation helpers and one bounded service-only reader. It does not change existing source RPCs, private-schema usage, existing table grants or the external source bridge.

In the current native `cos-operations-pages/index.ts`:

1. Import `readSourceRecordedCoordinates` and `projectSourceRecordedCoordinates` from `./sourceRecordedCoordinates.ts`.
2. After the fresh snapshot and current source reads in `/api/field-map`, call `const sourceRecorded = await readSourceRecordedCoordinates(freshSnapshot.inventoryItems, rpc);` using the existing native `rpc` closure.
3. Preserve the existing Owner, automatic and reviewed-property projection order. Assign the result of `projectReviewedAddressEstimates` to `projected`, then return `json(await projectSourceRecordedCoordinates(projected, sourceRecorded, freshAudits, freshDevices));`.

Raw tracker and imported-source family text is retained in the binding. Only the explicit plural support categories SOLAR STANDS 72, SOLAR POLES 72 and SOLAR SKIDS 144 map to their singular typed family keys; no generic suffix stripping or source renaming occurs.

No frontend write endpoint or browser/provider call is added. A failed native coordinate read returns no coordinate records. Fresh snapshot validation, full typed identity, source/address/native guards and current legacy evidence must all agree. A malformed or duplicate optional source DTO drops only source-recorded data. The projection preserves the complete map snapshot and all Owner/GPS/property data, never substitutes a historical point, and does not fail the Field Map route.

## Read-only conflict guard

A source point is withheld when a validated estimate for its exact current imported installation is more than 20 km away. Two independently validated, distinct source records are both withheld when their current address hashes, customer labels and site labels are identical but their coordinates are more than 20 km apart. Address similarity alone does not join installations or equipment identities. Nearby coordinates, including large construction-site distances below the threshold, remain eligible.

Only accepted Census or Geocodio results with valid coordinates, timestamps, current source bindings and matching address components can trigger the address comparison. Pending, stale, malformed, mismatched or lower-quality results cannot suppress a source point. The shared client validator also rejects that contradiction in an older backend DTO. The existing address-estimate selector continues to validate any approximate fallback; no point becomes verified GPS through this guard.

The response retains a conflict reason, separation distance, original coordinates, tracker cell and source-observation time in `locationSourceRecordedConflict`. The explanation appears only in selected unit details. Every projection clears old conflict flags before reevaluating current evidence. The source ledger, raw history, Owner/manual/GPS/property points, camera associations and nearby-distance rules are unchanged. No network request, database write, schema change or geocoder call is added. Installation comparisons are grouped by their exact evidence key rather than scanning unrelated pairs.

## Administrator review and import

Real identities and data remain outside the repository. For each explicitly reviewed candidate, collect the current `cos_recorded_coordinate_binding` result using exact native/tracker identities, product, full labels and family. Compare it with the frozen source-address hash and current reviewed snapshot. Record fresh legacy evidence with `reviewedLegacyEvidenceSha256`; a new Owner/IT/history conflict requires review. Preserve the exact spreadsheet/tab/cell, literal coordinate-cell hash, source-file/row hashes and source-observed timestamp. Never invent a measurement time, house number or Owner actor.

Import the reviewed JSON batch with `app_private.cos_source_recorded_coordinates_admin_import` as the actual existing `postgres` administrator. `previousRecordId` is the latest saved ledger record, including inactive records. SQL compares all current guards under locks; a stale batch rolls back. Keep held/Shop/unsafe-annotation rows out of the batch. The procedure stores no raw source cell or private note. Native/source mutations permanently deactivate the old record; restoring an address does not resurrect it. Every reapplication requires a new CAS review. Global ProductId conflicts with existing sources or active coordinate records are denied; the current product source-event watermark remains bound even after a conflicting source is deleted.

After application, verify as the actual `service_role` with private-schema USAGE denied, then through the authorized native Field Map API and the frontend. Verify source counts, SRC provenance, unknown measurement time, blue 0-camera support, absence from nearby mode, and unchanged saved GPS/reviewed properties. No external provider lookup is required.
