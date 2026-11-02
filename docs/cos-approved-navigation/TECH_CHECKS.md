# COS Tech Check hub — keyboard, phone layout and readable tools

November 2, 2026. Same approved design branch: `design/cos-approved-navigation-20261101`.
Starting head: `59839313718b7ee3044759bd0a9c5c34cea9c498`. No release.

## Programmed changes

- The existing Manage Tech Checks disclosure starts collapsed. Escape closes an open disclosure and returns keyboard focus to its summary without leaving Tech Check.
- Existing hub cards have larger touch targets and a single-column phone layout. Labels wrap rather than being clipped.
- Visual review found dark text on dark secondary cards inherited from the legacy double-root theme. A narrowly scoped correction gives those cards a light background with readable title and description colors. An additional browser test checks the actual computed contrast of all 26 card labels/descriptions, including hover.
- All 13 original entry destinations and button callbacks are preserved. IT check in/out, Service handoffs, follow-up, assignments, readiness, review, schedule, checked equipment, activity, accounts and test-center tools still call the original openLegacy routes. Required checklists, photos and signatures remain in the existing workflows. mHelp remains the service-job system.

## Exact runtime boundary

Added `src/ApprovedCheckManagement.tsx` and `src/approvedCheckManagement.css`; changed only one import and the disclosure wrapper tags in `src/TechChecksWorkspace.tsx`. Paths are under `tech-checks/operations`.

The source-reversal test reconstructs the complete original TechChecksWorkspace blob `0baffbb1b1583ce06626a20638ea9759d027df75`. The component does not clone or invoke child actions, call an API, store state outside the disclosure, or grant permissions. Styles are confined to the approved Owner hub, not the original technician forms or TV.

No camera/Fleet runtime, Board data, source readers, polling, timers, inventory assignments, provider links, authentication/session code, role grants, original host, backend, SQL, dependencies or lockfile changes. Existing shared navigation work still requires hunk-level reconciliation before a combined release; no other assistant's agreement is presumed.

## Verification and limits

Corrected candidate run `41496747542` at `b74699c6385ce8fa36c87ba9b39070654376cef4` passed 109 focused Node checks and 111 targeted full-application Playwright cases with no failures, skips or retries in those suites. Full TypeScript checking, original technician-authentication preservation, complete Vite build and independent source/build byte matching also passed.

Browser cases cover all 13 exact parent-navigation messages, 390/1024/1440 layouts plus 320-pixel checks, Escape/focus/Enter/Space, computed text contrast, and existing Board/Fleet/More paths. The original host integration suite verifies test-input retention, browser Back, scoped bookmarks and auth-change restrictions using the unchanged operations host with a synthetic test shell. Navigation labels and opening the already-approved management disclosure were adapted; host/input/history/role behavior assertions remain. The adapter reverses the whole test to original blob `e969fa255099463b0fc2547b2d7f7e8240b3ef2a`.

These are synthetic tests, not signed-in production acceptance or proof of current operational records. The isolated parent-message test is not itself the real host; that boundary is tested separately by the original host integration suite. No operational writes were submitted.

Corrected candidate ZIP artifact `13166447914` SHA256 `cbdbb6100838e82a9314938ff6dda6c7d0109bbe2ce47b36ec87492b8404970f` and blob receipt `13166343528` SHA256 `9779074ddb0869b4db35e9c7e2b76fa6a2d95fef866bdcce732f528eda2f8b24` were independently verified. All four staged contents match the local candidate hashes. The initial candidate passed its then-existing tests but failed visual contrast review; its screenshots are retained, not presented as the final design.

The original committed-artifact verifier correctly failed until the matching package was attached. It is not waived. Temporary staging created four hash-verified Git objects only (adapted host test and three generated entries), never a branch or deployment. Attachment uses an expected-head non-force update. Final exact-head validation must be read-only, without workdir patching or staging, and pass the original artifact gate.

The older full-suite design workflow also matched these source pushes and queued separate runs. Those are distinct from this targeted proof; neither their queued/running state nor these targeted passes establishes a complete regression pass. They were not represented as completed or green.

## Release hold

No PR, merge, preview or production deployment. Cloudflare excludes this design branch from previews. Board-to-exact-unit remains unavailable because the Board response lacks the authoritative equipment ID. Full regression review, live-role acceptance and active camera-repair reconciliation remain open. James's separate combined-release approval is required. Evidence packages exclude fonts, dependencies and credentials.
