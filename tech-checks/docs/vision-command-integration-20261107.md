# VISION Command integration — November 7, 2026

## Purpose and scope

Bring the VISION visual direction into the existing COS Operations application after PR361’s saved-reading reliability work. The tested baseline was PR361 head `f58b97c89b2f024ad146ebe867935aeb72b24a01` (tree `6773feeb055923d9e1ef06f50feb7ae53fbdc7c5`). During preparation, other active COS work merged PR361 and PR359 into main at `f27daa5eb8d5b88ac30792e0ca1f4a1a0ed6851d`. The GitHub comparison has no changed files and the exact tree matches that tested baseline. This integration therefore branches from the new main and adds only the reviewed VISION work.

The new Field briefing offers recorded-offline, needs-verification, and location-follow-up queues. Counts and rows come directly from the existing Product-ID model. The queue searches unit, exact Product ID, customer, and address; each row opens the existing verified unit/source/address drawer. It shows the canonical source observation time and keeps unknowns and identity holds separate from offline observations. Missing verified inventory shows unavailable counts. Failed saved reads can retain the existing presentation without changing observation times.

The layout uses navy and blue, responsive priority cards, keyboard-visible focus, evidence descriptions, and focus restoration after closing a queue. Existing TV layout, rotation, status colors, and authentication remain intact; its background surfaces receive the same visual treatment.

## Preservation boundary

`FleetDashboard.tsx` has exactly three declared changes: one component import, one styling class, and one presentation component insertion. The new source-preservation manifest reverses those exact changes and restores the protected original blob `9dbafecb1a18ee5d2d84f5083fd5124ecb18c2b4`. Existing protected baseline hashes remain unchanged.

The component introduces no network calls, scans, storage, polling, identity matching, source classification, or authentication behavior. mHelp Product IDs, Field/Shop placement, customer/address authority, tracker endpoint authority, and original source timestamps remain in the existing model. Shop/support equipment remain outside camera outage totals. Opening a briefing, queue, or unit does not trigger equipment checks.

## Native preview preparation

The reviewed production function is `cos-operations-pages` on native project `tughscoxralhofrckvxy`, v154 ACTIVE, archive `254594ed3300a84e9d5b1bc58afffb5ff1698d04fd3bf5c4c2d01d1018bb6d31`. Its two-file deployment imports the immutable `baf1418c6884e90cb9e9dd457b2f91dd7aafa8c0` recorded native source.

The integration preparer reuses PR361’s hash-checked `it-saved-fleet-actor-v154.json` recipe as the sole definition of the additive verified IT actor field. Its intermediate `serve.ts` hash is `d7d4d637eddab89a70afe452d0f1a8f668265320397215dd25c5be319709137e`. Two source edits convert the existing single temporary preview origin into an exact immutable-origin set, and two reviewed feature-gate edits enable the already-installed durable Fleet board for verified IT and authorized Owner sessions. Existing origin `a5f54cfd` and the existing expiry `2026-11-09T23:59:59Z` are retained.

The preview keeps the same authentication and the existing explicit saved-GET allowlist. Writes, unlisted routes, wildcard origins, branch aliases, and expired preview access remain rejected. Production `ALLOWED_ORIGINS`, role gates, schedules, database records, and all capabilities except `durableFleetBoard` are unchanged. The durable gate intentionally changes Fleet presentation behavior only: reopen restores the last completed server board instead of depending on the bounded browser full-presentation cache. The preparer verifies the current version/archive and the exact wrapper/config bytes before deployment; source drift requires a fresh review.

A release must retain the two-file immutable-import deployment pattern, verify its served wrapper/config, and verify the pinned source separately. The ordinary repository Edge Function directory is not the deployed native program and must not be substituted for it.

## Verification record

- TypeScript checking and the production build pass with the existing lockfile.
- 121 focused saved-reading, presentation, scheduling, session, Owner recovery, and source-preservation tests pass.
- 31 tests execute the original/composed native handlers with synthetic in-memory transport: 25 upstream identity/authentication tests and 6 composed preview/preservation tests. Ambient network and signing are forbidden in these tests.
- The initial UI run passed all 54 existing entry/reopen cases plus 6 new retained-reading/missing-source cases. Six additional queue cases first exposed a test count assumption (the census fixture contains 280 extra Field products). The final rerun passes all 21 selected cases: 12 VISION cases and 9 TV cases across 390, 1024, and 1440 pixels.
- Overview and expanded-queue screenshots at mobile and desktop widths were visually reviewed. Keyboard evidence descriptions, close-focus restoration, and clipped row focus outlines were corrected during review.

## Release boundary

Cloudflare preview uses the existing `cos-vision-integration-preview` Pages project and its existing committed static build. Production remains tied to main. The deployed VISION preview is https://9321842b.cos-vision-integration-preview.pages.dev/ at frontend commit `5bdd6d11ca0ebaca36d8ddf77654e97b6fa88f8b`, deployment `9321842b-6fcb-4386-babe-c3c2bc047da5` (Cloudflare deploy succeeded). The reliability preview is https://f1d53177.cos-vision-integration-preview.pages.dev/ at exact PR361 head. The prepared native artifact and hashes are under `vision-native-preview-20261107/`. The composed native suite passes against these exact two origins, alongside the unchanged original preview origin. Native deployment/readback and signed-in verification are recorded separately.

Real authenticated Owner/IT reopen and account isolation in the deployed preview remain the integration gate. Synthetic tests do not count as that live verification. No broad main merge, inventory repair, provider scan, credential change, or operational schedule change is part of this visual integration.

## Real-fleet reopen regression

James's November 7 phone trace restored compact counts (`Field 283 · Online 159 · Offline 2 · Unverified 39 · Shop 642`) and then blanked full Fleet cards to dashes. The full local presentation is capped at 4 MB; the existing production durable payload is about 9 MB for the real fleet. The v156 candidate therefore enables the existing durable board and adds a browser regression that deletes the full local presentation while preserving the saved summary, then requires the complete Fleet to restore from `/api/fleet-saved-board` without falling back to the legacy source reads. The database 10-minute `next_at` lease is unchanged.
