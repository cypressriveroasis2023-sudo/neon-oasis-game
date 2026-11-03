# COS Team — open the exact existing saved job

November 2, 2026. Existing design branch: `design/cos-approved-navigation-20261101`.
Starting head: `0a5bd8f612924b761466dff5dfc95130fc74d0c6`.

## Programmed behavior

Assigned job numbers on Team now open their exact existing job records through the original Jobs route. The link uses only the saved job UUID supplied by the existing response. Two jobs with the same displayed number retain different links. Missing, malformed and all-zero identifiers are never converted into guessed links; the presentation says **Job link unavailable** where the original Team reader accepts a record without a usable link. The original malformed-response error state remains unchanged.

Links have readable red/white styling, visible keyboard focus and a minimum 48-pixel touch height. There is no new job creation, assignment change or equipment lookup. This is Team -> existing job, NOT Board -> camera unit. mHelp remains the service-job system.

## Source boundary

Only four runtime files change: new `ApprovedTeamJobLink.tsx`, `approvedTeamJobRoute.ts`, `approvedTeamJobs.css`, plus one import and the job-number presentation substitution in `TeamWorkspace.tsx`. Paths are under `tech-checks/operations/src`.

The source-preservation test reverses these exact two Team edits and reconstructs original blob `b04caf1a76ec44ba22b09e914f59c3c2808b6ab4`. Existing readers, assignments, counts, filters, readiness, last-successful-data warning and record limit remain untouched. Canonical route parsing, Jobs behavior, camera/Board/Fleet logic, host, session/authentication, permissions, timers, inventory, backend, dependencies and lockfile are unchanged.

TeamWorkspace overlaps with earlier navigation work/PR285. Reconcile only the import and job-label hunk against the active repair's reviewed head; do not overwrite the shared file wholesale. No other assistant's agreement is claimed.

## Candidate evidence and validation limits

Candidate run `41503891183` at `e12e279e029644e520378b8e785747e8b0c4d5ad` passed **115 focused Node tests**, **36 targeted full-application browser cases**, and **3 unchanged original Team roster/readiness cases**. There were zero failures, skips or retries in those passing suites. Full TypeScript checking, original technician-authentication preservation and canonical Vite build also passed. The 39 browser cases cover phone/desktop widths 390/1024/1440 and an additional 320-pixel geometry/contrast check.

New tests exercise duplicate labels with distinct UUIDs, normal click and keyboard activation, browser history return to Team, invalid/missing IDs, failed refresh warnings, unchanged filters/assignment counts, touch targets and computed contrast. Requests are intercepted with synthetic records and a synthetic same-origin parent/session. They are not live Owner/IT/Service acceptance. No operational writes are submitted. The original Team roster/readiness test and existing navigation tests remain unchanged.

The first candidate run `41501551514` failed 18 new browser cases because the new member locator was incorrectly nested; existing navigation cases passed. Run `41503053606` then passed 33 of 36 cases; the remaining three timed out waiting for a top-level load event after iframe history had already returned to Team. Failure screenshots show Team. The corrected test calls actual browser history Back and asserts the Team hash plus original records, without injecting a URL or bypassing routing. Required outcomes were retained and strengthened with the exact return-hash assertion; no runtime change was made for either test-harness correction. Failure logs are preserved.

Candidate artifact `13170202186` ZIP SHA256 `dec5efb2748e0a44cf36d4714cc21daf687968bbd68b2c882cc0e74fe96542a9` and receipt artifact `13168989763` ZIP SHA256 `f1a9c2c1c052dd610452e1addd378036e5ceca0e4a1735cf104a9c065bbda037` were independently checked. The three generated entries match local, hosted and staged hashes: `dist/index.html` blob `87876adcdf4a882b27922736c2732942b627d217`, `index-B_VwSvln.js` blob `1a4a7ab38f76fd32af9671afe7c33525f26cef7a`, `index-F2oU6lyH.css` blob `bfe5280b4b2582cbbf68151cf16dd8b93700c557`.

The original compiled-artifact verifier correctly failed before those generated files were attached. It was not disabled or waived. Staging created only three verified inert Git objects; the connector attaches them with an expected-head non-force update. Final attached-source validation must be read-only, without workdir patching or staging, and pass the original unmodified artifact gate. Candidate test success alone is not that final result.

## Release hold

No merge, PR, preview or production deployment. The design branch remains excluded from Cloudflare previews. Board-to-exact-unit identity, complete regression review, live-account acceptance and reconciliation with Vision's camera repair remain open. Targeted tests do not establish global production readiness. A combined release requires James's separate approval. User evidence excludes fonts, dependencies and credentials.
