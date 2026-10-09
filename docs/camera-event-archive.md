# Camera event storage

Recon alarm and routine-event payloads can include large inline photo arrays in `binary`. These are preserved as complete, compressed JSON in the private `camera-event-archives` Storage bucket. Existing event columns and all non-binary payload fields stay in Postgres, including device/area identity, battery readings, detections, event GUID and vendor event link.

The server uploads an immutable content-addressed object, downloads it, decompresses it within an 8 MiB limit and verifies its SHA-256 digest before replacing inline binary with `cos_private_archive`. Failed upload, readback, digest or bucket privacy checks retain the complete original payload. No public URLs, user grants, new credentials, record deletions, history retention changes or health-status changes are introduced.

`restoreReconPayload` restores the complete original event from its marker using the existing server client. Archives are never overwritten or automatically deleted. Future webhook processing uses the same archival path; a Storage outage preserves inline payloads and continues the existing health event flow.

The historical maintenance handler accepts 1–25 numeric event IDs, authenticates the existing camera cron secret before reading and bounds four workers to a 48-second window. Small batches limit large Postgres responses on the existing compute tier. The reviewed SQL in `tech-checks/database-maintenance/archive-recon-event-payloads.sql` supplies a service-only compare-and-set operation: it requires an existing private object, unchanged complete original payload and exactly unchanged non-binary metadata. Concurrent changes are held for retry.

Apply that SQL only to the existing Camera Health project. Deploy `camera-event-archive/serve.ts` plus its relative modules and the updated `reconeyez-webhook`, preserving existing webhook authentication. Historical backfill requests use the existing vault-held camera cron credential through `pg_net`; no credential enters repository files, job outputs or the browser.
