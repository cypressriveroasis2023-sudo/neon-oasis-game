# Audited handoff corrections — release review

## Status and scope

This is the reconstructed, tested continuation of the interrupted correction
task `01a15f72-aad2-7737-a3cd-f6e618d81015`. Recovery found its task transcript,
but not its source branch, commit or patch. The user subsequently authorized
reconstruction. The candidate starts at main commit
`6ed563f6c7fd75ed4ea7c72a8765ffc4f8324852` and preserves the existing Owner import
and IT lifecycle work. Source presence and passing local tests are not evidence
of production deployment.

The correction applies only to an `awaiting_service` handoff with no receipt,
return, cancellation or other post-checkout event. It updates that handoff's
pending manifest, revision and reserved equipment in one transaction. It does
not receive equipment, add truck stock, imply a return or change availability
through the older truck-adjustment function.

## User flow

- Original submitting IT technician: open the submitted handoff and choose
  **Correct this handoff**. The actual IT phone and desktop hosts expose the
  correction desk. Desktop also has **Handoff corrections** above its existing
  Fleet content.
- Owner: **Operations → Tech Checks → Check handoffs & returns**. On another
  technician's pending handoff, choose **Apply technician-confirmed correction**.
  Verified IT may apply the same cited-evidence process when authorized by the
  server. Preview personas cannot write.
- Enter exact registered equipment identity, battery/parts/SIM details, a new
  matching unit/tag photograph, the reason and explicit confirmation. Cited
  confirmation additionally requires the original technician's documented
  reply, its Central time and the stable evidence link. The actual applying
  actor remains separate from the confirming technician.
- The original signed event, answers, signature, photos and delivery manifest
  remain unchanged. The revision contains before/after values, confirmation
  provenance, the applying actor and server timestamps. No replacement signature
  is solicited or invented.
- Saving uses a frozen idempotent request and verifies a separate saved
  readback before reporting success. A lost response remains retryable with the
  same request. Stale revisions and duplicate/conflicting equipment reservations
  are rejected.
- Service sees the corrected pending manifest and its history. An older unsent
  receipt draft can be explicitly discarded to review the latest revision.
  Actual receipt observations start blank. A request with an uncertain outcome
  is retained for exact retry; it is not silently discarded.

Blank SIM lists are allowed. Service obtains SIM cards separately from James;
a requested Simetry change belongs in the mHelp service ticket.

## Security changes requiring explicit release approval

The user specifically required approval for privileged/security changes.
Preparing and testing these files does not authorize installing them.

1. **Database migration:**
   `database-maintenance/techcheck-handoff-corrections-v1.sql`. Adds private,
   RLS-protected correction settings, immutable corrections/audit and delivery
   outbox tables; narrow context/submit RPCs for authenticated actors; a
   service-only delivery RPC; and an extension of the existing evidence-path
   helper. Public wrappers use the checked private implementations. Direct
   table writes remain unavailable to application users. The existing evidence
   bucket receives no new UPDATE or DELETE policy. New `enabled` and
   `reports_ready` gates start false.
2. **New Edge Function:** `techcheck-correction-delivery`, using `serve.ts`
   and the reviewed dependencies. Its proposed gateway setting is
   `verify_jwt=false` so the existing scheduler can call it. The handler itself
   requires either a bearer token verified with `auth.getUser` or the existing
   server-only Vault cron credential; the queue separately checks authorization
   and its lease. No client-supplied actor or recipient is trusted.
3. **Scheduler:**
   `database-maintenance/techcheck-correction-delivery-schedule-v1.sql`, job
   `techcheck-correction-delivery-v1`, every five minutes. It uses the existing
   `service_daily_delivery_cron_secret` without exposing or rotating it.
4. **Activation:** enable the new correction gates only after the approved
   schema, worker, frontend and connection/readback checks are verified. No
   release operation may amend the disputed handoff without its technician's
   physical identity confirmation and matching photograph.
5. **Ongoing filing:** `database-maintenance/techcheck-archive-routing-v1.sql`
   adds three private tables, immutable folder reservations and a service-only
   routing RPC bound to existing queue leases. Exact verified technician UUIDs
   map to the existing folders. Redeploy the two original delivery workers with
   the shared resolver, then explicitly enable its initially disabled routing
   gate. This adds no new schedule, secret, sharing rule or recipient. See
   [technician archive routing](technician-archive-routing.md).

The correction evidence-path predicate and event request-ID guard take effect
when the migration is installed, even while the new correction gates are false.
The scheduler script registers an active five-minute job; its queue claims no
work while the gates are false. These are part of the explicit approval scope.

The target is project `goqrnolcvqnirjmzaeyk` and the existing COS GitHub Pages
application. There is no new application, project, account, sharing policy or
technician email distribution list.

## Archive and notification

The new worker adds actual PDF, HTML, audit JSON and JPEG files in a correction
subfolder of the original package's saved Drive folder ID. It preserves the
original folder even if that folder was moved into the technician/date layout.
It verifies original-file fingerprints and saved correction file bytes and
parents. It reserves provider IDs before creating files, and preserves an
uncertain email result for review rather than sending again automatically.

James alone receives the correction notification at the trusted existing
configured address. It includes original/corrected details, actor/confirmation
provenance and original/correction evidence links. The feature sends no
technician follow-up. See [delivery contract](handoff-correction-delivery.md)
for the exact deployment, retry and saved-readback requirements.

## Verified local acceptance

The candidate was checked with Node 22.23.3 and isolated synthetic accounts,
equipment, storage and provider responses. No live correction, acceptance,
inventory update, Drive upload or email was performed by these tests.

| Gate | Result |
| --- | --- |
| Correction client/model | 7 named tests passed |
| Correction SQL and authorization | 18 named tests passed |
| Correction archive/provider/provenance | 15 named tests passed |
| Real PostgreSQL 17.11 overlapping transactions | 5 passed, zero skipped |
| Existing focused unit regressions | 77 named tests passed |
| Correction phone/desktop browser acceptance | 17 passed, zero skipped/flaky |
| Existing transfer, Service and IT browser regressions | 77 passed |
| Existing application TypeScript and production build | Passed |
| New worker strict TypeScript; synthetic PDF render review | Passed |
| New archive routing/provider checks | 15 named tests passed |
| Archive routing SQL | 10 passed, including verified seed preflight and two actual PostgreSQL overlap proofs |
| All three Edge `serve.ts` entrypoints, actual Deno-aware check | Passed |

The PostgreSQL gate observes distinct backend PIDs and actual blocking before
commit. It covers competing corrections, correction versus receipt in both
orders, competing reservations and exact parallel replay. Existing synthetic
truck contents and signed originals remain unchanged.

Browser acceptance uses the actual COS entry markup, hosts and correction
modules with requests intercepted into disposable PGlite databases. It verifies
390px and 1440px layouts, actual navigation, same-account refresh, account
switching, offline/lost-response retry, saved provenance and photo bindings,
immutable originals, and pending Service behavior. PGlite alone does not prove
multi-session PostgreSQL locking; the separate gate supplies that proof.

Reproduce from `tech-checks/operations` with Node 22:

```sh
node --import tsx --test --experimental-test-isolation=none --test-concurrency=1 tests/transfer-correction-client.test.mjs tests/transfer-correction-sql.test.mjs tests/transfer-correction-delivery.test.mjs
npx playwright test --config tests/playwright.corrections.config.mjs
npx playwright test --config tests/playwright.transfer.config.mjs
npm run typecheck
npm run build
```

For concurrency, use a dedicated disposable PostgreSQL 17 service and the
explicit `COS_CORRECTION_POSTGRES_*` settings in the transfer-review workflow.
That workflow requires the gate rather than allowing a skipped concurrency
test. Never point the fixture at a production project. Check named test counts;
a file-level test-runner exit alone is insufficient.

## Production release evidence still required

After explicit security approval, record the installed migration/source hash,
worker version and auth configuration, frontend deployment commit and successful
GitHub Pages deployment, scheduler job and gate values. Check actual authorized
Owner/IT/Service context responses and unauthorized/preview denial. Verify the
Edge worker's actual Google account and archive access without sending a test
message or modifying the disputed record.

The first authorized saved correction additionally needs its separate revision,
audit, reservation and outbox readbacks; unchanged original fingerprints;
actual correction folder/file IDs, parent IDs and byte hashes; and confirmed
James notification ID. Local synthetic evidence is not a substitute for this
production saved-readback proof. If no real correction has been authorized,
report that production save/delivery proof is still pending.

Rollback is to disable the new gates and scheduler and restore the previous
frontend/worker version if necessary. Do not delete correction/audit records,
rewrite originals, replay ambiguous email sends or reset accepted handoffs.

## Explicit remaining workflow boundaries

Read-only source/data-flow review confirms that the installed named receipt
function records acceptance/discrepancy and signed receipt snapshots, but does
not populate the inspected permanent truck-inventory tables. Installation/site,
swap, partial-return and physical-check-in continuity are not established by
this amendment feature. Existing independent ticket-free workflows do not
bridge every named reservation. Preserve these gaps explicitly; never use the
older truck adjustment operation to imply a physical return.

The reviewed original transfer and Service daily-report producers now use the
shared technician/date/category resolver for new packages. Existing moved
packages keep their IDs and current parents; concurrent jobs converge on one
reserved date/category identity. This routing source is not deployed yet and
still requires approval and actual Edge Google
access/readback. The correction worker follows the original's stable folder ID.
IT Checks and ticket-free returns have no general Drive producer located in the
audited modules. Do not claim those ongoing filing paths are complete from the
earlier reorganization or this two-worker routing update alone.

## Disputed real record

`a314aad4-8129-4c51-b4c3-59539955ab13` remains Teddy Hopper → Josh Mireles,
`awaiting_service`, revision 1, with no receipt. Manifest 039 versus reported
photo tag 41 remains unresolved. The original package and its stable links are
preserved. There is no authorized value to write until Teddy supplies physically
verified identity and a matching photo. The revised clarification email remains
unsent pending James's review.
