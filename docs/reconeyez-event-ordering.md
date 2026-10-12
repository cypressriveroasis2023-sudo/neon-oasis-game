# Reconeyez ordered event projection

The webhook retains every arrival before projecting camera state through one atomic, per-camera-serialized function. Older provider observations cannot replace newer current state. Exact duplicate deliveries are retained without repeated history, failure counts, or notification effects. Different same-time reports with conflicting health status produce Unknown and preserve the original evidence until a strictly newer observation arrives. Missing, invalid, or future observation times remain unverified. Database processing failures return HTTP 503 so the sender can retry.

This change preserves existing event mappings, authentication, notification triggers, and direct-endpoint proof. It does not infer a heartbeat interval, infer offline from silence, replay old events, or change cadence presentation. A stale explicit loss report remains evidence with its original timestamp.

## Deployment and rollback

The canonical SQL is `tech-checks/database-maintenance/reconeyez-event-ordering.sql`. This follows the existing camera-event archival maintenance route; the frozen historical migrations directory and CI guard remain unchanged. Apply the exact SQL as a named Supabase migration only to the existing Camera Health database after the hosted PostgreSQL 17.6 tests and independent permission review pass. Before application, confirm the function is absent or has only the reviewed owner/service-role grants. Record the migration version/name, SQL SHA-256, source commit, full ACL readback, and deployed webhook version in deployment evidence.

The function is SECURITY INVOKER with an empty search path. Revoke execution from PUBLIC, anon, and authenticated; grant execution only to the existing service_role. There are no new table grants, credentials, RLS changes, or notification changes. Verify the full ACL after applying and confirm anon/authenticated cannot execute it.

Deploy only `reconeyez-webhook` after checking its current source still matches the reviewed baseline. Preserve its current authentication mode and unchanged shared archive dependency. Verify the deployed source and genuine event arrivals. Do not insert synthetic production events. If verification reveals a regression, restore the recorded prior webhook source and authentication settings; retain event history. The unused function can remain service-only during investigation.

## Tests

The isolated `verify-recon-ordering` CI job uses the official PostgreSQL 17.6 service with synthetic data and a read-only GitHub token. It runs 10 Edge handler checks, 48 real-database assertions including role denial and transaction rollback, and four real multi-client locking tests. It prints the server version and asserts `server_version_num=170006`. Database scripts refuse non-loopback hosts and non-test database names. CI asserts its SQL fixture is byte-identical to the canonical maintenance SQL.

Equal-time reports with the same status preserve the first projected telemetry; no measurement order is invented. The notification trigger is unchanged: a transition through Unknown does not invent an outage or recovery notification.

The original COS Operations verification job and immutable baseline guard remain unchanged. No production records, customer identifiers, or secrets are included in the fixtures.
