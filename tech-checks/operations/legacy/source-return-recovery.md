# Source Return/Pickup recovery checkpoint

Reconstructed from retained design against published main `6ee65cc`. This is not byte-identical recovery, and prior test results are not used as new evidence.

Checkpoint 1 adds a source-only transport/lifecycle helper and 23 fresh synthetic Node tests. It captures the actual actor, logical session, active role/profile, original visible view and caller generation; checks fresh auth before and after transports; keeps immutable upload paths across lost acknowledgements; preserves raw NULL unit tags; and uses actor/assignment/return-scoped compare-and-swap journals. The staged Add Return helper checks fresh identity after remembered-unit reads before saving or publishing. Success has no automatic Home navigation.

This helper is not yet wired into protected routes and does not establish backend return authority. HTTP409 upload replay remains provisional until server-side current object validation. No protected files, database objects, public grants, ACLs, production records or notifications are changed by this checkpoint. SQL provenance, sealed Pickup-set confirmation and assigned IT per-unit admission are subsequent reviewed checkpoints.

Local verification: `node --test tech-checks/operations/tests/source-return-recovery-helper.test.mjs` passed 23/23. Browser and native database tests have not been run for this checkpoint.

Checkpoint 2 reconstructs the private immutable physical-return binding table and revoked `source_return_set_v1(work_order,lock)` proof reader, using the new foundation's non-crew source-scope and installation-scope revisions. Historical contributor withdrawal does not erase valid physical proof. Manual same-ticket rows never enter the proof set. Identity edits/deletion, object replacement/deletion and scope changes make proof stale. Current storage lookup uses the verified unique current-version index and ignores archived versions at the same path. Intake status is returned separately from immutable return proof.

The second helper revision bounds JWT/JSON input, invalidates same-task hide/restore and detach/reinsert from observer records, and rehashes captured immutable files against each saved exact upload intent before transmission. Fresh verification passed 46/46 synthetic Node/PGlite cases (27 helper,19 proof). The proof fixture explicitly inserts creation bindings to test the private reader; public creation authorization is not yet implemented or claimed. No new public function/grants are included. Native concurrency and browser gates remain pending.
