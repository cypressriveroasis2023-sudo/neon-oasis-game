# Phase 2 backend linkage and verification

This branch extends the existing COS bridge without creating accounts, changing roles or database policies, copying assignments, or altering the legacy IT Tech Check and Service Tech Check.

The bridge uses the existing legacy bearer token only with the legacy Auth `/user` endpoint and the same user's `profiles` row. Server-side fixed UUID mappings select an existing same-person production actor. The active legacy role, unarchived profile, active production department, native role code, and organization are checked on each request. Caller-supplied actor or organization fields are rejected. Origin is restricted to the GitHub Pages origin; bearer authentication remains necessary even when no Origin header is supplied. The production service key remains server-side.

## Existing identities

The existing James Martin owner mapping remains unchanged. Mike Monsive and Jacob Perret have no verified same-person production Auth/profile/Owner-role identity. The native actor helper explicitly requires an existing Auth user joined to an active production profile, so inserting a foreign UUID in public profiles would not create a valid linkage. No identity or permissions were provisioned. Unlinked owners receive an honest linkage reason and can keep using their existing Tech Check tools.

Four technician mappings use pre-existing legacy and production identities: Teddy Hopper (IT), Victor Garcia (IT), Abel Cervantes (Service), and Josh Mireles (Service). Inspection found unique matching auth display/full names, username/email local parts and native technician departments/roles. The platform technician email domain differs from legacy contact email. Contact email is mutable and is not used for automatic authorization. Exact UUID pairs are fixed in source; both current names, departments and native roles are checked at runtime.

## Added endpoints

Owner-only reads include Handoffs, Customers, Equipment, Work Requests, Team and native Quote/Invoice/Purchase detail. Owner jobs additionally expose the native assigned technician UUID, scoped by visit and organization.

Owner-only writes use the existing native Customer, Site and Equipment save RPCs and native Quote, Invoice, Owner PO and AP decision RPCs. All accept explicit field allowlists and scoped record IDs. Sites require an existing own-organization customer; equipment requires an existing own-organization model. Payments, email, document sending and unsupported writes are not exposed. Native RPC business rules remain authoritative.

Actual technicians can use read-only `/api/tech/session`, `/my-day`, `/tasks`, `/assignments`, and `/visits/:id`. Assignments are restricted to their own active technician assignment and the same organization. They include all dates so future assignments remain visible even when today's queue is empty. Visit detail first requires that own active assignment, and its native workflow detail must belong to the requested visit. Internal workflow validation/evidence schemas are removed from the response. Owners cannot borrow the technician queue, and technicians cannot call owner reads or writes. Technician POST requests are rejected.

## Verification and limits

The accompanying JSON receipt reports exact outcomes and limits. The SQL script uses actual existing records and existing native RPCs. Every successful mutable check runs in a nested subtransaction and intentionally raises the rollback exception. Fresh native snapshots verify changed values inside that subtransaction; after rollback the complete selected record plus related audit/location artifacts must match their original JSON. Nothing is left as a demo or test record.

Passed positive native checks: Owner PO approve and return; existing Customer, Site and Equipment edit followed by independent native snapshots. Complete records and related audit/location history were restored.

Passed native eligibility guards: quote approve/return with missing pending approval artifact, already issued invoice approve/issue replay, unmatched AP approve/return. These are real production blockers, not permission workarounds. Both existing review quotes lack their current-version pending Owner approval row. The sole Draft quote has priced lines but no site. No eligible draft/review invoice or matched Ready for AP Approval purchase packet existed at verification time, so positive checks for those paths remain unavailable. Eligibility was not manufactured.

Native reads passed for all four real technician actors. One actual own assigned workflow was readable; a workflow belonging to a different technician returned an empty native detail. Complete assignment, profile and role tables remained unchanged. The receipt contains counts, not customer or task contents.

All 85 authentication and contract cases passed with injected remote transports in tests only. `index_test.js` is the Deno form; `operations/tests/backend.test.mjs` runs the same cases in Node CI and imports the actual exported edge handler.

These SQL/native checks and transport tests do not prove a real signed-in browser save survives a full page refresh. No production user bearer token was minted, borrowed, requested or logged. A real authorized user can finish that proof by signing in normally in their own browser, loading real data, making an intended low-impact edit, confirming a fresh GET contains the saved ID and values, then reloading the whole page and confirming the same record. If a save response or refresh is uncertain, the interface must retain the error and require an explicit fresh load before another mutation; it must not report fabricated success or automatically repeat the write.

No edge deployment or main branch update was performed for this phase.
