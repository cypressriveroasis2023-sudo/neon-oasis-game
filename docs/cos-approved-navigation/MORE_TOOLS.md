# COS More tools — programmed navigation continuation

November 2, 2026. Existing branch: `design/cos-approved-navigation-20261101`.
Baseline: `d92aa7dcdb80bdbcbd59587402cab372d1fcc7e4`.

## Implemented

- Existing Owner More page and phone drawer now include Find a tool, a local filter over the existing tool labels and groups.
- Search matches canonical and displayed names, ignores case and excess whitespace, expands matching groups, and has explicit no-results feedback. Clear restores the available groups and returns keyboard focus to the search field.
- Existing route keys and navigation callbacks are reused. Unit Tracker eligibility is applied before searching; search cannot reveal a tracker entry that is unavailable to the current account.
- The separate mobile More button now uses the approved selected class. This is the only App.tsx change in this continuation.
- Search is for navigation tools, not operational equipment records. It does not query a provider, run a camera check, infer a unit identity, create work, or store a query.

## Scope

Application changes: `src/OperationsAreas.tsx`, new `src/approvedToolSearch.ts`, new `src/approvedCosToolSearch.css`, and one class-name correction in `src/App.tsx`.
Tests added: `tests/approved-tool-search.test.mjs`, `tests/approved-tool-search.browser.spec.mjs`.
Source and test paths are under `tech-checks/operations`.

No changes to FleetDashboard, DailyBoard, camera calculations, saved proofs, source readers, unit links, timers, session/authentication code, role restrictions, inventory assignments, backend functions, SQL, package versions or lockfile. The App reverse-patch test reconstructs original blob `c0a9de4091a114c5ed4c1c47b507eed7ef8db1b0` after replacing only the mobile More class. Existing protected-source, Board, TV and technician-preservation assertions remain intact.

## Verified evidence

- Read-only workbench run `41468556650` recovered tracked source and locked development tools through GitHub artifacts. Artifact ZIP digest and 1,464 available source blob hashes were independently checked before editing. No repository credentials or production secrets were copied.
- Full local TypeScript 5.7.3 check and canonical Vite build passed. All 67 focused Node tests passed, zero failures/skips.
- Hosted candidate run `41470260970` independently matched the same App and generated-file SHA256s, repeated the focused tests and full typecheck/auth preservation, and passed all 15 new full-application Playwright cases at 390, 1024 and 1440 pixels (zero retries).
- The browser cases mount the complete rebuilt application with a synthetic same-origin parent and mocked saved-read responses. Nonlocal browser traffic is intercepted or blocked; operational writes are rejected. These are NOT signed-in production Owner/IT/Service acceptance.
- Screenshots are actual full-app test renders with a synthetic-data banner. They are not generated mockups or live operational evidence.
- Only four exact verified Git blobs were staged after successful checks: the App source correction, generated index.html, index-KnHt5PIf.css and index-BQyqhIRj.js. Staging did not update any branch or deploy. The connector attaches those same blobs on the approved branch with a non-force expected-head update.

The unmodified committed-artifact gate must be rerun on the attached package. The original full-browser run and the focused new tests are separate evidence; a focused pass is not a global regression-suite pass. Fleet/unit-detail integration, authoritative Board-to-unit identity, secure role acceptance and repair coordination remain open.

## Release hold

No PR, merge, preview publication or production deployment. Cloudflare production remains separate. Source/bundle commits carry hosting skip markers; the design branch is excluded from the project's preview allowlist. mHelp remains the service-job system. James's combined-release review remains required.
