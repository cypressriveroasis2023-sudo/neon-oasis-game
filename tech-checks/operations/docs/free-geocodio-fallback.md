# Free-only saved-address fallback

This is an additive, disabled-by-default implementation for the existing COS saved-installation-address queue. A browser still submits only its exact saved unit and placement audit ID. The existing legacy authorization, Census queue/audit/hash contract, and rooftop-only reviewed-estimate V2 contract are unchanged.

## Request and result boundaries

Census runs first. A new fallback looks only at current Census `no_match` records. Geocodio receives one basic GET request to `https://api.geocod.io/v2/geocode`, with only saved street, city, state, full ZIP (including ZIP+4 when provided), and constant `country=US`. Authentication is a bearer header. No query-string API key, enrichment, Lists, Distance, usage endpoint, batch API, paid fallback, user/customer/contact notes or equipment identity is sent.

The strict adapter requires one unambiguous result, exact house/street/city/state/full ZIP agreement, numerical accuracy 0.9–1, and `rooftop` or `range_interpolation`. Rooftop match type is limited to null, building centroid or parcel centroid; range interpolation requires null match type. Unit/apartment/suite addresses and non-address annotations require review rather than a silent building match. Provider error bodies, raw headers, raw source text and network exceptions never enter logs or persisted results.

Both allowed methods remain address estimates. The map shows Geocodio and its precise method, retains EST labeling, excludes estimates from nearby distances, and keeps a current Owner-confirmed location above any estimate. Neither automatic fallback nor this change gives IT manual-GPS write rights or Service fleet access.

## Durable safety controls

The additive SQL at `db/geocodio-free-fallback.sql` does not alter a Census table, RPC, trigger, or record. New state is in the private schema with RLS and explicit grants.

- One account-wide row lock plus conditional debit caps attempts at 2,400 per Eastern calendar day, below the provider's 2,500 free ceiling.
- `America/New_York` rollover is DST aware. No reservations in the final 60 seconds of the day. A returned permission expires within 10 seconds and the HTTP attempt times out after 10 seconds.
- Each durable request UUID can authorize one request only. Credits are never refunded after timeouts, crashes, uncertain completion, or superseded work.
- Organization-scoped address/hash cache deduplicates concurrent and repeated addresses. New audits may reuse a result only after their current exact binding is verified.
- Reserve, finish and read recheck the latest placement audit, complete current resource set, unit identity and address SHA. A stale job cannot publish a point.
- 403/401 stops the whole account until the next Eastern reset. 429 applies a shared conservative retry delay, up to a day. Three attempts per address/day defer further retries to reset.
- Unsupported addresses are retired per audit without consuming credits, preventing queue starvation. This never changes another audit's in-flight request or shared address result.

The local ledger cannot measure independent dashboard, other-key or other-application usage. Every automated account request must use it; retain the vendor hard cap of 2,500, no payment method and no purchased credits. Do not raise either limit or clear counters to expedite work.

## Explicit new permissions and callable routes

The existing `camera-field-geocode` keeps its existing POST endpoint, verify_jwt=false and its custom active-Owner/approved-IT or existing cron authorization. Its request body remains `unitKey`/`auditId` only.

New public-schema RPCs with EXECUTE restricted to existing `service_role` (not the fleet Service user role):

- `cos_field_geocode_fallback_list_due`
- `cos_field_geocode_fallback_reject_address`
- `cos_field_geocode_fallback_reserve`
- `cos_field_geocode_fallback_finish`

`cos_field_geocode_fallback_read_many` is granted to `authenticated` and `service_role`. Its SECURITY DEFINER body repeats the existing exact organization and active Owner/approved-IT helper check. Public/anonymous execution is revoked. It only reads exact current audit bindings.

All six new private tables revoke PUBLIC/anon/authenticated access. Backend service grants are: control SELECT only; account state SELECT/UPDATE; daily budget, reservations, shared cache and per-audit rejections SELECT/INSERT/UPDATE. No DELETE grants or control-enabling grant is added. Private projection/reset helper execution is backend-only. Existing schema usage and service BYPASSRLS are reused, not created.

## Staged serialized release

1. Review the source patch and pass required CI on its exact latest commit. Keep the normal source-based static-bundle build; do not commit a manually generated dist bundle.
2. Confirm the live baselines still match legacy `camera-field-geocode` v2 and native `cos-operations-pages` v24, or rebase the narrow deltas onto the newly verified versions. Preserve every unrelated native file/route/role. This release does not contain the separate native alias feature.
3. Apply only the approved additive SQL through the release process. Its control row starts `enabled=false, free_only=false`. Verify grants/advisors. Do not apply protected technician baseline migrations.
4. Deploy the nine legacy TypeScript source files with entrypoint `serve.ts` and existing verify_jwt=false. Deploy native v24's existing 17-file bundle with only its reviewed index delta plus `fallbackGeocodeProjection.ts`, `importedAddressContract.ts`, and `importedSourceProjection.ts`. Publish the verified UI source through the existing main workflow. With controls disabled this does not call Geocodio.
5. Wait for explicit confirmation that `GEOCODIO_API_KEY` was saved in the LEGACY project only. A names-only presence check may then verify setup; never expose/read the value. Confirm GET `/v2/geocode` scope and provider free-only hard cap/no-payment state. The separate, explicitly approved source-read bridge credential is described below; it grants no vendor or application write access.
6. In one authorized activation transaction, lock the singleton account-state row, then set only `free_only=true, enabled=true` on the singleton control. Preserve all budgets, reservations and account stops. If earlier disabled calls created `configuration_unavailable` deferred rows, make only those rows due in the same transaction. Activation requires the release coordinator's approval, never this source task.
7. Let the existing authorized saved-address/cron flow handle current eligible work. Do not manufacture an actor, save a fake address, replay an obsolete audit, or insert a one-off static pin. Read current results back and verify provenance/EST/manual-GPS priority. Keep any live incident check pinned to its freshly read audit/resources/address hash.

Rollback: disable only the control flag under the same account lock; preserve the charged ledger and accepted cache. Revert source if necessary. Do not delete ledger entries or revoke unrelated permissions.

## Verification

`npm test` executes the provider, handler, projection and UI fixtures plus executable synthetic PostgreSQL/PGlite tests against the canonical SQL. `npm run typecheck`, `npm run build`, and the existing browser suite remain required. Provider requests in tests are fixtures only. PostgreSQL multi-session contention is checked independently before activation; PGlite alone does not establish that proof.

## Official references (checked October 8, 2026)

- https://www.geocod.io/docs/ — bearer authentication, basic GET, result components/methods, errors and rate-limit headers
- https://www.geocod.io/guides/set-a-usage-limit — provider hard cutoff and Eastern midnight reset
- https://www.geocod.io/guides/exporting-your-usage — Eastern-time daily accounting
- https://www.geocod.io/pricing — first 2,500 daily lookups free
- https://supabase.com/changelog — no new framework, extension or middleware dependency introduced
- https://supabase.com/docs/guides/database/functions — database function privileges


## Fleet-wide imported sources

Two additional reviewed SQL artifacts extend the core without fabricating Owner audits:

- Native project: `db/cos-geocode-sources.sql` stores approved, data-driven ProductId↔stable native UUID mappings and selected installation parts. Identity kind distinguishes registered equipment from tracker-only rows. An import binds exact source file/row hashes, observed native guard and a previous source revision. Changed/deleted native placement or GPS invalidates it. The separately authorized source-import process must supply current unambiguous mappings; a CSV filename/export time never overrides a current Owner/IT move or manually confirmed location.
- Legacy project: `db/geocodio-imported-jobs.sql` adds typed imported jobs and source scans, imported Census cache/leases, and reuses the single existing account budget, Geocodio address cache and request ledger. Owner RPC definitions are unchanged. Imported sources are never inserted into `camera_inventory_audit`.

A new fixed native Edge Function, `cos-geocode-sources`, accepts POST only with `x-cos-geocode-source-key`, validating exactly 64 hexadecimal characters after trimming only the configured secret's outer whitespace. It exposes only bounded `list_changes` and `read_current` operations. Batch current reads accept at most 100 exact identities. It does not accept a user-provided URL, table/RPC name, actor, raw source payload, or write action. Its native service credential stays inside the native project. The legacy worker's own service credential stays inside legacy. `COS_GEOCODE_SOURCE_READ_KEY` is the separately approved read-only connection secret saved by the user in both projects. Never expose or persist its value in code, logs, jobs, receipts or source data.

The bridge sends only fixed-organization IDs, unit labels/family/variant, ProductId, source revision/event and file/row/address/native-guard digests, and sanitized installation street/city/state/ZIP. Unsupported secondary-unit, credential, contact, phone, gate-code, markup and malformed-address text is rejected. City OR ZIP may be absent, never both. Every supplied component must match the provider exactly; missing locality remains null in the original source, and the UI identifies provider-filled city/ZIP explicitly. The unchanged Owner adapter continues requiring its original complete address format.

Source sequence IDs are deliberately not a global commit-order guarantee. The worker performs complete bounded scans of the latest current source/tombstone rows, persists its per-scan cursor across invocations, and resets to zero only at EOF. A scan-generation CAS prevents overlapping workers resetting each other's cursors. Per-source monotonic event/revision checks prevent older observations replacing newer bindings. A late lower-ID commit appears on the next complete scan. Changed source guards suppress stale display immediately, before reconciliation catches up. More than 400 sources cannot starve the tail behind a repeated first-page scan.

The existing 15-minute cron remains unchanged. Owner queue work runs first. Imported sync gets at most four 100-row pages and its own approximately 20-second admission budget. Imported provider work has concurrency four, at most 80 unique addresses per invocation, and a 100-second overall request budget. It will not begin another stage with less than 40 seconds remaining or send against an expired reservation. Actual rollout time depends on eligible unique addresses, cache hits, provider latency and existing Owner work; there is no promise that hundreds of units appear instantly. Shared-address results can project to all currently bound units without repeated paid lookup.

The legacy deny-only guard recognizes related full families/base numbers and variants solely to suppress imported work. It never positively joins or assigns a legacy audit to a native unit. Existing Owner/IT placement, SHOP, cross-resource audit conflicts or uncertain variants take priority regardless of CSV export time. Exact current-source/legacy checks run before claim/reserve, at completion and at readback. Native projection re-reads its base snapshot, current source DTOs and legacy evidence after cross-project lookups before returning an effective address or estimate. A fresh source address or SHOP state replaces the historical imported presentation; old returned geocodes must match the new binding or are dropped. Previously imported identities that have become ineligible are held out of unverified map pins.

These reads are not a distributed transaction: a source can change immediately after a successful check. Source revisions, opaque currentness guards and final revalidation prevent deliberately attaching an old result to a newer known binding. They cannot guarantee that a source edit racing the HTTP send will prevent the old address from reaching the provider. The charged request is never refunded, and its obsolete result is withheld.

A separately sanitized placement/site label is stored and returned only by the native map projection. It never crosses the source bridge or reaches either geocoder. Changes to that label rotate the source revision.

The effective source address/classification is projected before current Owner placement. It uses separate `importedInstallation` / `importedPlacement` fields, not Owner audit claims, and reaches the Camera Health field editor through the existing field-map read. The editor's stale-read fingerprint includes source revisions; both HTML hosts load the updated script cache tag. Equipment identity gates and write permissions are unchanged. No icon, map zoom, health status, support-equipment classification or camera count is changed. Other native directories retain their existing source records; this projection is specifically the Field Map and the editor that reads it.

### Additional permissions and deployment order

All new imported-job mutations (`cursor_read`, `sync`, `scan_complete`, `invalidate`, `list_due`, `census_claim`, `census_finish`, `reserve`, `finish`, under `cos_imported_geocode_`) are restricted to backend `service_role`. `cos_imported_geocode_read_many` uses the same authenticated active Owner/approved-IT gate as the existing reader. New private tables have RLS and no anonymous/authenticated table access. The read-only native bridge can call only the three selected source-read RPCs.

Apply `db/cos-geocode-sources-read-access.sql` after the native source schema. Its five public readers have fixed empty search paths, require the actual `service_role` caller and fixed organization, and expose only the existing bounded projections. They run with the function owner's read privileges so the caller does not need `app_private` schema usage. Anonymous/authenticated reader execution and direct service-role access to the private schema remain denied. Existing schema privileges for other application roles are preserved; no unrelated function or table ACL is changed.

Apply the separately reviewed `db/cos-geocode-sources-admin-import.sql` for source admission. Its private `cos_geocode_sources_admin_import_reviewed` and `cos_geocode_sources_admin_revoke_reviewed` functions run as the existing SQL administrator with the original identity, GPS, revision and locking checks. They grant no service-role access and are not reachable through the bridge. Execute reviewed imports as the actual administrator, without user-session claims or a `SET ROLE service_role` substitution. The old public invoker import/revoke functions are not the deployment path.

Before deploying the native reader or activating imports, verify all five readers under the actual `service_role` with `app_private` usage denied. Also verify direct private access and admin admission are denied to service/anonymous/authenticated roles, and compare unrelated ACLs before and after. Tests must reproduce the live schema privileges; a generic fixture's broader schema grant is insufficient.

Apply the native source schema, scoped read/admin migrations and legacy core/imported schemas before their dependent Edge functions. Deploy native source bridge (entrypoint `serve.ts`, verify_jwt=false with its dedicated custom key check), then reviewed geocoder and native reader/UI bundles. Verify the approved key handoffs and perform only a bounded authorized read/provenance smoke test before enabling free-only provider fallback controls. Import only the current reviewed equipment export with fresh before-image guards; old source plans remain historical. Do not ingest ambiguous mappings, replace manual placement, or create unit-by-unit code exceptions.
