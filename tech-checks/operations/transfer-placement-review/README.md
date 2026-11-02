# IT transfer eligibility repair — final scoped local candidate

Production is NOT activated. No production write, grant, push, merge, deployment, scan or transfer was performed. Existing approval remains pending. The original 11-file and later v2 packages are preserved under /workspace/cos-transfer-review.

## Exact scope and expected behavior

Initial activation is limited in the existing backend entrypoint to legacy keys solar_spotter:50, :51, :52, :53, :54 and :55. Other 756 legacy records keep their previous eligibility rules. Managed keys remain managed in immutable history: omitted or expired evidence never falls back to the old PDF placement. This scoped release does not claim the remaining legacy transfer placement is repaired.

Read-only census: native source 511c53aad122977375441c665aec2f379bfd414dd4009ce36ac7fe729dcc6ed1, saved 2026-11-02T21:36:08.2917Z, 925 equipment / 639 Shop / 286 Field. Legacy register has 762 records; 724 follow source_family -> lowercase underscore encoding plus exact unit_tag, including all 61 Solar Spotter records. No display labels or IPs participate in the bridge.

| Unit | Product ID | Result at observed source |
|---|---|---|
| 050 | 2300339 | Field, held |
| 051 | 2300340 | Field, held |
| 052 | 2300341 | Field, held; bridge also conservatively rejects its non-reviewed_product_id method |
| 053 | 2300342 | Shop, current unique reviewed binding, no existing custody/reservation hold; selectable after fresh admission |
| 054 | 2300344 | Shop but missing native binding; held |
| 055 | 2300343 | Field, held |

Engineering evidence establishes the 053 encoding bridge: existing reviewed Product binding -> native UUID 3316ab55-4f24-49c5-9d8e-9751e06e1da3 -> canonical key SOLAR SPOTTER:53 -> unique legacy primary key solar_spotter:53, whose stored source_family/canonical_family/workflow_type/unit_tag agree exactly. Full native census contains one canonical-key claim and one claim to this native UUID. The native producer scripts/build-mhelp-upload.mjs copies canonicalKey from reviewed identity evidence. The original legacy importer was not found in source history or recorded migrations; its code is not claimed as verified. Instead, the bridge validates the actual stored key encoding and full-census uniqueness on every admission. It cannot create a native binding, provider association or physical-identity claim. No additional identity confirmation from James is needed for this encoding conversion. SS054 does not pass it.

A global version was rejected during local review: it would have held 264 previously available records. It is NOT the release scope. The scoped candidate changes expected availability only for 053; all six currently have no other custody/reservation hold. Fresh production evidence must be rechecked before activation because assignments can change.

## Implementation

encodingBridge.mjs uses stored machine keys, reviewed_product_id binding provenance, current guards, exact Product/native references, evidence hashes and unique canonical identities. Leading-zero collisions, conflicting Products, inconsistent legacy encodings, aliases and missing proof are held. projectPlacement.mjs requires a complete reviewed mHelp source, original saved time within 45 minutes, current binding guard, Shop and unflagged lifecycle. No inferred name/IP mapping.

publisherAdapter.mjs uses the existing native COS_CAMERA_SNAPSHOT_SOURCE_V1 read and existing legacy service client. It reads source/register twice and rejects changes. The default bridge is generated from current stored evidence; no hand-maintained approval crosswalk is required. Explicit reviewed-crosswalk injection is retained for fixtures. A service-only null/null head read supports restart-safe optimistic admission. Ambiguous write outcomes are reported without retries.

The optional hook in shared-snapshot-review/scheduled-entry.mjs runs only after the existing camera cycle is committed. It gets at most 30 seconds within the original 140-second request window. It does not start another scan, add a timer, change cron cadence or run on app reads. Failure/defer/uncertainty does not alter the completed camera result. If cycles do not complete or publication stays unavailable, evidence expires and the affected units remain held. That dependency is explicit; continuous eligibility is not promised.

transfers/desk.js carries displayed placement evidence into the signed checkout request. Server submission compares it under the equipment and publication locks, preserves all role/custody/reservation/photo/signature/purpose checks, rechecks expiry before saving, and retains proof in immutable request/snapshot history. Exact signed request replay remains idempotent after later placement changes. Installation vs truck replenishment is unchanged.

## Exact database definitions and permissions

Target: legacy Supabase project goqrnolcvqnirjmzaeyk. Apply install.sql as ONE transaction; storage.sql/wiring.sql are component sources, not additional install steps.

New private table: app_private.techcheck_placement_batches_v1(generation bigint primary key, packet jsonb not null, admitted_at timestamptz not null). RLS enabled, no permissive policies; all table privileges revoked from PUBLIC, anon, authenticated and service_role. Immutable update/delete trigger reuses the existing immutable-evidence trigger function. No equipment, assignment or custody table is rewritten.

New functions (all SECURITY DEFINER, empty search_path, owned by installation principal postgres):
- public.cos_admit_transfer_placement_v1(p_expected_generation bigint, p_packet jsonb) returns bigint. EXECUTE granted only to existing service_role, explicitly revoked from PUBLIC/anon/authenticated. Explicit service JWT-role check. Null/null reads generation without writing; other calls perform CAS, freshness, source/scope/identity validation and append one immutable batch.
- app_private.techcheck_placement_evidence_v1(p_key text) returns jsonb. No direct PUBLIC/anon/authenticated/service_role EXECUTE. Supplies fresh eligible evidence to existing guarded functions.
- app_private.techcheck_placement_managed_v1(p_key text) returns boolean. Same no-direct-execute privileges. Checks historical admitted scope so a managed record cannot fall back silently.

Existing function bodies replaced, signatures and ACLs preserved:
- app_private.techcheck_transfer_context_core_v1() returns jsonb
- app_private.techcheck_transfer_custody_hold_v1(p_key text) returns text
- app_private.submit_techcheck_transfer_v2(p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text,p_purpose text) returns jsonb

Fresh read-only preflight matched all expected original body MD5s: context 0c9536b4fb2ccbf74c6107c5e77244c1; custody 42e4c5be29341d9035cf4af3d4568a77; submit 226943124157448ca0632c94285b5570. Existing private submit has authenticated EXECUTE and role checks; that existing permission is unchanged. Public authenticated wrappers are unchanged. Installation/rollback abort on body drift.

Security change is real and bounded: the existing backend service gains EXECUTE on one new admission/head-read RPC backed by a private ledger. No new principal, token or credential; no new native-project permission; no user gets direct ledger access. The RPC validates scopes supplied by trusted backend code; the production candidate's caller fixes scope to the six listed keys.

## Production artifacts and target paths — NOT executed

1. Database install.sql above.
2. Legacy camera-health-sweep, replacing verified served v64 only with /workspace/cos-transfer-review/camera-health-sweep-transfer-candidate.ts. Candidate is assembled from the exact served v64 source, not unrelated local camera work. It adds the transfer helper module, changes runCompletedCameraCycle and enables its scoped option at the existing call site. Assembly reverses these changes and asserts all other served bytes equal baseline. Endpoint-preparation changes, authentication, other camera behavior and cron settings are preserved.
3. Frontend repo cypressriveroasis2023-sudo/neon-oasis-game, tech-checks/transfers/desk.js only for runtime UI. Tests/review files may be committed as scoped supporting source. No Operations dist replacement, design PR, App/router/theme change or unrelated camera release.
4. Native tughscoxralhofrckvxy cos-sheets-placement-publish v10 is read-only reused via /camera-snapshot-source. No native deployment/grant required. Its served reader already supplies the baseline binding evidence under existing cron verification.

## Tests and checks

37 focused + existing purpose/integration tests passed together; the strengthened actual automatic encoding -> existing native source shape -> real service RPC -> authenticated context -> signed submit test also passed in the final 11-test database rerun. This is not a hand-built membership Map substitute.

11 Chromium browser tests passed, including 390px mobile installation/signature and existing purpose/receipt/Owner workflows. One network-disabled PostgreSQL 17 test passed both lock orderings: publication-first forces waiting checkout to see Field and reject; checkout-first retains its exact signed evidence through commit. Two tests against the assembled served artifact passed: GET/app read cannot probe/publish; unauthorized POST stops at existing cron verification. esbuild and git diff --check passed.

Remaining required checks before/after authorized publication: fresh remote main/workflow/overlap and exact release-head checks; revalidate served v64 and SQL hashes; fresh six-record placement/custody census; inspect actual grant readback; observe the next genuine scheduled admission and its source age; verify real signed-in IT mobile selector and withheld cases without submitting a transfer on anyone's behalf. Physical iPhone/WebKit is untested. Hosted checks and production readbacks are unrun because publication is not approved. No whole-repository broad suite rerun is justified for this scoped change beyond required CI checks.

## Rollback and approval request

Rollback.sql verifies candidate function hashes, revokes service_role admission execution and restores the original three function bodies atomically. Retain all ledger and signed-transfer history. Restore the saved byte-exact v64 backend and only the old desk.js revision. No inventory/SIM/customer assignment or physical custody undo is needed. Rollback restores old 053 exclusion; it is not a placement fix.

Concrete approval scope: install this private transfer evidence ledger and backend-only RPC/helpers in the legacy project, publish the scoped existing-backend and transfer-desk changes for Solar Spotter 050–055, and verify a genuine scheduled result. 053 becomes selectable only while fresh Shop/identity/custody evidence permits it; 054 remains held. No equipment assignment, camera setting, signature or recipient acceptance is changed. Production approval remains pending.

## Search addition (local, November 2)

The existing transfer desk now has a labelled search input plus its native equipment selector. Search accepts padded unit numbers, compact family/name text and keywords; numeric tokens match exactly, while exact equipment keys remain separate even for identical numbers in different families. It filters the existing authorized context only. Disabled choices retain their hold text, and matching holds are also rendered as readable text outside the native menu. Enter moves focus to the selector without submitting; Clear restores the list. Search/selection stay in memory across form rerenders and Back/reopen, and a selection hidden by filtering is cleared. No new persistence or credentials. Add rechecks eligibility as well as the existing guarded server submission.

New files: transfers/equipment-search.js, tests/equipment-search.test.mjs, tests/transfer-search.browser.spec.mjs. Publish the new JS module alongside desk.js. No App/router/theme/design files change. Managed placement messages now distinguish expired source, current Field evidence, unavailable verified binding, and held Shop identity evidence. These messages do not grant eligibility or infer missing Product IDs. SS053 remains the intended newly selectable record, four Field records stay excluded, and SS054 stays held. Production approval remains pending.

Final local verification includes 13 placement/search assertions (actual database admission, signed submission, denial, expiry and rollback), the combined browser suite, and a rerun of both PostgreSQL concurrency orderings. See transfer-search-final-unit.log, transfer-search-final-browser.log and transfer-search-concurrency.log in the release packet. Earlier failed test runs are retained: a native-option assertion was changed to inspect its actual disabled property; a fixture startup wait at desktop size timed out, while the explicit mobile fixture and final suite establish the supported mobile path. No physical iPhone/WebKit or live transfer is claimed.
