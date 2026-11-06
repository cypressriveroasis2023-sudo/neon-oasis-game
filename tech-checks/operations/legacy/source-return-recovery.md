# Source Return/Pickup recovery checkpoint

Reconstructed from retained design against published main `6ee65cc`. This is not byte-identical recovery, and prior test results are not used as new evidence.

Checkpoint 1 adds a source-only transport/lifecycle helper and 23 fresh synthetic Node tests. It captures the actual actor, logical session, active role/profile, original visible view and caller generation; checks fresh auth before and after transports; keeps immutable upload paths across lost acknowledgements; preserves raw NULL unit tags; and uses actor/assignment/return-scoped compare-and-swap journals. The staged Add Return helper checks fresh identity after remembered-unit reads before saving or publishing. Success has no automatic Home navigation.

This helper is not yet wired into protected routes and does not establish backend return authority. HTTP409 upload replay remains provisional until server-side current object validation. No protected files, database objects, public grants, ACLs, production records or notifications are changed by this checkpoint. SQL provenance, sealed Pickup-set confirmation and assigned IT per-unit admission are subsequent reviewed checkpoints.

Local verification: `node --test tech-checks/operations/tests/source-return-recovery-helper.test.mjs` passed 23/23. Browser and native database tests have not been run for this checkpoint.
