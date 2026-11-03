# COS Board work-details actions — design branch only

November 2, 2026. Existing branch: `design/cos-approved-navigation-20261101`.
Starting head: `e50a4b63811c5eb2704ef68a63b1b8c0a92d9c4d`.

## Programmed change

The existing work-details dialog keeps its saved-record information, exact existing job link, and general workspace button accessible. Existing Schedule / Reassign, Close Job, and Delete Job controls are grouped under an initially closed **Manage this work** disclosure instead of appearing alongside routine navigation. Nothing is deleted or newly authorized.

The component receives the original child buttons. It does not clone, invoke, replace or enable their callbacks. Their eligibility conditions, disabled states and confirmation workflows remain in DailyBoard. Records with no management actions receive no empty disclosure. Escape collapses an open disclosure and returns focus to its summary without dismissing the selected work. Existing Close details still closes the work dialog. Management controls wrap on phones and retain at least 48-pixel height.

## Exact source scope

New runtime files: `src/ApprovedBoardActions.tsx` and `src/approvedBoardActions.css` under `tech-checks/operations`.

DailyBoard changes only by one import and the opening/closing action-wrapper tags. All original action expressions and work record logic remain intact. The reversal helper reconstructs the complete prior DailyBoard blob `0734601d3a4e5d0f18128c1cfb8197d1f50ee834`. The earlier Board source-preservation test uses this reversal and retains its original expected historical blob and all behavioral assertions.

No changes to camera/Fleet runtime, data readers, Board snapshot and record logic, identity matching, jobs, mHelp, polling, timers, TV, host/session/login, permissions, inventory assignments, backend, SQL, dependencies or lockfile. No jobs are submitted, closed or deleted in validation. The existing management UI is regrouped, not a replacement ticket system; mHelp remains the service-job system.

DailyBoard is a shared-file overlap with earlier navigation work. Reconcile only the declared import/wrapper hunks with the active repair at combined release. No other assistant agreement or unpublished repair-head reconciliation is claimed.

## Candidate verification

Candidate run `41489168780` at `0ba8f54edc354a7602bc754e990f033732882f86` passed **102 focused Node checks** and **81 targeted full-application Playwright cases**, with no failures, skips or retries in those suites. Full TypeScript checking, original technician-auth preservation, canonical Vite build and independent source/build byte matching also passed. These tests include the original Fleet, unit drawer, More and navigation regressions alongside seven new Board cases at 390, 1024 and 1440 pixels, with extra 320-pixel geometry checks.

The new tests verify collapsed/open management, Escape and focus, original scheduling and destructive confirmation dialogs with cancellation only, task/completed-visit exclusions, go-back close restrictions, exact job UUID navigation, and zero operational writes. They mount the real rebuilt application with a synthetic same-origin parent/session and intercepted saved-read responses. They are not live signed-in Owner/IT/Service acceptance or proof of current operational records.

The first candidate run `41488381439` passed 78 browser cases and failed 3 target-size assertions because an older style reduced the new controls to 40 pixels. A narrowly scoped min-height correction fixed the application CSS; no test assertion was relaxed. Initial failure logs are retained. A UTF-8 declaration is added to the synthetic test parent for correctly rendered evidence banners; no runtime or test assertion change is involved.

Corrected candidate artifact `13162014857` ZIP SHA256 `3f16f77152a125e09e9c427b42ecbe5fd783920f6fc9c42796c1b446f51a943b` was independently verified. The original artifact gate correctly failed before the matching compiled package was attached and was not waived. Staging created only five independently hash-verified Git objects (DailyBoard, the preservation-test adapter, and three generated entries), without updating a ref or deploying. Connector attachment is a separate expected-head non-force update. The attached package must pass final read-only validation and the original unmodified committed-artifact gate.

## Release holds

No PR, merge, preview or production deployment. Cloudflare still excludes this branch from preview publication, and commits retain hosting skip markers. The Board-to-exact-unit shortcut is still unavailable because its existing response lacks the authoritative equipment ID. This change does not infer identity from a tag, IP or name. Full regression review, live-role acceptance and reconciliation with Vision's camera repair remain open; targeted passes are not global production acceptance. James's separate combined-release approval remains required.
