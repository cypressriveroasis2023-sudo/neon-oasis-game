# IT saved Fleet readings — review handoff

## Scope and review target

This follow-up starts from `709322abd63ba0cf11fab1ccedd339c3e33fd3cc`. Its tree matches review PR #359 at `4d1f5c3fc1f3404a33945dce24a26bea0cac29e2`; that review branch is the intended integration target. It does not update main, merge PR #359, supersede the separate Owner equipment work, or authorize a release.

The existing `/api/session` IT response verifies the native actor but previously omitted its ID. The frontend therefore could not create an account-scoped saved-reading key for IT. This change adds `productionTechnicianUserId` from that already-verified context and enables the existing saved-presentation path for authorized IT sessions with a UUID actor ID and a strict boolean feature set. Actor, role, mode and feature permissions remain separate cache scopes. Missing or malformed identity leaves the display uncached.

The last accepted presentation retains its original observation times and survives failed refreshes. Existing auth invalidation, completed-reading retention, Owner-only session recovery, exact Product-ID matching, mHelp placement authority and 2027 tracker IP authority are unchanged. Saved camera reads remain on the existing ten-minute cadence; router/power reads and production schedules are unchanged.

IT manual saved-health refresh controls are omitted from the Fleet heading, unit drawer, embedded and standalone Camera Health, and Data sources. Owner controls remain. Technician connection/placement actions and their existing completion callbacks remain intact.

## Native integration requirement

**The additive verified IT DTO field must be incorporated into the separately reviewed current native package before IT durable caching works. Do not deploy this repository's `index.ts` blindly.** The source file is used for focused handler tests; the production native package has its own integration and review boundary. The [November 7 native preparation](it-saved-readings-native-review-20261107.md) supplies an exact recorded-v154 patch recipe and offline execution tests. It does not deploy that recipe or change auth/RLS policy, secrets, permissions, producer schedules or deployment configuration. A frontend paired with an older backend safely reads saved results without durable IT restoration.

## Validation

- 192 focused unit, rendering, session, retention, cadence, backend DTO and source-preservation checks passed.
- `npm run typecheck` passed.
- `npm run build` passed; the matching frontend assets are included for review.
- Existing source-preservation baselines are retained. Explicit reversal entries cover only this follow-up's changes to `App.tsx`, `FleetDashboard.tsx` and the affected IT browser regression, with exact candidate hashes and replacement counts.
- Added browser cases cover IT cold reopening, original counts and observation times, the next ten-minute saved read, failed-read retention, account isolation, IT control removal and Owner parity. The existing IT daily-mode failure case now waits for scheduled reads instead of clicking the removed button.

The initial November 6 browser attempt was **unverified locally**: the selected Playwright command stalled before test output and was stopped after a bounded attempt. A direct launch then reported:

```text
browserType.launch: Executable doesn't exist at
/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell
```

The November 7 follow-up resolved local execution using the repository's pinned Playwright browser and Node 22.23.4, matching GitHub's Node version. Current verification results and the remaining release boundary are recorded in the [native preparation review](it-saved-readings-native-review-20261107.md). All browser and native-handler fixtures use in-memory synthetic records; no authenticated production probes or operational writes were made.
