# COS redesign continuation — November 2, 2026

James authorized continuation of the recommendations in the current conversation, including a usable Cloudflare review preview. This supersedes the earlier source-only preview restriction for this review deployment. Production merge and release remain subject to his review.

The candidate continues the existing approved-navigation branch. Fleet, Boards, Tech Check, Team and More retain existing workspace routes and role checks. No app replacement, inventory movement, source reassignment, camera classification, backend function or database change is included.

## Corrections

- Attach the prior exact declared navigation test updates and scoped short-landscape CSS candidate to the branch instead of only testing an ephemeral patch.
- Correct Fleet test navigation to open the real disclosure before selecting a secondary control, then use visible accessible names. The earlier `includeHidden` lookup included hidden decorative icon text and failed exact/prefix name matching. Existing no-force-click and no-route-injection safeguards remain.
- Open the existing Board management disclosure before asserting that scheduling remains disabled after an unconfirmed save. Both disabled-state assertions and the one-write guard remain unchanged.
- Replace the temporary patch/staging workflow with ordinary exact-source verification, the unchanged committed-build gate, and affected browser suites. It has read-only repository permissions and performs no deployment or operational writes.

## Completed local verification before publication

- Node 22.16.0 and repository-pinned Chromium 134 / Playwright 1.51.1.
- Full TypeScript check and original technician-auth preservation check pass.
- Canonical full application build passes; the existing large-chunk warning remains.
- 172 focused navigation/Board/source-reversal/TV lifecycle tests pass without skips.
- 94 inactive exact-unit resolver tests pass without skips; the resolver remains inactive in production.
- Nine actual-application Fleet navigation/evidence browser cases pass across 390/1024/1440.
- A further affected browser run passes 81 cases, with 12 pre-existing skipped cases and zero failures/retries. This covers search, evidence, connection result boundaries, source review, mobile overflow and Board scheduling/readback.
- All 19 original browser sources reconstruct through the declared presentation/navigation reversal manifest. Protected application source differs only by the reviewed short-landscape CSS addition; camera data, backend, permissions and lockfile are unchanged.

A remaining affected-browser run and a broader unit run were still running when this checkpoint was prepared. They are not claimed as passed here. Final results belong in a follow-up verification record.

## Honest preview boundaries

The preview is for review of the existing frontend with its existing login. Synthetic test sessions do not establish signed-in Owner/IT/Service acceptance. Board-to-unit links appear only when the server supplies verified exact metadata; this continuation does not install that producer or invent relationships. Current production camera/inventory totals are not certified by frontend tests. Historical notes describing older holds remain historical records.

Cloudflare must deploy this exact branch as a nonproduction preview. Main and its canonical deployment, Supabase functions/data, mHelp/2027 authority and camera proof flags remain unchanged.
