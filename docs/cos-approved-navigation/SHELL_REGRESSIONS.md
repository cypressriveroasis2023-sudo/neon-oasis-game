# COS shell integration and duplicate phone-menu correction

November 2, 2026. Existing branch: `design/cos-approved-navigation-20261101`.
Starting head: `c8d2bbc4348ec94dd44e9edd1e01d92e5fa307f3`.

## Actual application change

A full-application phone render exposed duplicate primary navigation in the Owner More drawer: Fleet, Boards, Tech Check, Team and More appeared again above the secondary tools. A narrowly scoped CSS rule hides only that duplicate row when the approved Owner drawer is open at widths up to 700 pixels. The original bottom navigation, desktop sidebar, More search and grouped tools, and IT-specific routes are preserved.

Runtime source changes are limited to a seven-line appended rule in `tech-checks/operations/src/approvedCosNavigation.css`. A preservation check reconstructs the full original CSS blob `eab5e2dbf42f1085128cec573a2bee4b0a0beca4` by removing exactly that addition. The revised selector uses one root ID and scoped existing classes, retaining the original prohibition on doubled root selectors. There is no component, event, route, role, session, data-source, camera status, inventory, timer, host, backend or dependency change.

## Regression-test integration

Four existing shell suites now use the approved five-item navigation rather than the superseded eight-desktop/four-phone menu. They distinguish desktop More as a page from phone More as a modal drawer, follow actual visible controls to Tech Check and its closed management disclosure, and expect the already-approved selected colors and logo placement. All original test cases remain; changes to presentation expectations are explicitly recorded. The shared navigation test helper and two existing navigation specs also follow the real phone drawer and bottom bar rather than the removed duplicate row. The IT menu and its access assertions are unchanged. Existing form, host-frame, input, browser-history, identity, no-write, role, contrast and workflow assertions are preserved outside those reviewed presentation changes.

`approved-shell-test-source.mjs` reconstructs each adapted test from a pinned original at the starting head and verifies the complete before/after Git blobs. `approved-phone-navigation-source.mjs` verifies the complete original/candidate/reversed hashes for those three navigation files. `approved-shell-acceptance.mjs` uses ordinary clicks and actual browser history, never forced clicks, route injection or permission changes. The new duplicate-row assertion caught a genuine defect; it was not removed to obtain a pass.

## Evidence retained

Run `41506818315` passed the 115 focused checks, typecheck, original authentication-preservation script, full build and original committed-artifact gate. Its shell browser suites passed 90 cases and failed six mobile cases on the duplicate-row assertion. The screenshot shows the repeated main menu. Artifact `13170689792` SHA256: `6f568b8e1b2ddaabd83b7ca577d4846c9f669a966e3aacff4c641e7974d65122`.

The initial correction used a doubled-root selector. Run `41507927179` stopped at an existing style safeguard: 117 focused checks passed and one failed. That safeguard was preserved and the selector was corrected; it now passes the original cascade tests locally. Artifact `13172615885` SHA256: `7b24ae321db48efb78d73aa5a9b193dc5d5bb57c58a7f4e56fc06cab022c9049`.

The corrected-selector run `41508715429` passed all 118 focused checks and 120 of 123 browser cases. The remaining three failures came from earlier test navigation depending on the duplicate Owner row. The test helper now treats More as a drawer on phones and a page on desktops, closes an open drawer before using the Owner bottom bar, and retains the same-route/no-extra-read guard. The phone More case additionally asserts that its underlying route does not change. These are test navigation changes, not new application routing or permission changes. Artifact `13173146228` SHA256: `909c1eddb4113e7bf7bb2b2e65fcab343f48952996aff92adb190159a6812d1e`.

## Passing candidate and package boundary

Candidate run `41510075328` at `7bb42614ffbb4f0a74958f2b389893abc7d2377d` passed **121 focused Node checks** and **123 targeted browser cases** with zero failures, skips or retries. These include all four adapted shell suites, More search, primary/secondary navigation, preserved IT restrictions, original host/iframe behavior, responsive rotation, retained in-progress input, form readability, keyboard focus, Escape and browser Back. Full TypeScript checking, the original authentication-preservation script and canonical Vite build also passed.

Candidate artifact `13172004235` SHA256: `c2e2ea1fc518b11f7b075f5db45fcfc3d8dd2af9c47147d97289266e2a984b33`. Receipt `13171084887` SHA256: `98601a812a08b8bb506e2102fc96bf72542c80e92582efbf16d4a8d934f0b5b4`. The archive digests and all eleven staged object hashes were independently checked. All eight source/test entries match the locally prepared bytes. The JavaScript content remains identical to the prior Team candidate (Git blob `1a4a7ab38f76fd32af9671afe7c33525f26cef7a`); only its generated asset filename changes with the CSS import graph. The CSS and generated entry HTML reflect the scoped presentation addition.

The original compiled-artifact gate correctly failed before the matching generated files were attached; that failure was not waived. Staging creates only verified inert Git objects. Attachment uses an expected-head non-force update to the approved design branch. Final exact-head verification must be read-only, without candidate patching or staging, and pass the original artifact gate. Candidate success does not substitute for that final result.

## Release boundaries

Synthetic test records and sessions are not authenticated live-account acceptance. Targeted shell-suite success is not a complete global regression pass. The Board-to-exact-unit response ID, live-account walkthroughs, remaining camera/session/TV regression review and reconciliation with the recovered active repair source remain open. No assumption is made that another assistant agreed or that repository main matches the deployed backend.

No PR, merge, preview, production deployment or live operational write is authorized here. mHelp remains the service-job system. A combined release requires James's separate approval. User evidence excludes fonts, dependencies, credentials and raw browser trace archives.
