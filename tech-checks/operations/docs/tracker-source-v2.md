# Typed tracker installation sources

This is a local review packet. It contains no production source rows and performs no deployment, source import, provider lookup or quota reset.

The existing imported-source ledger accepts a second, explicit identity. Product imports retain their exact V1 JSON contract with a decimal `productId`. A Google tracker row uses V2, `sourceSystem: "google_sheet_tracker"`, and a `sourceRecordId` shaped as `google_sheet:<spreadsheet-id>:<tab-id>:<full-family-and-capacity>|<unit-id>`. V2 omits `productId` altogether. The full tracker identity is stable if its worksheet row moves; the current A1 range is provenance, never an identity join. A bare unit number cannot bind a row.

The original bounded cursor, read bridge, legacy job queue, Census-first worker, reservation lock, address cache and free-only Geocodio control are reused. V2 does not create a second allowance or pipeline. The existing account limit remains 2,400 quota-charged requests against the provider's 2,500 free allowance; this artifact does not change either configuration. Equal address digests can share results only through the current postal and quality validators. The historical postal retry cohort remains V1-only.

## Native admission and currentness

`cos-tracker-source-v2.sql` adds typed columns without rewriting existing rows, source revisions or event IDs. Existing product uniqueness remains. A separate unique index binds organization, source system and record identity. `cos_source_record` emits V1 unchanged and V2 only for tracker identities. Native event history records the typed identity as well.

The private, SQL-administrator-only `cos_tracker_sources_admin_import_reviewed` accepts 1–250 explicit reviewed rows. No service, anonymous or authenticated execution is granted. Its optional `createTracker: true` path creates a distinct read-only tracker inventory row and the source binding atomically. It takes deterministic native locks and short NOWAIT membership locks before checking exact target/full-label absence. If an ordinary writer owns a conflicting lock, admission fails with SQLSTATE 55P03. Roll back the entire failed attempt, refresh the source/native preflight, and retry only as a new transaction; never wait while holding one table lock. It never creates registered equipment, a camera association, an Owner audit, GPS, a property estimate, provider identity, permission or credential.

Creation also requires the separately reviewed tracker display category (`trackerFamily`). Preserve the full source family/capacity in the source identity and `family`, while retaining the source tracker’s existing display category for correct support classification. Do not derive the display category from a bare number or change the classifier.

For an existing tracker, omit/disable `createTracker` and supply the current native guard and previous source revision. Source-system/record identity and native bindings are immutable. A newer reviewed address creates a new source revision. Ordinary tracker edits, placement/GPS changes and native collision creation continue to invalidate the old source through the existing trigger. The worker re-reads currentness before requests and before results are accepted; stale results cannot publish or refund consumed quota.

Private provenance has exactly `sheetId`, `tabId`, `fullIdentity`, and `sourceRange`. Only typed identities, selected installation components, allowlisted unit metadata and existing hashes cross the bridge; the provenance object, arbitrary sheet cells, notes, contacts, credentials and access instructions do not. Source IDs are identifiers, not access tokens. The private payload must retain its snapshot/selected-row hash definitions and exact reviewed source rows outside the public repository.

The administrator-only typed revoke function creates an honest V2 tombstone. It does not erase event history, delete the asset, change tracker placement or rewrite unrelated sources. The V1 administrator revoke path rejects typed tracker sources.

## Ordered rollout

1. Finish and verify the PR77 source/postal release first. Keep all existing native source/read-access/admin-import/native-map-identity and legacy imported/postal/queue artifacts.
2. Record current hashes/counts of all existing source rows, source revisions/event IDs, tracker/native inventory, Owner/GPS/property records, health/provider identities and relevant ACLs. Record current free-only control, daily quota, account state and postal cohort. This is the baseline for preservation checks; do not copy raw source data or credentials into a public receipt.
3. Apply the additive native SQL artifact with no V2 data. Its existing readers stay scoped security definers with empty search paths, actual `service_role` caller checks and fixed organization. Native `app_private` USAGE remains false for `service_role`. No unrelated grants change.
4. Apply the additive legacy SQL artifact with no V2 data. It updates binding validation and source synchronization only, retaining the existing service gates and authorized read gate. No queue/cursor/cache/reservation history is reset or replaced. The historical retry-enrollment function explicitly rejects V2.
5. Deploy the compatible native bridge, legacy worker and native Operations readers. These edits use existing files: `cos-geocode-sources/index.ts`; `camera-field-geocode/importedSources.ts` and `importedGeocodeSweep.ts`; `cos-operations-pages/importedSourceProjection.ts`. Bundle the full current dependencies with their existing entrypoints and authentication configuration. There are no extra files or credentials to add to either bundle.
6. Publish the frontend built with the compatible shared imported binding validator. Verify exact deployed source hashes/version, all mixed V1/V2 contract tests, normal V1 reads, role denials, and preservation baseline. A source-code merge alone does not prove reader deployment.
7. Only after every reader above is verified, freshly re-read the source tracker and native/source roster. Confirm exact full identities, no new target/collision, approved source provenance and unchanged selected addresses. Admit the separately reviewed private payload through the existing SQL administrator. Do not route admission through the bridge or impersonate a service role. Re-read the new source identities and assert every pre-existing source/revision and authoritative record still matches the baseline.
8. Let the existing ordinary worker/cadence consume the new rows. Verify distinct inventory identities, current source binding, one address group where appropriate, and honest estimate/no-match state. Do not enroll V2 in historical postal recovery, override a source hold, claim live GPS or success before a real result, or change provider quota settings.

## Rollback compatibility

Before any V2 admission, the additive schema can remain idle while compatible application changes are reverted. No data needs deleting.

After a V2 event exists, retain V2-capable bridge, worker, SQL readers and native/frontend validators. Revoking the source produces a V2 tombstone; it does not make a V1-only event reader safe. A V1-only reader can reject a mixed page and stall synchronization for every source. Do not hide/filter V2 events behind the same cursor, delete source/event history, or reset the cursor to work around this. Roll back behavior by withholding new admission and, when specifically authorized, revoking the exact typed source revision while keeping compatible readers. A future downgrade would require a separately reviewed versioned-feed design.

## Validation

The synthetic fixtures exercise eight distinct tracker creations, unchanged V1 envelopes, mixed cursor pages, exact typed binding, duplicate/forgery denials, source edits and tombstones, native private-USAGE=false reads, administrator-only admission/revoke, Census and Geocodio paths through both databases, address cache sharing, postal agreement, the shared 2,400 cap, no historical V2 enrollment, Owner/GPS/site precedence, and the frontend estimate validator. Provider responses are mocked; these tests make no production calls and do not certify a real address result.
