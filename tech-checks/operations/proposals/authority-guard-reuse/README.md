# Authority guard reuse candidate, November 13, 2026

**NOT INSTALLED, NOT DEPLOYED.** This is an isolated proposed database-function optimization, not a completed COS repair. No inventory, source, camera, provider, schedule, permission, or production data was changed by this investigation.

## Verified symptom

At November 12 20:28 America/Chicago the signed-in Fleet and TV pages render, but show last completed readings at 13:15:20 and 13:15:12 respectively, explicitly marked not current. The current frontend is main b03eb8ff, not draft PR387 (46c777fe). No evidence establishes Claude's draft frontend caused this.

Read-only native logs show scheduled source reads failing every 15 minutes and statement timeouts. Inventory control last success was 18:36:12 UTC; latest checked failure was inventory_source_unavailable at 02:19 UTC.

## Diagnosis and proposal

The current authoritative_product_records query can evaluate costly link guards on historical links before narrowing to wanted Product IDs. The current SELECT plan had 329 wanted Products but only one matching link. A materialized candidate_links CTE narrows exact Product IDs, and stores statement-current guard and Shop-return results once. All original evidence checks, ordering, duplicate rejection, and authority criteria remain present. This is not a persisted cache or relaxed freshness check.

Read-only production measurements (variable server load; not an SLA):
- scoped_base_upload_snapshot: 2218 ms
- identity_binding_base_upload_snapshot: 3088 ms
- current api_base_upload_snapshot: canceled at 8 seconds
- API wrapper without authority enrichment in a diagnostic SELECT: 4029 ms
- isolated candidate authority SELECT including identity input: 3914 ms

A same-statement live original/candidate result comparison was attempted under the unchanged 8-second budget, but the ORIGINAL authority guard timed out. Therefore production result equality and full end-to-end baseline timing are **not verified**. Do not install based only on the candidate timing.

## Files and local verification

The two db/20261113_authority_guard_reuse_*.sql files contain the exact captured function and candidate. Run `npm install --ignore-scripts --no-audit --no-fund`, then `npm test` in this proposal directory. PGlite is isolated local PostgreSQL; no production credentials are used. Fifty checks compare exact original/candidate JSON and rejection behavior for valid/invalid identity, customer, placement, lifecycle, source, review, history integrity and duplicate inputs, both projection modes. These passed; they do not constitute complete production validation.

## Remaining gates

1. Independently review guard evaluation semantics, including native links, conflicting memberships, multiple valid history revisions and failure behavior.
2. Prove same-snapshot equivalence on current production-shaped data without increasing the live API timeout or bypassing authority checks.
3. Verify the complete candidate baseline and scheduled consumers fit the existing API budget, not just this inner query.
4. Build a fingerprint/ACL/owner/config guarded atomic migration and exact rollback; fresh-read deployed definitions to avoid concurrent Claude work.
5. Obtain existing-task release authorization through the coordinator before any production change. No new merge/deployment is included here.
6. After any authorized release, verify actual new successful inventory and completed Fleet/TV readings in the signed-in app. A test passing is not restored production refresh.

The separate address-job index/split-query proposal on deploy/unit-camera-status-function-20261112 is NOT this repair, remains uninstalled, and its cron job remains paused. Do not resume jobs or apply the obsolete STABLE jsonb index expression.

## Subsequent validation and second optimization

A bounded alternative verification succeeded: with nested-loop joins disabled only in the read-only diagnostic session, the original and candidate results were exactly equal for all 925 current records under the same unchanged 8-second limit. No global planner or timeout setting was changed.

The complete baseline still exceeded 8 seconds with the first candidate alone. A second SELECT diagnostic localized excess cost to the publisher-refresh guard filter. There were zero requests within the existing two-hour window, yet expensive link guard evaluation could precede this eligibility filter. The additional baseline candidate materializes eligible requests before evaluating their original guards. Original ordering, limit six, pending-cell exclusion, confirmed observation, active-placement exclusion and guard equality remain intact.

Combined composed baseline with both changes, normal planner, unchanged 8-second cap: 6785 ms; a separate bounded actual result returned 925 records / 2,860,415 bytes. Original/candidate current refresh selection equality also returned true (zero selected). These are read-only production-source checks, not deployed endpoint verification.

Local verification now passes 59 checks: original/candidate authority equivalence and rejection; refresh ordering/limit, expiration, pending cells, unconfirmed observations, current placement, changed guards; exact migration installation and rollback; atomic rejection of function-setting drift. The install/rollback files fingerprint both function bodies plus owner, ACL, security-definer flag and settings. They change no tables, grants, roles, cron jobs, provider settings, inventory or camera records. Lock wait is bounded at one second and statement timeout remains eight seconds.

Release is still pending. Guarded migration and rollback have only run in isolated PGlite. Require fresh fingerprints and current approval, then actual installed baseline timing plus a newly completed scheduled Fleet/TV reading. The 6.8-second composed measurement has limited margin, so observe the actual pipeline and roll back if evidence or output changes unexpectedly.

## Independent-review follow-through

The Shop-return helper is confirmed from its actual live definition as SQL STABLE, read-only. Its materialized evaluation is now restricted to exact wanted Products whose placement is SHOP; FIELD links cannot call it through this added expression. Native-link, competing-source, competing-input, newest-valid-history, tampered-newest-history and null-guard comparisons were added. All 71 local checks pass, including guarded install and rollback. Latest composed normal-planner full baseline: 6816 ms under the same 8-second cap. No deployment has occurred.

Existing browser CI failed before tests because ubuntu-latest selected26.04, unsupported by the repository's pinned Playwright1.51.1. Browser-install workflows are pinned to ubuntu-24.04 without weakening assertions, changing dependencies or touching app code. The new independent SQL workflow already passed on the first PR head; subsequent-head CI remains required.

## Released baseline and downstream recovery follow-through

PR388 merged as c19e7cb056f371a2c49fbc66cdb0362ff66d2505 after all 14 exact-head hosted workflows passed. The two-function guarded migration was installed November13 around04:48UTC. Actual installed baseline completed6532ms and returned925 records/2860415bytes; exact fingerprints, owners, ACLs and settings verified unchanged except intended function bodies. No cron, camera or provider changes.

The first scheduled inventory run after installation passed baseline and resource reads but failed at write/setup_read: `cos_mhelp_live_inventory_session` hit its existing30-second statement timeout05:07:19UTC. Fleet still fails closed on stale inventory. This is partial repair, not completed recovery.

The follow-through candidate changes only `recover_identity_evidence_records`: keep its original validation loop, wanted ordering and historical proof logic; aggregate directly accepted bindings once instead of repeatedly copying the growing JSON object. On current1001 records(925active+76missing), original helper exceeds8s in its first loop; the corresponding aggregate completes324ms. One bounded read-only snapshot comparison across41chunks of25records verified zero differences over all1001 actual records, source931fc2a6d10aa1465e7f7a7e46904dce2c05a995bd3a87672c54383c60ce2ad2. No timeout increase. Independent review found no semantic/security blocker. The helper candidate remains NOT INSTALLED pending exact-head tests and guarded release. Original history recovery/validation/rejection, JSON null semantics and permissions are preserved. Actual scheduled completion and live Fleet/TV freshness remain required acceptance gates.
