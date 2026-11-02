# COS simple navigation: branch preparation and verification

## Status and authority

James approved the COS phone and desktop layout direction and authorized remaining verification plus a separate design branch, with no deployment. This is the existing Cameras Onsite application, not Cypress River Oasis and not a new app.

- Repository: `cypressriveroasis2023-sudo/neon-oasis-game`
- Branch: `design/cos-simple-navigation-20261101`
- Inspected and branched from main: `38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137`
- Preparation scope: this documentation file only. No application implementation, generated bundle, workflow, configuration, database, production data, or other branch is changed.
- Approval is for layout direction. It does not approve invented example counts, new permissions, Cypress River Oasis branding, a new camera status, or a new service-ticket system.
- No merge, deployment, live camera check, migration, or release is authorized by this branch.

## Verification result: distinguish source inspection from live acceptance

Source-level routing and component review has been performed for the five proposed destinations and their principal existing subviews. This is NOT a completed authenticated phone/desktop walkthrough, a test-suite pass, or a production readiness claim.

The available TinyFish Default browser profile (`prof_766a7a1e28ff4dbf`) has no saved signed-in sites and zero saved domains. The public COS entry page is reachable, but that does not establish authenticated Owner, IT, or Service access. Exact remaining access: sign in to the existing COS app using an authorized account in that browser profile and save the session. Owner, IT desktop, and Service phone behavior require their respective existing roles; Owner mode is not proof of technician access. Never request passwords in chat or bypass role/session controls.

A local Git read attempt could not resolve `github.com`; therefore no local checkout, dependency installation, browser render, build, or test execution is claimed. Connected GitHub reads succeeded. Historical PR323 test reports are not new tests of this branch.

## Approved presentation contract

- Brand: `VISION by Cameras Onsite`. No Cypress River Oasis branding or invented replacement logo.
- Visual direction: navy/cobalt/white, readable contrast, short labels, large touch targets, no horizontal page scrolling.
- Principal Owner navigation: Fleet, Boards, Tech Check, Team, More.
- Desktop: a single primary sidebar. Phone: a single primary bottom navigation. Avoid simultaneously exposing duplicate primary menus.
- Existing role and feature eligibility remains authoritative. Do not display or enable routes merely because they exist in the Owner layout.
- Camera labels remain Online, Offline, and Unverified as supplied by the existing model. Support equipment is a separate equipment category, not another camera-outage state. Do not introduce a computed Check Soon status.
- Field/Shop equipment counts, camera-capable unit counts, and verified individual camera/channel totals are different measurements. Never multiply unit types to invent camera totals.
- Keep the existing distinctions among saved camera evidence, router management reachability, power readings, last saved check, and last known online. Missing values are not zero. Preserve original timestamps, provenance, and identity holds.
- Customer/site and address are existing records. Use existing map links and location provenance. Do not convert an address-derived location into verified GPS.
- mHelp remains the service-job system. Existing native tools/data are not deleted, but competing job creation is not promoted as the primary workflow.
- No changes to sources, classifications, polling, timers, permissions, login, session renewal, equipment assignments, provider bindings, IPs, or camera links.

## Screen-to-source verification

Paths below are relative to the repository root. References were inspected from the pinned main above unless a PR is explicitly named.

| Proposed area | Existing source and verified behavior | Design implication / unverified boundary |
| --- | --- | --- |
| Owner desktop navigation | `tech-checks/operations/src/App.tsx` renders `operations-area-nav`, sidebar actions, utility bar, and an independent mobile bottom navigation. `visionAreas.ts` exposes Fleet, Overview, Camera Health, Routers, Power, Units On Hand, Team, Tracker, Operations. | Consolidate presentation only. Keep `navigate`, session guards, route history, private-data clearing, and unit-selection callbacks intact. Actual rendered width/contrast is not yet checked. |
| Owner phone navigation | `App.tsx` currently uses Fleet Dashboard / Overview / Team / Menu, with different sets for IT modes. | Proposed five destinations are an Owner presentation, not a blanket permission grant. Mobile menus must preserve focus trap, Escape, return focus, inert state, Back behavior, and safe-area spacing. |
| IT desktop | `tech-checks/it-feature-availability.js` currently sets `IT_DAILY_ONLY = true` and permits only `Fleet Dashboard` and `Camera Health`. `App.tsx` filters routes and rejects out-of-scope navigation. | Preserve the deliberate paused-module state. This design approval does not reopen Boards, Team, Tracker, or other modules for IT. Phone handoff behavior must be tested in the original technician host rather than inferred from Owner screens. |
| Fleet / Camera Health | `App.tsx` uses the same `FleetDashboard` component for Fleet and ordinary Camera Health, changing its initial view; advanced diagnostics use `CameraHealthWorkspace`. `FleetDashboard.tsx` contains current authority, evidence, cadence, and selection integration. | Group entry points without replacing the model or mounting parallel readers. Do not edit these shared integration files before the active repair checkpoint. |
| Unit details | `FleetUnitHealth.tsx` consumes an already reconciled row and renders camera evidence, a last-known status component, router observations, and power data. | Reuse these values and explanations. A router response is not camera health. Do not rewrite links, infer last-online times, or strip stale/unverified warnings. |
| Boards | `DailyBoard.tsx` reads existing jobs, tasks, and readiness; presents assignee/status/notes and existing management actions. Its detail dialog currently opens Jobs or Owner Tasks workspaces. | The mockup's universal Board-to-exact-unit action is NOT already implemented. The proposed action must use an existing verified unit ID in the selected record. No name-based lookup or invented product association. Missing exact linkage must say Unit not linked and retain access to the source record. |
| TV | `DailyBoard.tsx` opens `TechCheckTvBoard.tsx`; that component renders work/readiness and delegates camera/map to `TvFleetView`, retaining refresh/rotation and fullscreen lifecycle. | No new TV data source, schedule, rotation logic, or remount-based refresh. Styling should not suppress error/stale notices or change camera/Field population calculations. Authenticated fullscreen, exit, and long-running behavior remain untested here. |
| Tech Check | `TechChecksWorkspace.tsx` uses existing `openLegacy('it')` and `openLegacy('service')` entry points, plus assignment, review, handoff, calendar, history, activity, accounts, and test-center tools. | Prioritize ordinary work and move management lower. Check in/out means equipment workflow, not employee clock in/out. Do not invent direct checklist endpoints or bypass prerequisites to make a shortcut. |
| Tech Check host | `tech-checks/operations-host.js` builds the original iframe/legacy bridge, carries route context, checks Owner/effective-role/session visibility, preserves open checks on return, and explains why Owner cannot submit Service technician readiness. | High-risk shared host: do not replace it with a new wrapper. Preserve role semantics, iframe messages, origin checks, private evidence hiding, and return behavior. Any later text/style edits need exact hunk review. |
| Team | `TeamWorkspace.tsx` reads `/api/team-production`, `/api/jobs`, `/api/daily-board` and distinguishes readiness, active work, missing data, and last successful records. | Reformat existing records. Do not fabricate assignees, progress, next steps, or completion. Preserve the separation from original Tech Check team/accounts screens. |
| More / secondary tools | `OperationsAreas.tsx` and `workspaceNavigation.ts` retain grouped existing destinations. Some App.tsx fallbacks link to a separate existing AppDeploy workspace rather than a local native screen. | Keep secondary functions reachable and label external destinations honestly. No new app or new hosting is required. Calendar and original history remain accessible under their existing authorization. |

## Navigation grouping, without route or authority changes

| Destination | Group existing functions |
| --- | --- |
| Fleet | Fleet Dashboard, Field/Shop inventory, Units On Hand, unit search/map, camera-capable/support separation. Fleet tools retains fleet-wide Camera Health, InHand Routers, Victron Power, and Unit Tracker where currently permitted. |
| Boards | Existing Daily Board and TV views; keep work state separate from camera state. |
| Tech Check | Existing IT and Service entry points, equipment check-in/out, transfers/returns, required forms and original records. Management tools remain secondary and permission-controlled. |
| Team | Existing team, assignments, readiness, original work records, and recorded next steps. |
| More | Calendar, customer/site directories, history, reports, and permission-controlled administration. Finance, purchasing, CRM, imports, testing, configuration, and legacy/native job tools are secondary, not removed. |

Display labels may shorten, but canonical workspace names, existing hashes, query parameters, and ID-validation rules must remain unchanged. `workspaceNavigation.ts` supports exact unit context for Fleet/Camera Health/Tracker; this does not by itself prove a board record has a valid unit association. Existing verified mHelp references may be displayed/opened; do not construct unverified ticket URLs or create a competing ticket.

## File ownership and overlap

### Verified PR overlap

PR323 (`preview/vision-command-james-20261031`) has changed-file entries for:

- `tech-checks/operations/src/FleetDashboard.tsx`
- `tech-checks/operations/src/FleetOwnerBriefing.tsx`
- `tech-checks/operations/src/main.tsx`
- `tech-checks/operations/src/visionCommandPreview.css`
- generated `tech-checks/operations/dist` HTML/assets
- `tech-checks/operations/tests/fleet-first-navigation.browser.spec.mjs`
- `tech-checks/operations/tests/vision-command-preview.browser.spec.mjs`
- `docs/vision-command-preview` records and synthetic screenshots.

Do not copy the older FleetDashboard/main/dist files onto current main. Reconcile individual presentation changes after the repair checkpoint. The PR's documented browser failures are historical evidence, not a reason to weaken assertions and not evidence that this branch passes.

PR315's changed-file list contains exact-product producer/source/runtime modules, `cos-operations-pages/index.ts`, `serve.ts`, `mhelp2027ConnectionCensus.ts`, related SQL, and tests. These are outside design ownership.

The current PR321 changed-file list contains these protected regression files:

- `field-inventory-census.browser.spec.mjs`
- `mhelp-field-health.test.mjs`
- `operations-session-recovery.browser.spec.mjs`
- `product-proof-refresh.browser.spec.mjs`
- `saved-camera-refresh.browser.spec.mjs`
- `tech-check-tv.browser.spec.mjs`
- `verified-health-identity.browser.spec.mjs`

All seven are under `tech-checks/operations/tests/`. Do not treat the earlier PR description's two-file count as the current changed-file list. Design tests should be added separately rather than rewriting camera/session expectations.

### Proposed implementation files, not changes made here

| Candidate | Allowed future scope | Hold / risk |
| --- | --- | --- |
| `tech-checks/operations/src/App.tsx` | Navigation render blocks and presentation wiring only | High: same file owns guarded routes, session lifecycle, TV, and Fleet mounting. Do not replace entire file. |
| `tech-checks/operations/src/visionAreas.ts` | Presentation arrays only | Contains inventory/location helpers as well; leave helper functions untouched. |
| `tech-checks/operations/src/workspaceNavigation.ts` | Display/group metadata only, if necessary | Do not change canonical route parsing, aliases, unit-ID validation, or hashes. Prefer a separate presentation-only map. |
| `tech-checks/operations/src/OperationsAreas.tsx` | Secondary-tools grouping | Preserve existing destinations. |
| `tech-checks/operations/src/TechChecksWorkspace.tsx` | Prioritize existing actions; group management | Preserve existing account and legacy routing. |
| `tech-checks/operations/src/DailyBoard.tsx` | Render hierarchy; conditional existing-ID navigation | No new assignment/source/status behavior. Exact-unit data availability must be verified first. |
| `tech-checks/operations/src/TeamWorkspace.tsx` | Existing-record presentation | No added data source or made-up next step. |
| Proposed new `tech-checks/operations/src/cosSimpleNavigation.css` | Scoped navigation/layout tokens | Not created/imported by this preparation commit. Avoid a global override layer affecting camera and host styles. |
| `FleetDashboard.tsx`, `FleetUnitHealth.tsx`, `TechCheckTvBoard.tsx`, `TvFleetView.tsx`, `main.tsx`, shared Fleet CSS | Coordinated later presentation only | Frozen for this preparation; reconcile PR323 and active repair first. |
| `tech-checks/index.html`, `operations-host.js`, role-specific host files and styles | Only verified presentation hunks if the final design requires them | No broad host rewrite; do not alter login, readiness, permissions, or iframe lifecycle. |
| Generated `dist`, workflows, lockfiles, Supabase functions, SQL | None in this task phase | No build publication, deployment, migration, or automatic release. |

No active Vision repair checkpoint or unpublished file-ownership list was present in the shared repair room when read. Published PR overlap can be verified, but absence from a PR is not proof a file is unowned. Obtain the current checkpoint/branch SHA and file ownership before edits to shared runtime files. Do not claim the other assistant agreed.

## No-deploy preparation

The inspected `cos-operations.yml` push trigger targets `main` and `cos-operations-pages`. The inspected Fleet publication workflow targets `main` and enumerates shared runtime/style files. This preparation uses a separate branch and a documentation-only path and does not open a PR or dispatch any workflow. Commit skip markers are an additional precaution, not a substitute for verifying hosting configuration before future code publication. No hosting configuration or permission changes are made.

## Remaining acceptance gates (not passed here)

1. Authenticated Owner desktop/phone, current IT desktop, and Service phone at 390/1024/1440 widths, including keyboard/focus, browser Back, unit return, no duplicate primary navigation, and no horizontal overflow.
2. Real read-only Board -> exact linked unit -> saved location/history -> recorded next step; demonstrate honest missing-link, missing-assignee, missing-time, and unavailable-source states.
3. Original equipment check-in/out, transfer/return, required paperwork, and role restrictions remain intact. No submission is needed merely for design inspection.
4. Active Vision checkpoint and shared-file ownership; reconcile PR323 presentation against the current repaired source rather than old artifacts.
5. Before any eventual combined release: same-source Fleet/Camera Health/TV evidence and counts, unchanged timer/network behavior, protected session/identity regressions, build/artifact verification, and James's combined-release review. This branch does not authorize that release.

## Source references

Pinned tree: https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/tree/38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137

- `tech-checks/operations/src/App.tsx`, especially inspected lines 210-360 and 360-465
- `tech-checks/operations/src/visionAreas.ts`
- `tech-checks/operations/src/workspaceNavigation.ts`
- `tech-checks/operations/src/OperationsAreas.tsx`
- `tech-checks/operations/src/TechChecksWorkspace.tsx`
- `tech-checks/operations/src/FleetDashboard.tsx` (integration section)
- `tech-checks/operations/src/FleetUnitHealth.tsx`
- `tech-checks/operations/src/DailyBoard.tsx`, including inspected detail/action section
- `tech-checks/operations/src/TeamWorkspace.tsx`
- `tech-checks/operations/src/TechCheckTvBoard.tsx`
- `tech-checks/operations-host.js`, inspected lines 1-220
- `tech-checks/it-feature-availability.js`
- `.github/workflows/cos-operations.yml`, inspected trigger section
- `.github/workflows/cos-fleet-pin-static-publish-20261019.yml`, inspected trigger/build section
- Current changed-file lists for PR315, PR321, PR323; PR323 design README.
