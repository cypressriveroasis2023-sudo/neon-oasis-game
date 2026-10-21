# Audited handoff correction delivery

This is a separate additive worker for the saved correction outbox. It never
calls checkout, receipt, cancellation, return or the original delivery queue.
Local tests use synthetic identities and mocked providers. They do not prove
that this function, its schema or its scheduler is deployed.

## Deployment contract requiring release approval

- Project: `goqrnolcvqnirjmzaeyk` (Cameras On Site).
- Function: `techcheck-correction-delivery`.
- Entrypoint: `supabase/functions/techcheck-correction-delivery/serve.ts`.
- Include `index.ts`, `report.ts`, `deno.json`, `package.json` from that directory,
  and its relative dependency `../service-daily-delivery/report.ts`. The latter
  supplies the existing trusted James address and HTML escaping helper.
- The proposed gateway configuration is `verify_jwt=false` to permit the
  existing server scheduler credential. This is a privileged authentication
  configuration change requiring explicit approval. The handler still requires
  either a bearer token verified by `auth.getUser` or the existing Vault secret
  verified by the server-only `service_daily_cron_authorized_v1` RPC. It never
  trusts an actor ID supplied in the request body.
- Existing runtime variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. Existing Google secret names:
  `TECHCHECK_GOOGLE_CLIENT_ID`, `TECHCHECK_GOOGLE_CLIENT_SECRET`,
  `TECHCHECK_GOOGLE_REFRESH_TOKEN`. No credential belongs in repository files.
- Apply the reviewed additive correction migration first. Its `enabled` and
  `reports_ready` gates begin false. Do not enable them before schema, worker,
  application, authorization and saved readback acceptance is approved.

`POST {"correction_id":"<saved UUID>"}` requests an authorized correction's
delivery. The queue independently verifies the actor and lease. The only
browser origins accepted are the existing COS GitHub Pages and integration
preview origins. Cron may post `{}` with `x-techcheck-cron` to claim one ready
record. The worker claims nothing until the original signed package has a
completed folder and PDF in the trusted original delivery manifest.

**No correction scheduler is installed by these source changes.** Existing
daily/transfer schedules call their existing endpoints and cannot retry this
new outbox. A separately approved scheduler candidate is
`techcheck-correction-delivery-v1`, every five minutes, calling
`https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/techcheck-correction-delivery`
with JSON `{}` and the existing Vault value named
`service_daily_delivery_cron_secret` in `x-techcheck-cron`. Use a 120-second
request timeout, matching the existing scheduler pattern. Do not print, copy or
rotate that secret as part of installation. Adding that schedule is a separate
privileged production change; source presence is not scheduling evidence.

## Archive and notification behavior

The original Drive folder ID from the server delivery manifest is the parent.
The worker adds one correction subfolder there; it does not move originals or
create a new technician/date hierarchy. This keeps the correction alongside the
original package under its original Central submission date, including records
whose stable folders were reorganized after submission. Future original-report
filing destinations remain a separate change.

The subfolder holds actual PDF, HTML, audit JSON and JPEG files. The correction
records the previous and corrected manifest, original technician, actual
applying actor, confirmation mode/time/recording actor, reason, technician reply
and cited source, original links and evidence links. The authoritative
`confirmation.recorded_by` UUID remains unchanged in JSON; display names resolve
only through the exact matching saved actor. Self-confirmation uses its saved
authenticated statement, without inventing an external reply or new signature.

A unit/tag pair may refer to the same photographed unit and same storage object.
It creates one Drive JPEG with both evidence slots and links retained in the
audit. Reusing a path for another equipment identity or duplicate kind is
rejected. Zero additional-part quantities and an empty SIM list retain their
recorded meaning without being labeled faults.

The fixed recipient and verified connected sender are
`jmartin@camerasonsite.com`, from the existing delivery configuration. There is
no CC/BCC or client-selected recipient. The Owner notification includes the
before/after values and full provenance. It explicitly records pending Service
acceptance at correction save. It never accepts equipment or changes custody.

## Retry and readback requirements

Drive-generated IDs are checkpointed before creation. Creation is additive;
completed files are read back on every retry. ID, parent, MIME type, app
properties, size and SHA256 must match. If Drive omits a SHA256 metadata field,
the actual saved media is downloaded and hashed. Object-key reordering by
Postgres JSONB does not cause false original-file changes. Signed original file
fingerprints are checked before and after archiving and against prior attempts.

The email `sending` marker is checkpointed before Gmail. A timeout or uncertain
send/checkpoint result moves the job to `review`; automatic resend stops.
Verify the deterministic Message-ID
`<handoff-correction-UUID@camerasonsite.com>` in James's account before an
authorized repair. A saved archive alone is not confirmed email delivery.

Release evidence must include the exact deployed source revision and auth
configuration, a saved correction's separate queue/audit readback, original
IDs/content readback, correction file IDs/hashes/parents, and confirmed email
ID. Synthetic provider tests alone do not satisfy that gate. The disputed real
handoff must remain unchanged until its technician confirms physical identity.

## Local verification

The 15 named provider/provenance tests include authorization, immutable originals,
shared photo evidence, concurrent claims, JSONB retry, saved-byte readback and
uncertain-email holds. In environments where isolated child tests report only a
file-level pass, use Node 22 with `--experimental-test-isolation=none` and verify
all scenario names/counts. Type-check `index.ts` and `report.ts` under strict
TypeScript. Synthetic PDF pages were rendered and visually inspected; no real
records, Drive originals or outgoing messages were used.
