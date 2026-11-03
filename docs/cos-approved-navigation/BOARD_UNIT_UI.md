# Conditional Board -> exact unit navigation

November 2, 2026. Existing design branch `design/cos-approved-navigation-20261101`; no merge or deployment. Base `b9d8a728f9212b204603f9a9ae5b46ed34e26973`; application change `cb5d5c7c7abdf93afdb0d30e2449a7857a49a144`.

## Implemented in the frontend

The existing Board work-details component now consumes optional server-produced `unitLink` metadata under `COS_BOARD_UNIT_LINK_V1`. Valid metadata renders an ordinary **Open unit** link using the existing Fleet hash and exact native unit UUID. The normal Fleet view remains responsible for current unit availability, location, camera evidence and access rules.

The consumer checks the selected Board-card identity, saved job ID, task/visit context, assignment and unit UUIDs, Product ID, source digest, source instants and their consistency with the captured Board snapshot. Missing, held, conflicting, malformed, future-relative-to-snapshot or unavailable-source metadata renders the original **Unit not linked** block unchanged. No label, IP, customer, tag or job-number matching occurs. There is no added clock, expiry timer, provider call, or polling.

Completed visits say **Open current job unit** and explain that the link is not proof of historical visit equipment. Product identity evidence time is explicitly not a camera check time. Existing assignment, workflow, notes, original job links and next-step information are preserved.

Runtime scope: new `src/ApprovedBoardUnitLink.tsx`, `src/approvedBoardUnitLink.ts`, plus one import and two wrapper lines in `src/BoardRecordDetails.tsx`. Reversing exactly those lines reconstructs original blob `b5b76d5312cffda72c6a6204560dab32044ef663`. Existing CSS is reused, including the 48-pixel link styling and focus indication. No other application runtime, backend, source readers, health logic, login, permissions, inventory or lockfile changed.

## Production boundary remains open

This frontend implementation does NOT enable the inactive server resolver or install its assignment SQL. It does NOT populate relationships, install an RPC, add a response field to production, or turn an mHelp equipment array into verified identity. No operational rows were written. Without verified metadata, production records would continue to show the original unlinked state even after a separately approved frontend release.

The previous read-only native Board finding (two native jobs and zero active primary assignments) is not a count of all mHelp service jobs. The deployed Operations entrypoint read during this continuation still obtains the Board from the native snapshot plus legacy queue enrichment; mHelp ticket-context/detail are separate routes. Repository `mhelpTicketDetail.ts` is a structural-evidence module and is not the same deployed ticket reader. Do not replace deployed backend code with it. Resolve the actual authorized job/equipment relationship and current server source before enabling the producer. mHelp remains the service-job system; no competing jobs are created here.

Backend integration must preserve the existing membership/job-view checks and tenant scope, reuse authorized saved identity/freshness decisions, and assemble link times coherently with the returned Board snapshot. A DTO contract string and UUID syntax are display validation, not authorization. No new Fleet fetch on each Board poll is introduced by this change.

## Executed candidate checks

Run `41517104585` at `72397335e5f6de8a45411a4d7e270e5e616ea9b2` passed:

- 240 focused Node tests: 115 existing navigation/Board/Fleet/Tech Check/Team checks, 94 unchanged inactive-resolver/SQL/route checks, 31 new consumer/component checks.
- 75 targeted full-application browser cases, zero failures or retries, across 390/1024/1440 and an additional 320-pixel check. Twenty-four exercise the new Board link; the others retain original Board actions, Fleet evidence and navigation assertions.
- Full TypeScript, original technician-authentication preservation and complete application build.
- Exact protected-source comparisons and independent local/hosted compiled byte checks.

The actual browser flow clicks a Board work record, opens the exact saved unit despite an unrelated display alias, reads its recorded address and original camera state/time, opens installation evidence, then uses browser Back to return to Boards. Other cases cover completed visits, related tasks, unavailable/held/mismatched/newer metadata, failed refresh, preserved saved notes, 48-pixel target, computed contrast and keyboard activation. Opening work details adds no Fleet reader. No operational writes are submitted. All responses use clearly labelled synthetic fixtures, not signed-in live Owner/IT/Service accounts.

Candidate artifact `13175409494` ZIP SHA256 `74af86fd7216a8a33028f196bbbf3bde4d7c325e80ac3f06b8b98e0c1708207b` and staging receipt `13176875207` ZIP SHA256 `a6db13f93b4f88a6e51f165ba807d0e35be68abe706aeadc8c5cc4261c72a791` were independently verified. Three package entries match local, hosted and staged bytes. Staging creates inert Git objects only; connector attachment uses an expected-head non-force update.

The candidate's original committed-artifact check correctly failed before matching build files were attached; it was not disabled or waived. Final exact-head verification must remove staging, rebuild the committed source and pass that original check. Candidate results alone do not claim the final check passed.

## Release hold

No PR, merge, preview or production deployment. The design branch remains outside Cloudflare preview allowlists. Actual production identity integration, complete/global regressions, live-account acceptance and reconciliation with Vision's camera repair remain open. Combined release requires James's separate approval. Evidence shared with the user excludes fonts, dependencies, credentials and trace archives.
