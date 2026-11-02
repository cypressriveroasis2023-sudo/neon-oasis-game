# COS navigation design — approved direction, isolated preparation

Review date: November 1, 2026, America/Chicago.
Repository: `cypressriveroasis2023-sudo/neon-oasis-game`.
Branch: `design/cos-simplify-navigation-20261101`.
Verified base: `38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137`.

## Status and authorization

James approved the phone/desktop layout direction and authorized remaining screen/file-overlap verification and preparation of a separate design branch, without deployment. The approved top-level direction is Fleet, Boards, Tech Check, Team, and More; one desktop sidebar and one phone navigation bar, subject to existing role access.

This checkpoint changes documentation only. No application implementation, generated assets, workflow, hosting configuration, database, permission, camera connection, inventory record, login, or timer is changed. No merge, deployment, preview publication, migration, live connection check, or operational write is authorized by this document. Layout approval is recorded; it does not need to be requested again.

**Source-level navigation verification is recorded below. Authenticated rendered screen verification is NOT complete.** The connected TinyFish browser profile has no saved signed-in sites and zero saved domains. No Owner, ITTECH, or Service session was available for an authenticated walkthrough. The existing GitHub source was readable; this is not a repository access failure. Prior PR screenshots and their reported tests are not treated as current production evidence.

## Verified current source structure

All source links below are pinned to the inspected base, not a moving branch.

| Surface | Verified source finding | Evidence |
| --- | --- | --- |
| Owner desktop shell | Sidebar renders `primaryAreas`; footer and utility bar add more entry points. The top-level Owner primary list has nine entries before conditional filtering. | [App.tsx](../../tech-checks/operations/src/App.tsx), lines 360–377; [visionAreas.ts](../../tech-checks/operations/src/visionAreas.ts), lines 1–16 |
| Phone shell | `operations-bottom-nav` already exists, with distinct Owner and IT/daily variants and a separate menu dialog. Reuse its navigation callbacks, focus trap, Escape handling, inert state and focus restoration. | App.tsx, lines 248–277 and 403–405 |
| Route registry | `workspaceNavigation.ts` lists 35 workspaces, not 35 simultaneously visible buttons. It preserves Field Map/Field View aliases and validated job/unit/installation context. These route identities must remain available. | [workspaceNavigation.ts](../../tech-checks/operations/src/workspaceNavigation.ts) |
| IT access | `fleetWorkspaces`, `dailyOnly`, `fleetOnly`, `trackerAccess` and feature checks restrict available routes. Boards and Team must not be exposed to a role that currently lacks them. Navigation appearance is not an authorization grant. | App.tsx, lines 236–246, 287–307 and 360–401 |
| Fleet / Camera Health | Normal Fleet and Camera Health share `FleetDashboard`, with differing initial view and existing selected-unit callbacks. Advanced diagnostics remain separately guarded. This is not a reason to replace the dashboard or its data model. | App.tsx, lines 378–400 |
| Unit continuity | Existing callbacks preserve validated `unitId`, history state and return-to-map behavior. Existing legacy label links resolve through the current guarded drawer; do not replace that resolution with a guessed match. | App.tsx, lines 303–327; workspaceNavigation.ts |
| Tech Check | IT and Service buttons and 11 management tools use `openLegacy`. Signed check records remain in their existing workflows rather than the Operations job database. | [TechChecksWorkspace.tsx](../../tech-checks/operations/src/TechChecksWorkspace.tsx) |
| Team | Existing production-team, jobs and daily-board readers provide saved assignments and readiness. Errors and unavailable sources are shown explicitly. No new team database is required for navigation. | [TeamWorkspace.tsx](../../tech-checks/operations/src/TeamWorkspace.tsx), lines 1–67 |
| Boards / TV | DailyBoard owns board reads, assignments, settings, TV state, refresh timers and invalidation. App supplies guarded TV lifecycle callbacks. Treat these as protected behavior, not navigation code. | [DailyBoard.tsx](../../tech-checks/operations/src/DailyBoard.tsx), lines 1–100; App.tsx, lines 230–245 and 378–380 |

Source review does not prove live data completeness, role acceptance, browser layout, overflow, refresh behavior or actual camera status. No live fleet counts are recorded or inferred here.

## Approved destination grouping

| Main destination | Reuse / group existing destinations | Preserve |
| --- | --- | --- |
| Fleet | Fleet Dashboard, Camera Health, Units On Hand / Shop; map and inventory within existing Fleet | Existing totals, Field/Shop membership, support separation, identity holds, original observation/check times and exact unit context |
| Boards | Existing Daily Board and authorized TV/team views | Existing TV launch, settings, saved reads, focus/session lifecycle and timers |
| Tech Check | Existing IT and Service entry points, transfers, check-in/out and required paperwork | Original signer, photos, signatures, custody, battery rules, correction history and role checks |
| Team | Existing Team workspace and saved work/readiness; approved task/work records where already available | Saved assignee, actual recorded work and actual next step; missing information stays missing |
| More | Calendar, tracker, reports, directory/administration and remaining existing business tools | No route or functionality deletion; existing permission checks remain authoritative |

Camera/provider links, router information, diagnostics and Victron power remain reachable within the relevant existing unit or Fleet subsection. Their underlying routes and links are unchanged. Service phone users retain the simpler existing technician workflow; this approval does not grant them Owner/IT destinations.

Service jobs originate in mHelp. Do not introduce a second ticket system, create new job/task records during navigation, or fabricate work items. Existing unrelated job/finance functions may move out of primary navigation but are not deleted.

## File-overlap review

The current open-PR list and actual changed-filename lists were read for #285, #323, #302, #242, #225, #315 and #321. This is a filename-level integration review, not a claim that merges are conflict-free. PR descriptions can lag behind changed-file lists; the actual lists govern. Unpublished local changes in Vision are not visible through GitHub and must be reconciled before touching shared implementation files.

| Existing work | Verified overlap / boundary | Required treatment |
| --- | --- | --- |
| [#285](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/285) — earlier simplification | Changes App, workspaceNavigation, main entry, Operations host, Fleet, DailyBoard, Team, Tech Check, TV, calendar, custody and many tests | Do not merge wholesale, supersede, or overwrite. Reconcile only approved presentation/navigation changes after checking its current head. Preserve non-design work separately. |
| [#323](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/323) — Fleet visual preview | Changes FleetDashboard, main entry, its own preview stylesheet, Owner briefing, generated assets and browser tests | Do not layer a second Fleet theme over it or inherit its generated bundle. Keep this branch isolated. Coordinate any later Fleet presentation edits. Its reported tests are not results for this branch. |
| [#302](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/302) — Owner action queue | Changes App, TodayDashboard and action-queue files | Preserve Owner-session gating and saved-source semantics. Do not copy the queue as a new ticket system. |
| [#242](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/242) — independent power / saved refresh | Changes FleetDashboard, FleetCommandCenter, power/model/cadence files and tests | No changes to read cadence, power verification or dashboard state/effects. Shared Fleet component requires deliberate integration. |
| [#225](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/225) — saved health / Field scope | Changes health summaries, evidence/scope/snapshot models, legacy overview and backend evidence helpers | Outside design scope. Do not change health computation to make the layout appear correct. |
| [#315](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/315) — exact-product TCP repair | Changed-file list contains backend producer/source/receipt integration, SQL and tests, not the planned navigation shell | No backend or model edits. No probe, enablement, migration or activation. |
| [#321](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/pull/321) — saved proof / TV regressions | Current changed-file list contains seven test files covering census, health, session, proof refresh and TV | Do not modify assertions or reuse predecessor results as this branch's validation. No merge or state change. |

The shared AI Repair Room was readable but empty at the initial check. No active repair-owner acknowledgement or agreement is inferred from that empty room.

## Revised minimal implementation file plan

The earlier broad suggestion to edit root HTML, host logic and global styles is superseded by this narrower source-grounded plan. These are proposed future changes, not files modified by this checkpoint.

1. Add `tech-checks/operations/src/CosNavigation.tsx`, `cosNavigationPresentation.ts` and `cosNavigationPresentation.css` for presentation-only groupings and scoped responsive chrome. The data passed to navigation must already be permission-filtered by the existing shell. No new authorization policy.
2. Make a small JSX/import integration in `tech-checks/operations/src/App.tsx` after shared-file reconciliation. Preserve session hooks, route parsing/serialization, callbacks, history, role guards, TV lifecycle, camera entry revisions, handlers and timers byte-for-byte where possible. Do not replace the whole file from another branch.
3. Group existing cards in `TechChecksWorkspace.tsx` only where necessary. Keep every `openLegacy` target and permission boundary.
4. Defer edits to `FleetDashboard.tsx`, DailyBoard and Team rendering until authenticated screens establish a real presentation need and #285/#323/#242 overlap is reconciled. Prefer scoped styles without changing state/effects/handlers.
5. Add focused navigation/viewport regression tests without weakening the existing camera, session, identity, TV or custody assertions. Keep existing checks.

`visionAreas.ts` mixes navigation metadata with inventory/location helper functions. Do not rewrite that file for a menu change. `workspaceNavigation.ts` carries route-context validation; do not remove aliases or replace the route parser to shorten labels.

Protected during design work: `api.ts`, session/auth files, `refreshCadence.ts`, camera/status/evidence and identity models, backend/SQL, source adapters, provider/camera links, permissions, inventory assignments, `index.html`, Operations host bridge, service worker, deployment configuration and committed `dist` assets unless separately reviewed for the eventual combined release. No blanket global CSS replacement.

## Nondeployment preparation

Fresh Cloudflare account read found `cos-vision-integration-preview` attached to this repository. Its production branch is `main`; automatic previews use a custom allowlist containing only:

- `feature/cos-simple-navigation-session-safe-20261022`
- `preview/vision-command-james-20261031`

This design branch is not in that allowlist. No Cloudflare settings were changed. At the initial read, latest/canonical deployment `9b91c4f1-5433-46b4-ac22-474a17d6a696` referenced base commit `38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137`.

The inspected `cos-operations.yml` push trigger selects `main` and `cos-operations-pages`; the Fleet/TV static publisher's push trigger selects `main`. No workflow is dispatched and no pull request is opened by this checkpoint. No Netlify operation is performed. Existing scheduled work is not stopped or changed.

## Required authenticated screen verification — still pending

Use the existing COS sign-in entry at `https://cos-vision-integration-preview.pages.dev/index.html`, not a replacement app. The existing connected browser needs a saved sign-in. James should enter credentials directly in the secure browser, not in chat. Owner and ITTECH sessions are required to verify their distinct views; an authorized Service session is needed to validate the actual Service phone workflow. Reuse existing accounts without granting roles or changing login.

| Check | Status / acceptance |
| --- | --- |
| Owner desktop and phone | Pending live session. Inspect Fleet, Boards/TV, Tech Check, Team, More and existing unit details. |
| ITTECH desktop and phone | Pending live session. Same authorized Fleet/health information, no new Owner controls or newly granted routes. |
| Service phone | Pending live session. Existing check-in/out, transfer and paperwork remain intact; no false submission to test the layout. |
| Board → exact unit → location/history → next step | Pending. Verify a real saved association and existing route. Missing/ambiguous unit or assignee must be labelled, never guessed. Preserve exact camera/provider links. |
| Responsive layout | Pending browser measurement at 390, 1024 and 1440 px, plus 320 px overflow check. No sideways scrolling, duplicated visible primary navigation or clipped controls; at least 44 px touch targets. |
| Evidence presentation | Pending. Online/Offline/Unverified/support remain distinct; original source observation/check times are visible. UI refresh time must not masquerade as a camera check time. |
| TV / session safety | Pending. Existing TV entry/exit, hidden-tab behavior, session recovery and access clearing must remain unchanged. No new cadence. |
| Real record mutations | Prohibited for design verification. No assignment, check submission, stock move, new service job or live camera probe. |

No build, browser test, CI pass, complete authenticated walkthrough or production recovery is claimed for this documentation-only checkpoint.

## Combined-release handoff

Keep this branch separate. Before implementation touches shared files, re-read current main and the related PR heads, complete the authenticated screen checks, and record file ownership with the active repair work. At eventual integration, apply a minimal presentation delta onto the repaired current components, run exact-head role/navigation/viewport and existing camera/TV/session tests, then prepare one combined release. This document does not authorize that merge or release.
