# Vision integration preview — 2026-10-04

Base: main 08fcefc (Build verified COS Operations static bundle).
Branch: codex/vision-owner-preview. The existing checkout had a modified backend test file; this work uses a separate worktree and leaves it untouched.

## Implemented against existing Operations code

- Opt-in Vision owner shell (`?theme=vision`, or **Try Vision layout**) with the approved eye wordmark, red/navy/black/white styling, Central Time clock, and responsive navigation.
- Five primary groups: Today, Jobs, Team, Units, Money. Each exposes existing native workspace destinations. All older tools remain available through Options. Classic layout is the default and can be restored without signing out.
- Today uses the existing authenticated dashboard reads and shows scheduling and review decisions. Unavailable sources remain unavailable, not zero. Quote decisions open Quotes.
- Existing Jobs, scheduling (including start/end), dispatch, Owner Review/corrections, Calendar, equipment, GPS, team, quotes, invoices and purchasing retain their API/readback behavior.
- Job search and status filters operate on fetched native records. Scheduling shows planned duration without converting it to billable hours.
- No changes to API transport, parent-token authentication, account linking, role checks, database schemas, technician assignments, legacy IT/Service applications, or production data.

## Preview access and boundaries

Use this branch's built bundle **inside its existing Tech Check parent** and select Try Vision layout. The `theme=vision` query can also be passed to the Operations iframe. Standalone navigation intentionally cannot obtain an owner token. Do not bypass that restriction to make an unrelated preview origin appear connected.

The private ChatGPT Site is still the approved **sample-data design demo**. It is not a live-data deployment of this branch. This PR has not been merged or deployed over production.

## Prioritized remaining gaps

1. **Signed-in validation on the actual platform origin:** confirm the named owner account, one verified IT technician and one verified Service technician. Local fixture tests prove routing and denial behavior, not actual account linking or deployed RLS. No accounts were modified.
2. **Owner job page parity:** native jobs/actions are retained, but the demo's combined job editor, cancel/reopen flows and unified activity page have not been ported wholesale. Map each native action to backend contracts and revision-confirmed reads before enabling it.
3. **Technician writes:** keep the existing IT/Service checks. The separate native technician assignment queue remains read-only; the demo's simplified checklists are not a replacement for required legacy checks.
4. **Stock receiving:** the demo's item approval/partial receiving flow is not a live inventory implementation here. Reconcile native/legacy stock and purchasing contracts before introducing new writes. Never represent a sample receipt as received stock.
5. **Billing handoff draft:** native invoices/quotes/purchasing remain authoritative. Demo billable-hour/parts drafts are not persisted by this PR. Do not infer billed labor from planned visit duration.
6. **UI acceptance across populated workspaces:** this is a first opt-in integration, not a claim that every legacy modal matches the demo pixel-for-pixel. Keep native tables and workflow controls readable and preserve special map/board interactions.

## Validation

- TypeScript typecheck: passed.
- Production build: passed; Vite warns about the existing large application chunk (about 502 kB uncompressed), not a build failure.
- Existing Node/backend/unit suite: 190 tests passed, zero failures.
- Added CI browser specs for Vision groups/native search, classic fallback and all-tools menu, partial-load handling, and technician-token denial.
- Executed those browser scenarios directly with Playwright at 320, 390 and 1440 widths: 9 passed. Local assets and synthetic API responses were intercepted; every external request was blocked. No production reads/writes occurred in these browser tests.
- The normal Playwright CLI runner did not complete startup in this execution environment. The direct runner exercised the same test bodies against the built artifacts. The full existing browser suite still needs the normal CI run; do not describe that gate as passed.

## Rollout

Review the PR and CI, validate through the actual parent platform, and keep Vision opt-in during acceptance. Main, the existing technician apps, and all production records remain unchanged until a separately reviewed rollout.
