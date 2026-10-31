# Follow-up validation of PR323

James Martin remains the sole reviewer. No production merge or deployment is authorized.

The new unit-row surface overrode the existing selected-row highlight. The follow-up restores the established selected background and border tokens in the scoped preview CSS. The existing contrast assertion is unchanged. Authentication, data reads, health rules, timers and workflow configuration are unchanged.

Operations run [41166605735](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/actions/runs/41166605735) finished with failure at original preview head `4035edcabcf5bbf293b071b82e4626cb326c00be`. Its full browser step and publishing step were skipped after earlier failures. The independent PostgreSQL/reconciliation job passed. This is not a green-CI or production-readiness claim.

## Exact comparison

Base: `559f14d28b2ac9792626cd7c0c909bbca7c19a3a`. CI checked out merge `8021ae740b69a864091a5015f1b3a3b7d7a2a487`; its tree `47ca6df53cceccd20b6c3285e72cf7e4dfd3fb33` exactly matches original preview head `4035edc`. The served JS/CSS bytes match each commit. The targeted test bodies, fixtures, dependency lockfile and workflow are identical between base and original head. The only earlier test edit in this design PR is the intentional background-gradient expectation in `fleet-first-navigation`; it is not used to classify an inherited failure.

The normal Playwright runner works with isolated Node 22.23.4. Both variants used the checked-in 45-second test timeout, 10-second assertion timeout, one retry, two workers, and 390×844, 1024×900 and 1440×900 viewports. Local overrides select installed Chromium 154, local evidence paths, and the existing local static server. CI uses pinned Chromium 134/build 1161; its download was unavailable locally. This is a controlled local differential comparison, not identical browser-version execution.

All 36 base failures below match the CI error prefix exactly, across all three widths. They remain outside this presentation change. Exact errors, input hashes and bundle hashes are in [validation-comparison.json](validation-comparison.json).

| Test file / lines | Cases per width | Observed failure on both base and original preview CI |
|---|---:|---|
| `operations-session-recovery.browser.spec.mjs:100` | 1 | Unexpected `token-renewed` invalidation event |
| `saved-camera-refresh.browser.spec.mjs:52,78` | 2 | Expected online `1`, received `—`; expected unknown `1`, received `0` |
| `saved-camera-refresh.browser.spec.mjs:113,158` | 2 | Expected synthetic source-error wording; received the existing sanitized unavailable message |
| `tech-check-tv.browser.spec.mjs:89` | 1 | Expected old 15-minute camera caption; actual caption is 10 minutes |
| `tech-check-tv.browser.spec.mjs:440,455` | 2 | Expected two shared reads, received three |
| `tech-check-tv.browser.spec.mjs:528` | 2 | Late-proof scenarios retain `1 online` where the tests expect `0 online` |
| `verified-health-identity.browser.spec.mjs:182,213` | 2 | Expected one health/map read at the old cadence; received two |

The selected-row contrast test (`field-map-deep-link.browser.spec.mjs:266`) passes on base at all three widths and fails on the original preview at all three CI widths: this is the introduced UI regression corrected here. The original preview's normal local desktop sweep passed 200 of 211 cases; its 11 failures comprise that UI case and ten of the inherited cases above. A broad base sweep was stopped once terminal CI identified the exact targets, and replaced by the complete three-width comparison; its partial results are not counted as a completed suite.

The two retry-passing CI scenarios (TV geographic close-ups and shared-site popup pan restoration) passed on both base and original preview at all three widths. They are tracked separately from stable failures; one passing local attempt does not eliminate CI flakiness.

## Corrected bundle

The rebuilt preview passes all 42 focused normal-runner checks at all three widths, including the unchanged selected-row contrast test, Fleet navigation, dialogs, filters, failed-read/session clearing and the Owner briefing. No assertions were weakened. Typecheck, canonical build and the protected Tech Check/auth preservation check pass. The existing large-chunk build warning remains. The earlier full local unit suite passed 5,019 tests with zero failures and five skips; this follow-up changes one CSS rule, documentation and generated assets.

## Review access

Netlify canceled the original preview at deploy `6ae56766344492a750a1fe27`. Available tools cannot access its deploy log or retry mechanism, so the cancellation cause and a usable hosted preview URL remain unverified. An authorized Netlify operator needs to inspect that existing nonproduction deployment. No hosting configuration, permission, authentication or production fallback was changed. Existing labeled synthetic screenshots remain available in this folder and were recovered by the parent into Library.
