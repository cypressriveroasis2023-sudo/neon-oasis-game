# Saved Owner intake status: pending-ticket enrichment

Local proposal only. This change does not install, activate or run intake, configure source mappings, deploy an Edge Function, or contact mHelpDesk.

## Compatibility and access

- Existing `GET /api/mhelpdesk/intake/status` still returns exactly the original `cos-mhelp-intake-review-v1` projection.
- The new UI explicitly requests the one supported query: `?capability=pending_schedule_v1`. The JSON-envelope transport accepts only that exact additional GET path. All other query keys, duplicate capabilities, payload fields, caller scopes and target URLs remain denied.
- The existing genuine legacy Owner and linked same-person production Owner gates remain unchanged. IT, Service, inactive, unlinked and unverifiable sessions cannot access either variant.
- The bridge forwards only the existing Owner bearer and `{action: "review_status", evidenceCapability: "pending_schedule_v1"}` to the fixed legacy intake endpoint. It never sends a service key, cron credential, caller-selected scope or provider request.
- The verified legacy Owner handler separately reads the existing `review_status` RPC action and new fixed `pending_status` RPC action. Cron cannot request the evidence capability or either review action.

## Opt-in response

The response has exactly `contract`, `review`, and `pendingSchedule`:

- `contract`: `cos-mhelp-intake-status-pending-v1`
- `review`: unchanged v1 saved review DTO
- `pendingSchedule`: the following exact DTO, or `null` if the independent saved pending evidence cannot be verified

Pending DTO fields:

- `contract`: `cos-mhelp-pending-status-v1`
- `waitingCount`, `dueCount`: safe integers in 0–100,000,000; due is a subset of waiting
- `oldestWaitingCreatedAt`: canonical UTC milliseconds, null exactly when waiting is zero
- `lastRefreshAt`: canonical UTC milliseconds or null
- `lastRefreshState`: null, `created`, `existing`, `review_needed`, or `deferred`
- `lastRefreshCode`: null, `SOURCE_UNAVAILABLE`, `SOURCE_INVALID`, `DEADLINE`, `CONFIGURATION`, or `INTERNAL`

No source IDs, ticket bodies, credentials or arbitrary diagnostic strings appear in pending evidence. Unknown fields/codes, invalid counts and malformed dates fail closed. The new fixed `source_identity_changed_review_required` receipt reason is accepted by the backend and client allowlists.

## Meaning and failure behavior

Waiting means an uncreated receipt has a scheduled automatic recheck, which can include incomplete scheduling, technician or source details or mappings. It is not proof of a scheduling-only delay. Waiting records can overlap v1 receipt holds, so the UI never adds/subtracts the counts or presents every hold as terminal human review. Identity-change holds remain explicitly reconciliation-required.

Discovery completion and pending refresh outcomes are shown separately. A pending refresh failure cannot be reported as complete intake health just because discovery committed. Missing pending evidence is unavailable, never zero. An older v1 response remains usable with the same explicit unavailable notice. A pending refresh outcome describes the last ticket rechecked, not every pending ticket.

Refresh reads saved evidence only: no provider read, source scan, retry execution, assignment mutation or scheduler write occurs. The existing busy, stale, navigation, background and unmount behavior applies to the whole displayed snapshot. An error clears both sections. The bridge bounds ignored-abort fetch/body reads, discards late responses, and never waits on potentially hung cancellation cleanup.

## Verification

Focused tests cover strict DTOs and redaction, legacy byte compatibility, linked Owner gating, exact request denials, separate pending failures, ignored abort and hung cancellation, and browser waiting/failed/unavailable/navigation interactions. Browser cases remain in the CI-selected `mhelp-intake-review.browser.spec.mjs`, using the shared iframe same-document history helper.

A local build may use `npm run build -- --outDir /tmp/cos-mhelp-pending-owner-status-dist` without changing committed `dist`. The status browser spec can use that build via `COS_STATUS_TEST_DIST=/tmp/cos-mhelp-pending-owner-status-dist`. Hosted CI runs its ordinary build and existing browser workflow. Local browser collection was stopped when it stalled; browser success is not established by the local build or unit tests.
