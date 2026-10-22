# Equipment handoff purpose and receipt reliability

## Problem and resulting behavior

The old handoff treated every equipment transfer as a battery-bearing package. It also allowed another Service receipt while a previous receipt was in discrepancy review. A capitalization difference between approved family names could keep the handoff unresolved.

IT must now choose **Truck replenishment** or **Installation** before checking out equipment. Replenishment records equipment for truck spares with no battery quantity, battery configuration, or battery-only preparation attestation. The Service technician confirms the listed equipment, with an explicit option for missing or different equipment. Battery quantities remain in the separate daily truck inventory.

For installation, the Owner's October 22, 2026 instructions define these packages:

| Equipment | Required installation package |
| --- | --- |
| Solar Spotter | 4 x 12V 110Ah batteries per stand |
| Helios | 1 battery box |
| Sniper | 2 x 12V 35Ah batteries |
| Ranger | 1 LiFePO4 battery |

Existing Recon II configured quantities and the regular Spotter's no-internal-battery policy remain separate. The former alternate Solar 350Ah package is not offered or accepted for new installation checkouts. Historical signed values are retained.

One receipt is permitted per recorded purpose revision, including a receipt reporting discrepancies. A network retry uses the identical request UUID and payload and returns the saved result without another event or outbox entry. Unchanged approved family labels compare without capitalization differences; equipment keys, full tags, SIM numbers, parts and actual installation battery differences remain exact.

## Existing handoffs and evidence

Unclassified historical handoffs are not silently reclassified. The original verified IT actor or an active Owner can record an audited purpose amendment for an unresolved handoff. It preserves original signed events, names, signatures, photos and receipt revisions and requests a new independent Service confirmation. The amendment records its actual actor without manufacturing a signature. A completed handoff cannot be reopened through classification, and classification cannot be used repeatedly.

An old backup handoff cannot be classified as Installation without its original signed installation-readiness checks. In that case the supported path is to cancel and create a proper installation handoff.

A matched replenishment item may reuse its existing, readable IT checkout photo. The server records the source event, actor and timestamp. The delivery worker copies that photo into the new receipt archive with an explicit original-IT label and retains the provenance in its JSON, HTML and PDF. Different equipment requires fresh evidence. Mixed receipts can reuse evidence for the unchanged items while recording missing or different items honestly.

## Scope and release controls

- Database migration: `../../database-maintenance/techcheck-transfer-purpose-v2.sql`.
- The migration requires the exact reviewed installed core, submit wrapper and context function definitions. Drift aborts the migration transaction.
- Existing role, ownership, signer, revision, custody, equipment reservation and evidence checks remain active. The saved event history is immutable.
- Legacy frozen requests retain their exact replay path. Fresh outdated checkout or receipt requests ask the user to reload.
- The migration does not update permanent stock, placement, device health, daily truck counts, provider settings or existing delivery state.
- Deploy the backward-compatible transfer report/worker and the daily-delivery report dependency before enabling the new database event type. Preserve each deployed function's existing entrypoint, other source files and authentication configuration.
- Use the normal published-site workflow and exact published asset verification. Recheck current database definitions and deployed function versions before applying the release.
- Separate outstanding equipment-correction and Owner-assignment changes are not included. Those changes require rebasing and compatibility review against the added purpose event kind.

## Verification

Focused tests cover purpose selection, fixed installation packages, simple replenishment, exact equipment differences, mixed receipts, independent sign-off, stale drafts, double submission, lost-response retries, purpose-amendment recovery, original-event preservation, report rendering and archive provenance. TypeScript and the existing application build pass. Synthetic PDFs for replenishment, installation and purpose amendment were rendered and visually inspected.

`tests/transfer-purpose-concurrency.mjs` is a required hosted proof against disposable local PostgreSQL 17. It observes actual overlapping database transactions and lock waits, then checks that two fresh request UUIDs produce one receipt and that an identical concurrent retry returns the original event. It is opt-in and hardcoded to the isolated CI service; it cannot connect to production. Local PGlite tests alone are not represented as proof of overlapping native PostgreSQL transactions.

The focused diagnostics fixture fix serves the real embedded Operations path instead of redirecting to the top-level page. No diagnostic assertions or production navigation code change. Its local run passed eight cases with the existing one phone exclusion skipped.

All automated verification uses synthetic actors and records. No test emails or test custody events are sent to production.
