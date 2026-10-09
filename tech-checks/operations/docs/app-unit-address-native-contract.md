# Native app address persistence

`db/cos-app-unit-address.sql` is a review artifact for the native COS database. It has not been applied to a remote database. Apply it after the existing source read-access/admin-import/native-map-identity, tracker V2, inactive placement and source-precedence artifacts. It preserves the existing source serializer and importer responses.

The artifact adds an app-owned current address and immutable history for imported tracker-only units. The stable key is the native tracker UUID plus its original `sourceSystem` and `productId` or `sourceRecordId`. It does not edit imported source rows, tracker records, equipment, GPS, source files, legacy placement audits or source associations.

## Authorization and rollout

The three app RPCs are service-role-only wrappers. Every call checks the fixed native organization, calls the existing `appdeploy_assume_actor`, checks existing equipment-view permission, and verifies active organization membership and the matching existing role. Only the already-linked native Owner and two verified IT identities are admitted. Service, other Owner/IT IDs, inactive profiles, changed roles, other organizations and direct anonymous/authenticated RPC callers are rejected. For a save, profile/role rows remain locked against concurrent authorization changes through commit. No account, role, permission, credential or `app_private` schema usage is added.

All four new private tables have RLS and no direct grants to anonymous, authenticated or service roles. History cannot be updated, deleted or truncated, including by its SQL owner through ordinary DML. Existing source-read RPC ACLs are preserved.

The native rollout row starts disabled. It cannot be enabled unless all six readiness flags are true: native, Operations bridge, geocoder worker, geocoder queue, every source/map reader, and legacy proof. The row has no application writer. An independently authorized rollout must verify the deployed `COS_APP_UNIT_ADDRESS_V1` contract in all those components before an administrator changes it. Operations exposes the editor only when this native readiness gate and the legacy proof/queue capability both verify successfully; it checks them again before each address request. A client feature flag alone cannot enable a write. Merely applying this SQL does not activate editing.

Once saved, an app address remains authoritative to upgraded readers even if editing is subsequently disabled. Rolling back readers to versions that do not understand app authority is unsafe. To halt a rollout, disable new edits and keep the upgraded readers/queue operating; do not expose the older imported address as fallback.

## RPC contract

`cos_app_unit_address_capability(p_actor_user_id, p_organization_id)` returns the contract, a boolean `enabled` and six readiness booleans. No unbounded operational details or user directory are returned.

`cos_app_unit_address_read(p_actor_user_id, p_organization_id, p_native_unit_id)` returns:

- `contract`, `unitId`, `unitNumber` and typed `sourceIdentity`
- Original `sourceRevision`, nullable app `revision`, `stableIdentitySha256` and native `placementRevision`
- Effective native app `placement`, nullable `installation`, `siteLabel`, `sourceConflict`, and `editable`
- At most 20 latest history entries, with the actual actor UUID/role, saved time, placement and address
- Private `addressAuthority` for the authenticated Operations server to compare with the current legacy proof; the browser DTO strips it

An existing partial address is returned as stored so the editor can repair it. New Field addresses require a safe street, supported state, and city or ZIP. The fixed address fields are street, city, state and ZIP. Shop and Inactive require a null installation and generate no address for geocoding. Inactive is an app placement decision, not provider deactivation.

`cos_app_unit_address_save` takes:

1. Server-derived actor/organization and native tracker UUID
2. `p_expected_source_revision`, nullable `p_expected_overlay_revision`, `p_expected_stable_identity_sha256`, and `p_expected_placement_revision`
3. `p_placement_proof`: exactly `{contract, legacyUnitKey, legacyIdentitySha256, legacyPlacementSha256}` with contract `COS_APP_UNIT_ADDRESS_V1`
4. `p_request_id`, desired `p_placement`, `p_installation`, and `p_site_label`
5. `p_effective_before`: exactly `{placement, installation, siteLabel}`, derived by the bridge from the effective address after checking the current legacy proof

It returns `{changed, record}`. A normalized no-op generates no app revision, audit, event, or queue work. Cancel does not call the RPC. A retry of the same request ID and exact normalized payload is idempotent; reusing the request ID for different content/actor or after a later edit fails closed.

The bridge's effective-before value is necessary when a current legacy Owner placement differs from the imported/native value. Restoring the original imported address is then a real app decision and records the actual prior effective address; it must not be mistaken for a no-op merely because the original source already contains the desired bytes.

The native database cannot atomically read or commit against the legacy project. The authenticated bridge derives the before-value, refreshes the legacy identity/placement proof immediately before saving, checks it again afterward, and reports a raced later placement instead of claiming the app address still wins. Native SQL validates the bounded proof/before-value, but their cross-project freshness remains the bridge's responsibility.

## Concurrency, revisions and geocoding

Saving requires a fresh READ COMMITTED transaction. It takes the existing per-unit admission advisory lock, then `SHARE ... NOWAIT` locks on native equipment and tracker tables, then source/current-overlay row locks with NOWAIT. After those locks, it locks the actor's profile, role memberships, role definitions and rollout row with NOWAIT, and repeats authorization and readiness checks. A revocation or rollout stop committed during the advisory wait therefore takes effect before the write. Once the checks pass, those rows stay protected until commit. The table locks protect the absence of a competing native identity; locking only the selected tracker would permit a conflicting equipment insert. Native or authorization writers already in progress cause a retryable lock error instead of an inverted lock wait. No global address clock lock is introduced.

Source and overlay revisions, stable native/source identity and native placement revision are compared independently. Tracker/source deletion, recreation, identity change and restore, competing equipment, competing tracker identity and truncation advance persistent identity incarnations. Mutable tracker address/site/import observations advance native placement CAS without silently erasing the saved app decision. Actor history stays attached to the actual actor who saved; no synthetic Owner events are inserted.

The existing five source readers use a private effective-source helper. A valid overlay preserves original `sourceSystem`/typed source identity and schema V1/V2, but publishes its own immutable app revision/event, installation and address digest. Original file/row/native-guard evidence is captured at save. Its `addressAuthority` has exactly five fields: the four redacted proof fields plus `revision`, equal to the effective `sourceRevision`. Actor identity, history, stable native identity hash and raw original revision never cross the geocoder bridge. `sourcePrecedence` is not carried by an app overlay.

The original source serializer remains unchanged so administrator import responses continue to return original source revisions. Later mutable imports update that original row, while the app's complete effective binding, revision and event stay unchanged. Native reads flag `sourceConflict`; a valid same-address cache/pin does not disappear because an unrelated source import advanced its own event.

Every changed app value gets a fresh UUID revision and an event from the existing source-event sequence. Invalid native identity produces a fresh incarnation tombstone, so an in-flight old source revision cannot become current again. Both current-source readers and list-changes include tombstones for deleted source rows with surviving overlays. Map projection returns an explicit `UNKNOWN` marker for invalid/orphaned overlays, with null installation/address/pin material, so a first page load cannot fall back to the stale imported address merely because the app entry was omitted.

As with the existing source stream, sequence numbers are not commit-order watermarks. Consumers must retain bounded full-scan/wrap behavior. A source change event for unchanged imported content does not need to invalidate an unchanged app binding.

## Verification

Run `node --test tests/app-unit-address-sql.test.mjs` from `tech-checks/operations`.

The PGlite integration suite installs the actual native source, tracker, inactive and precedence artifacts and checks role/ACL denial, default-off readiness, untouched imported/tracker data, truthful immutable actor history, no-ops, request retries, each CAS guard, partial address repair, Field/Shop/Inactive, typed sheet identities, source refresh/cache stability, native/competing identity lifecycle invalidation, source orphan tombstones, first-load hold markers, bounded history and transaction rollback. These are local synthetic database tests; they do not claim a production rollout or cross-project atomicity.

`tests/app-unit-address-postgres.py` runs independent-session concurrency regressions against a new localhost-only throwaway PostgreSQL cluster. Supply an existing trusted PostgreSQL installation and a free local port, for example `python3 tests/app-unit-address-postgres.py --bin-dir /path/to/postgresql/bin --library-path /path/to/postgresql/libraries --port 55444`. It does not install software, use production credentials or connect remotely.

The PostgreSQL 17.11 run passed simultaneous editor CAS, active native writer retry, absence-of-competing-identity protection, exact binding stability after import, actor revocation and rollout stop during an advisory-lock wait, locked-profile fail-fast behavior, authorization locks through commit, and rejection of stale transaction-wide snapshots. The local source SQL digest printed by that run identifies the exact artifact tested.

## Legacy queue and field readers

Apply `db/geocodio-app-unit-address.sql` to the legacy project before enabling the writer. It verifies that all six existing sync/read/claim/finish/postal call sites use the same central guard. It adds the proof, bounded ordered proof-batch, and capability readers for existing verified fleet accounts and service callers. It keeps ordinary imports and the existing shared Census and Geocodio queues, cache, deduplication and 2,400-credit limit.

A proof binds the complete exact raw camera group, physical identity epochs and placement audit rows plus append-only placement epochs. Audit insert/update/delete/truncate cannot revive an earlier proof by restoring old row contents. Unknown model labels can establish only a full-label absence proof; they cannot establish a camera association. No actor or raw audit data crosses the geocode source bridge.

The Operations editor brackets its current identity/placement read between two fresh legacy proofs, then compares native source/overlay/placement revisions. Its visible prefill and immutable effective-before audit derive from that bracketed read. The Field Map batches at most 100 proofs per read and brackets its final source/identity projection. A later manual decision wins only when its proof stays stable across those reads; a changed proof holds the old point rather than showing an unverified fallback.

The entered app address is labeled as a COS app Owner / IT address. The immutable original source system and file/row hashes identify its original imported unit, not the author of the correction. Geocoder results keep their Census or Geocodio provider labels, remain unverified estimates, and never become live GPS or grant IT GPS editing rights. Original reviewed property receipts, source-recorded coordinate provenance and verified manual GPS remain independently checked.

Rollout order: deploy and verify the legacy proof/queue SQL, geocoder worker and redacted source bridge, native SQL/readers, Operations backend and frontend; then verify all capabilities and consumer versions before the separately authorized administrator activation. Do not downgrade a reader after an app correction exists. No production artifact has been installed or activated by this local change.
