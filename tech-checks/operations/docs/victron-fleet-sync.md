# Automatic Victron fleet discovery

COS reads the installations available to the authorized VRM account every 15 minutes after secure setup. The workspace reads the saved registry each minute while visible. Refresh fleet requests immediate discovery, with a database lease and a 30-second minimum interval to avoid overlapping/rate-limited work.

## Identity and access

- Immutable VRM `idSite` is the registry key. Names may repeat or change; numeric Helios labels never establish equipment/camera/map identity.
- No equipment, customer, address, camera, or device association is created or modified.
- The existing Operations Owner gate remains in place. This feature grants neither IT nor Service access to VRM.
- Portal links require the user's Victron sign-in. Existing `COS_VRM_EMBEDS` approvals stay bound to their exact installation IDs. A newly discovered installation gets a portal link, never an automatically enabled sharing link.
- A successful complete response upserts ID/name and marks previously known but absent installations unavailable. It does not delete their history. Access failure, malformed responses, partial/paginated responses, duplicate IDs, account changes, storage failures, and timeouts preserve last-known data.
- A changed token must not import a different account into the saved fleet. The registry binds to a verified account. To intentionally replace that account, stop the schedule and perform a separately authorized registry migration; never clear this guard just to make a refresh pass.
- Offline telemetry does not remove a site from the account list. This integration does not infer online state or manufacture live power readings.

## Current official API

Use `X-Authorization: Token <personal access token>` server-side with:

1. `GET https://vrmapi.victronenergy.com/v2/users/me`, reading `user.id`.
2. `GET https://vrmapi.victronenergy.com/v2/users/{id}/installations`, reading `records[].idSite` and `name`.

No `idSite` filter is sent. Current OpenAPI describes a complete accessible installation list without pagination; unexpected continuation/partial indicators fail closed. Do not use the deprecated Bearer login/password flow. Fifteen minutes is COS's discovery schedule, not a Victron freshness SLA.

Primary references:
- https://vrm-api-docs.victronenergy.com/docs/docs/openapi.yaml
- https://vrm-api-docs.victronenergy.com/docs/Commands/User/docs/InfoMeCommand.yaml
- https://vrm-api-docs.victronenergy.com/docs/Commands/User/docs/InstallationsCommand.yaml
- https://vrm-api-docs.victronenergy.com/docs/Commands/User/docs/AccessTokenCommand.yaml
- https://supabase.com/docs/guides/functions/schedule-functions

## Secure setup and ordered release

1. Obtain action-time approval for ongoing VRM access and the scoped scheduler credential. Token creation or entry is a user secure handoff, never chat, source, logs, or a public issue. Victron's documented token schema does not establish a configurable read-only scope; do not promise one. COS itself only issues GET requests to Victron.
2. The user creates a named token in VRM Preferences → Integrations → Access tokens, then enters it directly into the target project's Edge Functions Secrets as `COS_VRM_ACCESS_TOKEN`. No manually entered account ID is required in Edge secrets. Do not view or copy its value.
3. Deploy the versioned dynamic route `/api/vrm-fleet` and its `/refresh` route alongside the unchanged legacy `/api/vrm-portal` nine-record response. Already-open old clients stay compatible. The new client falls back to the legacy response only on a 404 during staged rollout; authorization failures never trigger fallback. Publish and verify the new frontend before claiming users can see automatically discovered sites.
4. Apply `db/20261009182748_cos_vrm_fleet_registry.sql` to the existing COS Operations project. This creates only private VRM tables and service-role-only RPCs. The registry starts empty. Until the first successful discovery, the response preserves the previously published legacy portal links without inserting them as newly discovered records. No user fleet records or account IDs are stored in the migration.
5. Privately bind `cos_vrm_private.sync_state.source_user_id` to the account ID verified during the authorized VRM setup before the first discovery. Record deployment evidence privately; do not publish account IDs or new customer fleet records in migration fixtures.
6. Deploy the exact reviewed Operations VRM delta onto a fresh current backend bundle, preserving concurrent unrelated changes. Both `index.ts` and `serve.ts` wire `getAccessToken`. Deploy `cos-vrm-fleet-sync` with `serve.ts` as entrypoint and its relative dependencies. Platform JWT validation is disabled only because this endpoint requires its own scoped scheduler credential and a service-only Vault validation RPC. The main bridge keeps its existing custom authentication unchanged.
7. As the signed-in Owner, use Refresh fleet. Verify successful account access, expected immutable IDs, safe new portal links, unchanged approved embeds, and no data in unrelated systems. The response exposes only a token-presence boolean, never the token.
8. Only after a successful discovery within the last five minutes, apply `db/cos-vrm-schedule-enable.sql`. It generates the approved random scheduler credential entirely inside encrypted Supabase Vault without returning it, enables `pg_cron`/`pg_net`, and installs `cos-vrm-fleet-discovery` at `*/15 * * * *`. No broad Supabase service key is copied to Vault. The credential can invoke this single discovery function only.
9. Verify the actual cron job, invoke its exact enqueue function once, inspect safe status/response metadata, and observe the next real scheduled success. Do not claim the schedule is active merely because code was deployed. Token presence is not proof of successful provider authorization.

The job reads its credential inside the server. Never select `decrypted_secret`, HTTP request headers, or pending queue rows into assistant/tool logs. A boolean validation RPC and sanitized state are sufficient. The scheduler response contains only `ok`, `state`, and `lastSuccessAt`.

## Failure handling and rollback

Provider calls have bounded bodies and per-call timeouts, reject redirects, and discard raw errors. `Retry-After` is honored with bounded delay. A 60-second database lease and compare-and-swap completion prevent stale workers from overwriting newer snapshots. Manual and scheduled calls share that lease. The UI shows last-success time, delayed/error state and actual schedule status.

Apply `db/cos-vrm-schedule-disable.sql` to stop future scheduling reversibly while retaining all last-known installations and approved portal links. Remove the user-supplied Edge token through secure secret controls if ongoing access is revoked. Do not erase the registry just to roll back code. The dynamic frontend remains compatible with legacy bootstrap responses if backend rollback is needed; preserve the exact pre-release backend bundle privately.

Tests use synthetic credentials and records. Database tests exercise the full registry SQL in PGlite; scheduler-extension stubs are labeled and do not prove a live cron delivery. Final production verification must use actual project cron metadata and a successfully authenticated server discovery.
