# Local candidate: existing publisher address and provenance extension

This extends `cos-sheets-placement-publish`; it does not enable or replace the disabled two-way sync worker. It is opt-in per reviewed existing binding. No binding, database, Sheet, deployment or scheduled job has been changed by preparing this candidate.

## Owned cells

| Sheet | Existing publisher | Added address | Match-index updates |
| --- | --- | --- | --- |
| Nine regular tracker tabs | A identity; B placement, D customer, E site | F, header `PHYSICAL ADDRESS` | D equipment name, E customer/site; H note only |
| SOLAR POLES & SKIDS | A identity; F placement, E customer, C site | D, header `Location / Address` | Same index contract |

The fixed `MHELP MATCH INDEX` tab (1900169011) must have exact A/B/D/E/H headers, unique exact Product IDs and exact `tab title|unit label` keys. A/B remain immutable. H's `ServiceItem_List_YYYYMMDDHHMMSS.csv` value remains the historical export identity used by existing readers. Its note carries explicitly labeled **current mHelp API snapshot** provenance: Product ID, accepted source/payload hashes, accepted snapshot timestamp, and known/unknown address. The original note is retained as a prefix. A later human note edit holds publication and cannot be silently absorbed by re-admission.

No IP, SIM, GPS, camera identity, formula, history or neighboring cell is written. All Google requests are single-cell `userEnteredValue` or H-only `note` updates. The reviewed full cell metadata and baseline must match. Dropdown values must permit each changed value. Maximum batch remains 60 products (at most 420 cell updates).

## Source and admission contract

The private source helper uses the accepted live-inventory candidate only when live and upload pointers agree, its payload hash verifies, the existing placement/native guard is current, there is no operational override, and exact Product ID, equipment label, customer/service IDs and placement agree with the confirmed observation. Actual customer/address evidence timestamps must remain within 20 minutes, with at most one minute future skew. It never refreshes evidence clocks. A known address requires verified service membership and fresh address evidence. Street/city/state/ZIP are joined for display; formatting whitespace is collapsed to spaces without adding address facts. Reviewed existing multiline address text remains comparable. Unknown address never clears a cell; if the reviewed address is nonempty, the entire product is held.

`fieldsReview.ts` is a pure, read-only review builder. Supply projections produced by `projectFieldTracker` from two independent full CellData reads (including notes), exact current private binding/location/authorization state, and `field_source` DTOs using the read H note as the initial prefix. For already opted-in rows, use the stored original note prefix. During initial review, the reader accepts a temporary truthy `fields` marker to request the extension columns; that marker is not admission. The output is explicitly `approvalRequired: true, executable: false`. Historical Oct 23 locators are not current reads or approval.

The private admin-only `admit_fields` function accepts only the exact explicitly approved manifest, a one-use authorization SHA256, a read no older than two minutes, matching current source, unchanged legacy baseline/location/authorization and no active publisher/pending writes. It records that complete manifest. It does not repair legacy bindings. Existing `repair_bindings` and its explicit approval contract remain unchanged; a later repair invalidates the extension location guard until separately reviewed again. No rows auto-enroll.

Stage compares the supplied source DTO against a newly resolved current source under source/native locks, checks every proposed value and metadata field, and stores extended pending intent atomically with the original intent. Readback must match both contracts before either baseline advances. Ambiguous failures preserve pending intent. Exact historical pending readback can be acknowledged during a source outage; it does not claim newer source evidence. Private audit rows record stage and verified completion.

## Review and release dependencies (not executed)

1. Review the migration, rollback, tests and exact candidate. Obtain the separate publication and deployment grants. This work does not grant permission for either.
2. Capture the actual installed publisher RPC definitions/ACLs and deployed Edge artifact. Compare the narrow patch anchors and source schemas with this candidate. The install aborts on definition drift. The SQL retains exact original RPC definitions for rollback. Local tests cover the customer-style and freshness patches alongside the original publisher.
3. Disable the existing publisher and drain/resolve any lease or pending writes through the existing reviewed recovery process. Do not delete pending intent. Install the review-only `cos-publisher-fields-v1.sql` only after approval. It creates private tables/helpers and patches existing RPCs, but admits zero rows and leaves the publisher disabled. No backend127 redeploy or production SQL was performed here.
4. Bundle and deploy only this existing Edge publisher after its separate grant. Old workers fail closed for opted-in rows. Confirm metadata headers/types against live reads. Do not enable `cos-operational-sheets-sync`.
5. Obtain two current identical full CellData reads and current source/guard evidence outside this coding task. Generate and explicitly approve the exact fresh manifest. Invoke private admission only with that grant; expire and regenerate if older than two minutes. The historical 434-row classification is not executable authority.
6. Re-enable only the existing publisher after approved deployment/admission and perform authorized bounded live QA: known address, unknown-address hold, special tab, index identity/provenance, exact readback/audit, and unchanged IP/SIM/GPS/formulas/history. Local tests do not establish live acceptance or repair the 138 historical binding holds.

## Rollback

Disable and quiesce the publisher, preserving/resolving all pending intents first. Review and apply `cos-publisher-fields-v1-rollback.sql`: it refuses if RPC definitions have drifted and restores the exact saved originals with existing ACLs. Restore the captured prior Edge artifact. Audit, approved manifests and field baselines remain private and retained; no Sheet values, operational data or source timestamps are reversed. Restoring the old publisher restores its previous four-cell behavior, so address/provenance publishing stops. Reinstallation requires a new reviewed migration; this draft intentionally is not rerunnable.

## Limits

Google Sheets does not offer compare-and-set cell writes. Two reads, source staging and exact readback reduce and detect races but cannot prevent a collaborator editing between the last read and POST. A readback mismatch holds pending state for review. Header/type changes, numeric rather than exact textual Product IDs, duplicate index identities, stale source, manual edits, unverified addresses and guard changes fail closed. This candidate does not broaden authority to make those rows publish.
