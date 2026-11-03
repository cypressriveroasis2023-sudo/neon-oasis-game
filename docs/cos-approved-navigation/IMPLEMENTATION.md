# Approved COS navigation — first implementation slice

Branch: `design/cos-approved-navigation-20261101`  
Base: `38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137`

James approved implementation of the pictured phone/desktop layout on this separate branch, with no merge or deployment. This is a source-only navigation checkpoint in the existing COS application, not the complete visual redesign or a production-ready release.

## Implemented

- Owner desktop: Fleet, Boards, Tech Check, Team and More, using the original workspace keys and guarded navigation callback.
- Owner phone: four primary destinations plus the existing More dialog; five touch-friendly buttons, existing focus restoration/Escape/inert behavior, and keyboard access to collapsible tool groups.
- More: grouped existing Fleet tools, daily review/calendar, customers/sites, finance/purchasing and existing workflows/assistant. The existing tracker eligibility check controls its entry. No destination or data is deleted.
- Tech Check: prominent existing IT and Service entry points, visible handoff/attention/history tools, and collapsed management tools. Original checklists, prerequisites, photos, signatures and saved records remain in the original host.
- Scoped navy/red navigation and white secondary-tool/Tech Check surfaces. Existing branding artwork is reused. Duplicate Owner navigation shortcuts are removed.

No illustrative mockup names, addresses, camera counts, timestamps, assignments, photographs or next steps were inserted into application data.

## Protected behavior

IT/daily-mode eligibility and Service workflows are not expanded. Existing canonical hashes, exact-unit route handling, browser history, camera entry revisions, session recovery and TV lifecycle remain intact. Original FleetDashboard and DailyBoard mount lines and protected App sections are checked against their base-source hashes.

There are no changes to FleetDashboard, DailyBoard, TeamWorkspace, camera/provider models, saved evidence, source readers, polling intervals, backend functions, SQL, inventory assignments, IPs, camera links, host/login files, permissions, workflows, dependencies or generated dist assets. mHelp remains the service-job system; existing secondary native tools are retained, not promoted as a replacement.

## Verification actually performed

- 16 focused navigation/source-preservation tests passed; zero failures or skips.
- TypeScript syntax transpilation passed for the five changed/new TS/TSX files using locally available TypeScript 5.8.3. Strict checking passed for the standalone presentation metadata module. These are NOT the project's full TypeScript 5.7.3 typecheck or production build.
- Isolated stateless-component DOM checks passed at 320, 390, 700, 701, 1024 and 1440 pixels: primary navigation count/visibility, touch-target size, overflow, selected state, original route callbacks, all Tech Check destinations, tracker filtering, and mobile More focus/Escape/inert/Tab behavior.
- That browser harness transpiles the actual new stateless TSX using a minimal DOM renderer with inspected shell-CSS excerpts. It is NOT the React 19 application, a full stylesheet integration test, authenticated role acceptance, live data verification or production evidence.

Local Git checkout failed because this runtime could not resolve github.com. Connected GitHub reads/writes worked. No full project dependencies, build, full unit suite, existing Playwright suite or authenticated Owner/IT/Service walkthrough is claimed. The focused suite can be run in the normal project environment with `node --import tsx --test tests/approved-cos-navigation.test.mjs`.

## Still open

1. Direct Board-to-exact-unit navigation: the inspected board/job presentation uses equipment tags, but an authoritative exact saved unit-ID contract has not been established. Do not infer identity from names, tags or IPs. The existing Fleet unit-opening path remains unchanged; the new Board shortcut is not implemented here.
2. Fleet/unit-detail visual polish and recorded history/next-step presentation: reconcile the active camera repair and PR323 before editing those shared components. Do not reproduce invented mockup data or introduce a second status model.
3. Full project typecheck/build, combined-stylesheet browser checks, existing session/identity/TV regressions, and secure authenticated Owner, IT and Service acceptance.
4. Shared-file reconciliation with PR285/PR302 for App/navigation, and the active repair checkpoint. Approval of the layout is already recorded; this is not permission to merge older whole files or overwrite newer repair code.

## Release hold

Source branch only. No PR, merge, preview publication, workflow dispatch, database change or production release is part of this checkpoint. Generated assets remain unchanged. Skip markers accompany publication as an additional precaution; hosting status must be read back separately. The eventual combined release requires repair reconciliation, exact-head verification and James's release review.
