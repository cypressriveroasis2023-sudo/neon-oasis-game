# COS navigation — rendered component review

Branch: `design/cos-approved-navigation-20261101`.
Parent: `24d77c1bf50ae820e63267171b941a5f29e32df4`.
Review date: November 2, 2026. Source-only; no merge or deployment.

## Reproduced issues and narrow corrections

1. The existing work-details dialog rendered at x=0/y=0 on a 390x844 viewport. Its Close details target measured 40 pixels high. Scoped CSS now centers only the dialog containing `.cos-board-record`, bounds it to the viewport, preserves one scrolling surface, hides it when closed, and keeps a 48-pixel Close control reachable while scrolling. The existing DailyBoard TSX, selection, events, scheduling and TV dialogs are unchanged. The selector uses `:has(.cos-board-record)` rather than changing the shared Board component.
2. The legacy company theme contains an important `#root#root .company-shell .operations-bottom-nav button.active` rule. It erased the new red mobile selection even when the new stylesheet loaded last; desktop selection also depended on stylesheet order. The new Owner navigation now uses its own `cos-approved-selected` class. Existing `aria-current`, original workspace keys and click callbacks are unchanged. The shared theme is NOT edited and no new specificity escalation is added.

## Evidence and test boundary

- The current branch's `dist/index.html` references `index-L3ge90LI.css`. Its Git blob `2dd9ca79a8ba313396e7a0de081a7ad9af0d3dfc` was independently fetched and matched the CSS bytes recovered from an existing GitHub artifact.
- Historical artifact: `cos-reviewed-frontend`, artifact ID `13028514607`, run `41166605735`. Only its React/ReactDOM 19.0.0 runtime, the matching CSS and its three fonts were used locally. The old application was never mounted. Its run result or manifest is NOT evidence that this candidate builds or passes.
- The actual new stateless `ApprovedCosNavigation` and `BoardRecordDetails` components and their presentation models were transpiled with local TypeScript 5.8.3 and rendered under React 19.0.0. The surrounding parent is a synthetic fixture. Unchanged `boardDateLabel` and `workspaceHash` imports are explicit boundary doubles; actual routing, App/DailyBoard lifecycle and authentication are not tested by this harness.
- The complete matching base stylesheet and new scoped styles were tested in both load orders. Exact retained Open Sans font bytes were embedded only in the local test page. No font files or operational data are published with this change.
- Browser: Chromium 144.0.7559.96 through the installed Playwright Python package. This is not the project's pinned Playwright 1.51.1 runner.

## Results on the saved source candidate

- 37 Node regression tests passed, zero failures/skips: all 32 existing Board-record tests unchanged, plus five navigation/cascade/dialog-boundary tests. The existing reverse-patch test still reconstructs the original pre-design DailyBoard blob, protecting every original timer, count, assignment and TV handler.
- 36 isolated rendered scenarios passed: six widths (320, 390, 700, 701, 1024, 1440), two stylesheet orders and three record cases (job, task, missing data).
- Checks cover one visible five-item primary menu, preserved navigation callback arguments, red/white selected state including hover, touch targets, centered bounded dialog, long-note wrapping, no horizontal overflow, readable record text, missing-note/link states, sticky Close access after scrolling, native close/Escape and zero operational network requests/page errors.
- At 390 pixels, the corrected dialog is x=16/y=16, width 358, height 812, with a 48-pixel Close target. The baseline was x=0/y=0, width 350, height 810, Close 40.
- An early harness run had 12 failures due to an overly literal wrapper-newline text assertion. That expectation was replaced with exact assertions on the actual summary and paragraph separately. Short records are not required to overflow. Initial results are retained; no application behavior was weakened to hide them.
- Screenshots are actual local component renders with prominently labeled synthetic records. They are not screenshots of a signed-in production app.

Normal focused project command:
`node --import tsx --test tests/board-record-details.test.mjs tests/approved-navigation-cascade.test.mjs`

## Exact scope and unchanged boundaries

Changed: `ApprovedCosNavigation.tsx`, `approvedCosNavigation.css`, `boardRecordDetails.css`.
Added: `tests/approved-navigation-cascade.test.mjs` and this review document.
Source/test paths are under `tech-checks/operations`.

No App, DailyBoard, Team, Fleet, camera/provider model, saved evidence, status calculation, data reader, authentication, permission, polling, mHelp/inventory assignment, database, workflow, dependency, generated bundle or deployment setting changed. The Board-to-exact-unit link remains unavailable because the existing response lacks the authoritative unit-ID binding. No lookup by name, tag or IP is introduced. mHelp remains the service-job system.

## Remaining gates

Full repository checkout remains DNS-blocked in this runtime. No complete project typecheck/build, full unit/Playwright run, secure signed-in Owner/IT/Service walkthrough or production readiness is claimed. The new unit-style assertions do not replace those gates. Shared Fleet/detail visual work still requires the active repair checkpoint and exact-hunk reconciliation; no repair-owner agreement is presumed. This commit is published only to the approved design branch with skip markers, without a PR, merge, workflow dispatch or deployment.
