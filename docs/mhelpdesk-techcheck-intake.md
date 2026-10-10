# mHelpDesk ticket intake into Tech Check

## Status and target

The existing mHelpDesk connection and protected token-renewal implementation are reused. No credentials, grants, technician identities or vendor write operations are added. This change starts with a protected, read-only ticket contract preview and a pure routing planner. It does **not** enable automatic intake or create production assignments.

The actionable Tech Check destination is the original IT / Service application (`goqrnolcvqnirjmzaeyk`), whose Owner assignment UI calls `owner_assign_job_bundle_v1(p_request)`. Native Operations jobs/visits in the separate Tech Check Platform are not a replacement for those actionable checks. Do not create parallel native jobs as an intake shortcut.

Targeted production metadata reads on October 10, 2026 verified the bundle RPC and its v8 → v7 → v6 assignment chain, assignment defaults/triggers, and the Ticket Lead read path. The bundle is an Owner-only transaction with a ticket-number advisory lock. Its reuse rule covers matching active assignments only; it is not a durable source-identity receipt. A future atomic adapter still needs separate implementation and testing before any production intake.

### Verified legacy adapter constraints

- The bundle requires a real active, unarchived Owner session. Assigned technicians must be active, unarchived members of the requested IT or Service department; null means the existing department queue. A scheduled worker must not fabricate an Owner session or call a claim RPC to satisfy this gate.
- Reuse keys include the current assignee. Replaying a queue request after a technician claims it can create a new queue; completed/cancelled history can also be recreated. Reused rows skip the inner assignment function's current identity validation. Revalidate identities and keep a durable `(portalId,ticketId)` receipt in the same transaction as every created assignment.
- The inner assignment function enqueues app notifications, and returned push IDs may include reused assignments. The adapter must suppress replay notifications rather than resend every returned ID.
- Ticket Lead columns default to null, and neither the bundle, its triggers nor department claim sets them. `my_managed_tickets_v1` includes only assignments led by the signed-in IT user. A separately verified existing IT lead must therefore be selected deliberately if intake is to appear in that user's MHelp view. Never guess a lead or auto-claim work: claiming immediately sets local status to `started`.

## Read-only preview contract

The deployed `cos-mhelp-readiness` maintenance extension retains the existing Camera Health cron verification gate. It has no new unauthenticated route. No permitted existing authenticated invocation was available, so the prepared ordinary Owner app action below is the selected user-facing check; do not construct secret-bearing headers or widen the maintenance gate.

Request:

- `action`: `ticket_preview`
- `createdAfter`: explicit UTC timestamp
- `createdBefore`: explicit UTC timestamp
- Creation window must be positive and at most 31 days. Both vendor bounds are strict (`>` start, `<` end), as documented.

The server uses its existing token manager, confirms `/users/me` portal identity, then reads the fixed portal's `/tickettypes`, `/ticketstatus` and `/Tickets` endpoints. Ticket results use `{totalRows,data}`; equipment's `{totalRows,results}` is not a ticket contract. Requests use 50-row pages, at most 500 tickets, a shared 20-second ticket-request deadline and bounded response bytes. Unknown/overlapping/incomplete pages and changed totals fail closed. A single renewal on account-read HTTP 401 uses the existing token store. Token renewal retains its separate existing 45-second deadline and atomic persistence, so a preview that needs renewal can take longer than 20 seconds. Vendor errors and tokens never enter responses or logs.

The result exposes only verified portal ID, read time, bounded creation window, counts, type/status dictionaries and missing/unknown-field metrics. It does not expose ticket IDs, source assignments, ticket text, customers, contacts, billing fields or credentials. Dictionary labels are source values and do not by themselves authorize a workflow mapping.

For the first authorized preview, use the user's local current day; on October 9, 2026 in America/Chicago, the lower bound is October 9 at 05:00 UTC. Never substitute UTC midnight for a known local day.

## Prepared Owner app action

The alternate real app action is `POST /api/mhelpdesk/partner/tickets/preview` with an empty JSON object. It uses the existing active, linked Owner authentication and existing server token manager. IT, Service, unmapped Owners and inactive/revoked sessions are denied before connector configuration is read. No role mapping, grant or authentication mechanism is changed.

The server chooses today's America/Chicago midnight and the current time. Callers cannot supply dates, vendor URLs, credentials, portal IDs, actors or activation options. The UI button makes one ordinary `api.post` request through the signed-in parent app; it does not expose or manually retrieve credentials. The result is revalidated against the aggregate-only client contract. A failed refresh clears the previous counts; leaving the workspace discards an unfinished result.

Failed Owner previews return an allowlisted `MHELP_PREVIEW_*` reference code and show a fixed, actionable explanation. The same failure emits one structured `mhelp_ticket_preview_failed` log containing only the code, local HTTP status, and (when verified) one of four fixed provider operations and a numeric provider HTTP status. Unknown exceptions use `INTERNAL_FAILURE`. Error messages, stacks, URLs, headers, credentials, identities, ticket bodies and source response data are never logged or forwarded by this diagnostic path. Authentication and request-field rejection still happen before the preview and its diagnostic logger. These diagnostics do not relax any source validation or enable automatic retries or intake.

After this action is approved and published, use the existing Owner account: **Unit Tracker → mHelpDesk connection → Preview today’s ticket types**. A verified signed-in Owner browser session is required for the live check. The prepared Owner action is not part of the deployed maintenance v20 bundle, and must not be described as live before its separate coordinated rollout. Preserve every file of the current Operations bridge when adding the route. Keep only the selected production invocation path; do not widen maintenance authentication as a workaround.

## Legacy workflow mapping

Use reviewed numeric mHelp type IDs for routing. The expected four user-facing categories are:

- Service: Service checks; add IT preparation only when the source explicitly requires shop equipment or supported parts.
- Install: existing `delivery` mode; IT preparation followed by Service installation, with the existing handoff gate.
- Swap: existing `swap` mode; IT preparation, Service swap, then the existing returns-driven IT Intake.
- Pickup: existing `pickup` mode; Service pickup followed by IT Intake, with the original returned-equipment gate.

The current legacy UI chooses the flow from the work type, full equipment manifest and supported part quantities. An omitted equipment list is unknown scope, not proof that Service needs no preparation. Unknown types, unsupported equipment, incomplete quantities, missing schedule/site facts and ambiguous people must remain visible for review.

Preserve mHelp status and assignment facts separately from local progress. Do not turn an external Closed or Completed status into completed checklists, evidence, accepted inventory or Owner approval. Match technicians only through reviewed exact vendor-to-existing-Tech-Check identities, never by display-name similarity. Source-explicit unassigned work may use the corresponding existing department queue; missing assignee fields do not establish that it is unassigned. Later manual local edits have precedence.

## Activation design (not enabled)

Activation requires a reviewed exact type/identity mapping and a verified legacy atomic adapter. The proposed forward-only start is the user-approved activation UTC instant. Do not import historical tickets without separate authorization.

Use one stable receipt key per `(portalId,ticketId)`, retain the distinct printed ticket number, and check existing local ticket history before creating any work. Creation of all first-stage assignments and the receipt must occur in one transaction under a per-source lock. Retries return the existing receipt; changed source content on an existing ticket is reviewed rather than overwriting assignments or progress.

Proposed polling cadence is every five minutes, subject to verified vendor limits. Poll a bounded overlapping creation interval (strict vendor bounds require overlap), record the successful watermark only after the entire page set and all receipts are durable, and never advance it on partial/error responses. Cap each batch and use a lease so scheduled runs cannot overlap. Respect HTTP 429/backoff and retry transient reads with the same window. Uncertain writes require receipt readback, not blind replay. A disabled switch stops new intake without removing created work. No polling schedule, credential or database change is included in this stage.

## Verification

Synthetic reader tests cover actual documented endpoints/envelopes, portal mismatch, missing fields, timezone validation, page base, duplicate/repeated pages, changed totals, count/byte limits, timeout/error sanitization, credential renewal and aggregate output projection. The maintenance tests verify authentication occurs before configuration reads and reject caller credentials, URLs, identities and unbounded windows. Routing planner tests use test-only inputs and do not create production tickets.

These checks do not establish live ticket-schema compatibility or actionable technician assignment success. Those are separately recorded rollout gates, including real read-only preview and a non-mutating/local proof of the existing legacy bundle behavior before activation.

## Primary API documentation

- [Tickets](https://www.mhelpdesk.com/partner-api/ticket.html)
- [Ticket types](https://www.mhelpdesk.com/partner-api/ticket-type.html)
- [Ticket statuses](https://www.mhelpdesk.com/partner-api/ticket-status.html)
- [Ticket model](https://www.mhelpdesk.com/partner-api/models.html#model-ticket-get-object)
- [Request formats](https://www.mhelpdesk.com/partner-api/request-formats.html)

## Structural failure evidence

When strict parsing fails, the existing diagnostic log may include only fixed expected-field kinds and string-format categories, bounded total/array counts, and at most 50 sampled rows per already-authorized endpoint. No source values, row identities, arbitrary field names, labels, request details or credentials are logged. The account is verified before the same bounded type/status/first-ticket-page GETs; strict validation and all byte/time/count bounds remain in force. This evidence distinguishes a different response envelope from a truncated dictionary without guessing an adapter change. It is diagnostic evidence, never successful intake or complete ticket counts.

The Owner panel separately offers the prior Central Time calendar day for explicit read-only schema review after midnight. Only `{day:'previous'}` is accepted; arbitrary dates and other modes are rejected before vendor access. Today's existing empty-body contract is unchanged. Returned timestamps disclose the actual window, and both buttons share one in-flight guard. Neither choice imports tickets.
