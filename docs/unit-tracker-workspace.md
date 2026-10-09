# Unit Tracker workspace and pending request contract

## Current scope

Owners and the two existing verified IT identities get a Unit Tracker entry in their existing COS workspace. Service has no new button or route. The page reads current COS inventory, shows exact imported tracker provenance and source values separately from newer COS placement/address values, and supports pending new-unit and tracker-field requests when the native queue is enabled.

**There is no Google Sheets publisher or Google authorization in this release.** Every queued request remains `awaiting_sheets_connection`. Saving a request does not change the workbook, native equipment, Camera Health, or Field View. The UI says this before confirmation and after a verified save. This independent release contains no PR81 imported-address editor module or route. The existing Field View and Camera Health navigation remains available for current live controls.

The only supported workbook is the current 2027 tracker, `1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA`. Legacy/2026 workbooks cannot enter this queue.

## Rollout and dependencies

1. Review the source changes and all tests. Publish through the existing serialized COS release lane; preserve the Field View Home change first.
2. The bridge/frontend can be deployed before queue SQL. Missing native RPCs return a readable `availability: unavailable` and `queueEnabled: false` response. No save button is enabled or successful save fabricated.
3. `tech-checks/operations/db/cos-unit-tracker-outbox.sql` is an **unapplied, default-off review artifact**. It depends on the existing typed source-V2 schema and existing actor/permission functions, not the blocked app-address or generic-importer migrations. It changes no imported source/fleet row and creates no account, credential or schema-USAGE grant. Approval for its new RPC access and separate activation is still required before live use.
4. Re-run the included temporary PostgreSQL concurrency fixture against the final SQL before enabling the queue. The reviewed artifact passed eight real PostgreSQL 17 concurrency/readback checks; PGlite also covers transaction rollback and source non-mutation.
5. Enable pending request collection only after the native schema, bridge and UI contracts have been verified together. No Google connector flag can be enabled by this code.

## Identity and source ownership

- Existing updates bind the exact native UUID, imported source revision, current-workbook source record ID, broad family, full model/variant, and unit label. Number-only, IP-based or fuzzy association is forbidden. Decimal labels such as `023.1` and `029.2` are preserved exactly and remain distinct from the corresponding whole-number label.
- New units are immutable proposals with a family, full model/variant and unit label. They do not invent native UUIDs or append spreadsheet rows. The future publisher must resolve and verify their target tab/columns before creation.
- The imported source revision is a COS snapshot revision, **not** a live Google Sheets revision.
- Omitted changes preserve current source values. An explicit `null` requests clearing that specific optional field. Moving a proposal to Shop/Inactive does not silently erase omitted address cells.
- FIELD proposals require street, state and city or ZIP. New Shop/Inactive proposals cannot include a field address. Unsafe text, links, formulas, credentials, IPs and contact details are rejected in the client, bridge and SQL.
- Formula-bearing/unsupported cells have no write route. The original source, spreadsheet formulas, equipment locations and existing app corrections remain untouched.
- One pending update is allowed per exact unit; one pending addition per full model/label. Requests are immutable. Editing, canceling and publication of queued requests are deliberately not implemented in this default-off release.

## Persistence and recovery

The server binds actor and organization from the authenticated existing COS link. Browser-supplied actor, organization, SQL/RPC names and workbook IDs are never accepted. Public native RPC execution is restricted to the existing server role; the private tables have RLS and no direct anonymous/authenticated/server-role table access.

The request UUID is an idempotency key. An identical retry by the same actor returns the original receipt, including after source refresh or queue disable. Reusing it with changed data or a different actor fails. Exact-identity unique indexes and bounded transactional locking prevent duplicate pending proposals. Insert failures roll back without a ghost receipt.

A save is shown as verified only after exact request-ID readback matches the submitted identity, source revision and changes, and `ownedByCurrentActor` is true. A receipt with the same ID but different fields, a different author, partial data or alleged published state is rejected. An ambiguous failure is never auto-replayed. A definite validation/conflict rejection retains the editable draft; refresh merges only the user's intended changes onto fresh source values for a new review.

Snapshot history is capped at 100 with an explicit truncation flag. Every source also carries its exact pending-request ID, and exact source/request read APIs return older pending records independently of the recent list. Truncation cannot turn an existing pending request into a misleading empty state.

## Secure Sheets setup still required

The deployed bridge was inspected by configuration names only. It has no Sheets API or Google OAuth/service-account integration. Assistant-connected Google Drive access is not backend authorization.

A future separately reviewed connector needs:

- User-approved Google authorization for COS, preferably per-file `drive.file` consent selecting only this 2027 workbook, using an existing Google Cloud project when appropriate.
- Secure server-held credentials or refresh token, with no credential in a browser bundle, repository, log, outbox row, export or support message. Creating/configuring persistent access requires specific approval; credentials must use the supported secure handoff.
- A hard allowlist of the current workbook, verified tab IDs and editable columns. Google authorization scopes apply at spreadsheet-file level, not individual tabs.
- A fresh read of exact row identity, cell values, formulas and protections before each write, plus source/manual-change conflict review. Do not write an imported snapshot over newer manual data.
- A bounded idempotent write and exact cell readback before any status can become synced. Partial/uncertain external writes need their own safe reconciliation. No production test rows or equipment moves.

Official references: [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), [server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Supabase server secrets](https://supabase.com/docs/guides/functions/secrets).

## Verification

Tests use synthetic local data only. The optional `tests/unit-tracker-concurrency.py` starts and stops a temporary loopback-only database using an existing PostgreSQL installation; it never connects to a production host. Its eight checks cover duplicate commits, identical retries, actor revocation, rollout changes, native lock contention, authorization through commit, stale isolation and exact author readback. Unit/SQL fixtures cover actor and route denial, exact identity, repeated requests, source revisions, explicit null/omitted fields, formula/secret rejection, duplicate identities, transaction rollback, pending-list truncation, exact author-verified readback, and non-mutation of original source/fleet rows.

Browser fixtures cover Owner and both verified IT Home entries, no Service entry, role loss/late capability races, default-off UI, mobile and desktop layouts, add/update review, duplicate clicks, Cancel/Escape/Back, stale-source recovery, altered receipts, wrong authors and exact readback beyond the recent-history limit. Generated browser builds and screenshots are local verification artifacts; no production data is mutated by them.
