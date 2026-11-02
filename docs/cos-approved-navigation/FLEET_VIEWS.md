# COS Fleet view grouping — design branch only

November 2, 2026. Existing branch: `design/cos-approved-navigation-20261101`.
Base: `730e78a3f51e33a7d9209578ccbf77684563c1b8`.

## Implemented

The approved Owner Fleet screen keeps Map and Fleet health visible. The existing Location verification, Needs setup and Data sources buttons move into a native More fleet tools disclosure. Its selected secondary view and original count text remain visible when collapsed. This is grouping, not deletion: original child buttons, eligibility, count expressions and tab callbacks remain in FleetDashboard.

Escape closes the disclosure and restores focus. Selecting a secondary button closes it. Phone controls wrap rather than requiring a sideways swipe. The original Jump to map button is repositioned below the tabs on narrow screens so it cannot cover the menu. Restricted IT keeps its existing direct tabs and eligibility.

## Scope and active-repair overlap

New runtime files: `ApprovedFleetViews.tsx` and `approvedFleetViews.css`. `FleetDashboard.tsx` changes by one import and replacing the nav opening/closing tags only. The explicit source-reversal test reconstructs the complete original FleetDashboard blob `497804d708b885789ab0dce6ee7af7c7c7e0e58e`. The earlier protected-file test retains all its original expected hashes; FleetDashboard is reversed through this exact wrapper helper before hashing.

This is a shared-file overlap with the camera repair/PR323. Reconcile the wrapper/import hunks against repaired code at combined-release review. Do not overwrite FleetDashboard wholesale. No agreement from another assistant is claimed.

No changes to health calculations, saved evidence, data sources, polling, timers, inventory, unit identities, camera/provider links, authentication, application permissions, original map dimensions, backend functions, SQL, dependencies or lockfile. No new ticket system or Board-to-unit inference.

## Verified candidate evidence

Candidate run `41484376105`, source `3f2c664285ed0b83126da9f5da8982dea131b2ed`, applies only the exact reviewed wrapper before testing. It passed 95 focused Node checks, full TypeScript checking, original technician-auth preservation, canonical full Vite build and independent local/hosted source/build hash matching. All 60 targeted full-App browser cases passed with zero retries, including 390/1024/1440 widths and extra 320-pixel checks.

Tests cover the native disclosure, keyboard focus, each original secondary view, existing IT restrictions, and Offline filter -> exact saved UUID -> recorded address and original camera observation -> Close. They use the existing synthetic same-origin parent/session and intercepted saved-read responses, not live operational records or signed-in acceptance.

Candidate artifact `13161801362` ZIP SHA256 `2c2b94eba1681f06f1b78566e6b5dfb5878e4d4669d71a07a709a86cef676545` was independently verified. The original committed-artifact verifier correctly failed before the matching package was attached; it was not disabled. Temporary staging created only four hash-verified inert Git objects, with no ref update or deployment: FleetDashboard wrapper, index.html, index-DH4U4k6b.js and index-CKRqGtUt.css. The connector attaches those objects separately with an expected-head non-force update. The attached head must pass the unchanged verifier in read-only final validation.

The local auth-preservation script requires Git history not included in the recovered archive; its successful hosted run is the authority. Screenshots are actual full-application test renders carrying a synthetic-data banner. No fonts, credentials or dependency packages belong in user evidence.

## Remaining release holds

The Board response still lacks the authoritative unit ID required for Board -> exact unit. This work verifies the existing Fleet -> unit path only. The original global browser run ended incomplete; the targeted pass is not full regression or production acceptance. Complete regression review, signed-in role acceptance and camera-repair reconciliation remain open.

No PR, merge, preview publication or production deployment. The design branch remains excluded from Cloudflare previews and commits retain hosting skip markers. James's separate combined-release approval is still required.
