# IT assignment queue visibility

This local frontend change adds a separate **Your IT assignments and department queue** subsection to MHelp and a separately labeled count inside its existing IT Dashboard card. The original Ticket Lead reference RPC, list and count remain separate. A ticket can appear in both sections because they represent different scopes.

The host reuses only `my_available_assignments({p_role: 'it'})` with the current authenticated legacy Tech Check client. It preserves the existing verified IT fleet gate, additionally checks the matching active/unarchived profile, actual/effective IT role, no Owner preview and fresh session before reading and again before responding. There is no new API, database migration, grant, credential, service call or source-label authorization.

The existing RPC returns the signed-in technician's assigned/started IT rows and unclaimed assigned IT-department rows. Null `job_lead_user_id` therefore does not hide scheduled shells. Unexpected assignees, roles, statuses or malformed rows reject the complete snapshot rather than exposing a partial queue. Nothing in this view assigns a Ticket Lead, claims work, starts a ticket, selects a unit, fills verification or changes instructions.

## Narrow display contract

`COS_IT_ASSIGNMENTS_REQUEST` / `COS_IT_ASSIGNMENTS_RESPONSE` is distinct from the original Ticket Lead bridge. Responses contain `generatedAt` and rows with exactly:

- Assignment UUID as the row key (multiple assignments may share a ticket number)
- Ticket number, site, work type, recorded scheduled date/time and assignment status
- `mine` or `department`, derived from the exact current subject and RPC scope
- Recorded equipment label/quantity summaries and the existing operational unit summary

Limits: 5,000 rows; ticket 128 characters; site 500; work type 80; ISO calendar date 10; time 20; 100 equipment rows per assignment; label 160; quantity 1–1,000,000; unit summary 2,000 with original newlines/tabs preserved. Duplicate assignment IDs, invalid dates/times, inappropriate control characters, nested manifest data, links/markup in equipment labels and oversized values fail closed. The iframe reconstructs the same allowlisted fields independently. Raw instructions, notes, assignee IDs/names, payloads, financial fields and tokens do not cross this queue DTO.

An empty manifest says **Equipment not yet specified**. It does not mean equipment is unnecessary. No ticket is described as automatically imported based on its number, label or `assigned_by_name`. Existing Tech Check navigation is the sole route for reviewing original instructions and choosing equipment.

## Lifecycle and failure handling

References and assignments load, refresh and fail independently. The queue clears its old rows/count on refresh and leaves a visible unavailable state on error, rather than implying an empty queue. An older host times out with a request to refresh Tech Checks. The host bounds the whole read at 12 seconds; the iframe bounds its wait at 15 seconds. Pending reads can coalesce only for the same authenticated frame/workspace generation. Auth loss, account/profile changes, newer navigation, Close and replacement frames suppress late results. No settled cache, token persistence or write retry is added.

The protected legacy workflow files are unchanged. The two host script versions and regression fixtures are intentionally coordinated with the parent integration; source and projection cache-busting are required together. Production deployment and genuine technician data-flow verification remain outside this local change.

## Verification

Focused Node tests exercise the actual host source, bounded projection/bridge, dashboard source readers and React-rendered text. Browser regressions extend the actual authenticated host/IT Home fixture, use the shared same-document iframe-history helper, and cover own/dept/null-lead display, permissions, exact text, independent errors, old hosts, stale/navigation/Close/Back/Forward paths and read-only request assertions.

A passing Node suite/typecheck/build is not a hosted browser pass or evidence of live imported-ticket flow. Run the exact integrated commit through the existing hosted browser gate before release. No local browser bypass, push, deployment or production record write is part of this implementation.
