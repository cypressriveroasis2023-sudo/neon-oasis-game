# Seven canonical binding restorations - draft capability

The existing assignment review skips null bindings. This draft adds a distinct Owner stage and commit for seven fixed Product IDs. Only binding slots are restored; existing placementHeld/holdReason, mHelp placement/customer/address, native/tracker/camera/archive identities, IP/SIM and history remain unchanged. No production installation or restoration has occurred.

| Product ID | Exact source label |
| --- | --- |
| 1910800 | Radar Sniper 500 |
| 2221820 | Spotter 028.1 |
| 2232675 | Solar Spotter 010 |
| 2232677 | Solar Spotter 012 |
| 2274337 | Spotter 145 |
| 2275201 | Solar Spotter 039 |
| 2336149 | Spotter 182HDC2S |

All seven must pass atomically. Sniper 230 remains independently inventory-only, with no SIM/IP. Ranger 029.1 and 029.2 remain distinct cameras with separate IPs, outside scope. Prior confirmation of Spotter 028.1 is not a current Owner session or approval of changed protected state.

## Evidence and coordination

Built against main 12a2dff071ee545efb6e0d380a0f78abbb5c4088. No AGENTS.md or .agents/skills exists in the fresh checkout. PR #358 was open/draft at b1fb030fab10cbf74c15312380d8e49d045dd965; its deployment remains unverified. None of its 51 files are changed here. Recheck its final code/deployment and coordinate before release.

The delegated investigation reported matching historical guards at source 19874feaa92dffae9598e74ecf886872a496b06ab89d184d386742529a939864. This SHA was NOT freshly verified in this task. No live private history, target UUIDs, source receipts or Owner session were exported here. Synthetic tests do not certify that the live seven currently qualify.

Repository proof: assignment_review skips null bindings; recover_identity_evidence_records preserves them; authoritative_product_records requires historical reviewed_product_id bindings and exact current links; review_scoped_inventory requires existing canonical bindings. These are repository definitions, not deployed-definition attestations.

## Implementation

- db/canonical_binding_restoration.sql adds private immutable stages/receipts, server-side evidence inspection, protection locks and the service-role-only cos_owner_restore_seven_bindings_v1 RPC. It rechecks the existing Owner directory/tenant/permission assertion on every stage and commit.
- scripts/prepareCanonicalBindingRestorationSql.mjs generates a transactional review candidate from fresh exact pg_get_functiondef inputs. It rejects changed definitions or patch anchors, preserves the existing snapshot reader under a private helper, wraps its projection and patches the existing canonical-proof importer to retain holds. No deployed migration or automatic installer is included.
- cos-operations-pages/canonicalBindingRestoration.mjs is a dormant bridge, deliberately NOT routed. Browser actors, raw records, custom target IDs and unexpected fields are rejected. It validates exact seven-item receipts and derives actor solely from the injected server authenticator. Release must wire the existing verified-session/same-person Owner authenticator; a mocked verifier is not end-to-end login proof.
- analyzeCanonicalBindingEvidence.mjs is an optional offline private-export analyzer, never an authorization source; it always returns applyAuthorized:false.

Stage reads the complete active API batch and raw scoped revision/head/hash under locks. The source must be reviewed/complete, have matching control SHA, count, unique membership and checksum, and have succeeded within ten minutes. Every target must have its exact label, UNFLAGGED lifecycle and null binding, without scoped override/replacement or inventory-only restriction.

Every bound exact Product-ID row in historical upload batches is examined. Unreviewed, malformed or conflicting history fails the whole request, including older conflicts; no newest-wins rule exists. The draft conservatively supports only exact_family_unit canonical evidence. Aliases, archived targets and reviewed_product_id bindings requiring absent links remain blocked. Original reviewEvidence, canonicalKey, represented IDs, hashes, expectedGuard and previousAssignment are retained exactly. Other current/missing/historical Product IDs, aliases, source links and Owner product claims cannot reserve those identities.

The full existing upload_binding_guard is required unchanged. It covers native/tracker rows, geocode sources, archives, native location history and Owner claims. Additional camera-device/match/resource/revocation/event and link digests prevent stage-to-commit drift outside that guard. Camera digests deliberately include entire tables; unrelated or background camera changes may require a fresh coordinated review window. Do not silently weaken this gate.

Commit compares the exact stage digest, expiry and explicit confirmation, rechecks Owner permissions and every evidence/protection/function fingerprint, then appends a scoped batch, scoped audit and immutable restoration receipt in one transaction. Only the seven binding slots change. No source receipt, actor or current link is manufactured. Receipt failure rolls all scoped writes back. Exact replay returns the saved receipt only while the outcome is still current; changed arguments or authority fail closed. No expired stage is replayed.

The snapshot wrapper exposes audited bindings without private reviewEvidence, follows current scoped ancestry and checks the retained identity. Guard/camera/link drift marks projection non-current. The existing canonical-proof importer restores private evidence on the next source refresh; the new hook preserves existing placement holds. Assignment conflicts remain separate authorized work.

PR #358's existing COS_OWNER_EQUIPMENT_V1 advisory lock is acquired; its settings table, if present, is SHARE-locked. Any active override for the seven blocks restoration. No editor setting or schema is modified. Control locks follow the importer order; conflicting source, scoped, native and camera writers fail closed with NOWAIT.

## Immutability and authorization limits

Repository upload writers append with INSERT / ON CONFLICT DO NOTHING; no operational UPDATE/DELETE/TRUNCATE writer was found. The candidate explicitly adds an append-only trigger to upload_batches and to its new stages, receipts and function manifest. Runtime checks require enabled guards and unchanged function/ACL fingerprints. This protects evidence going forward under normal application roles; it does not authenticate fabricated history or prevent an administrator disabling protections. Verify original historical authorization/provenance and deployed writers/ACLs before approving shared-table hardening.

Keep production exports private. The offline analyzer expects exact PostgreSQL JSON text/checksums, not client-reserialized hashes. It does not authenticate an export, prove that every historical batch was supplied or establish current authority.

## Validation and release gates

Run from tech-checks/operations: node --test --test-concurrency=1 tests/canonical-binding-*.test.mjs

Tests execute actual repository scoped/read/importer definitions and the actual Owner directory/role assertion in disposable PGlite. They cover atomic restoration, full protected-table equality, Sniper/Ranger exclusions, snapshot readback, next-import private-proof and hold persistence, role/Owner/tenant denials, source/scope/IP/camera drift, expiry, receipt failure rollback, corrupt/ambiguous history, NULL representation, competing Owner claims, immutable storage and #358 override conflicts. Underlying appdeploy session/permission transport is a fixture, not a real Owner session.

The dedicated GitHub proof workflow runs the same database cases against PostgreSQL 17.11 plus independent-session tests for conflicting writers, simultaneous commits and later tracker writes. It has no deployment job or production secret. The adapter accepts only disposable loopback cos_restoration_test_* databases. Local Docker was unavailable; CI supplies the real PostgreSQL gate.

Before release: obtain fresh private evidence and deployed definitions; confirm the live seven meet the conservative contract; inspect generated SQL/ACLs; coordinate #358; pass PostgreSQL/concurrency checks; wire and test the real session verifier; obtain installation/action authorization. The Owner must then create a fresh stage and approve its exact digest. Read back the immutable receipt and preserved protected state before claiming a live restoration. No broad rollback/delete route is added: rollback would require a separately reviewed compensating scoped revision.
