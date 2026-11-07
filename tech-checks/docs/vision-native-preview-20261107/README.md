# Exact native preview artifact

This directory contains the hash-verified v154 native source plus PR361’s additive verified IT actor field, two literal CORS edits, and two reviewed durable Fleet session feature gates, for verified IT and authorized Owner accounts. The temporary exact-origin set contains the existing preview, the current PR361 reliability preview, and the VISION frontend preview. The original expiry, saved-GET allowlist, custom authentication, capabilities, and production origins remain unchanged.

`manifest.json` records the source hashes, five reversible edits, exact preview origins, expiry, durable-board gate, and associated frontend commits. `baseline-v154.json` records the existing immutable wrapper/config and their hashes. All seven dependency files are byte-identical to the recorded v154 source; only `serve.ts` differs.

The actual composed source passed 31 offline identity, authentication, preservation, CORS, mutation-denial, and expiry checks. Those tests used only synthetic transport. The exact-origin command was:

```sh
cd tech-checks/operations
COS_NATIVE_PREVIEW_ORIGINS='https://f1d53177.cos-vision-integration-preview.pages.dev,https://9321842b.cos-vision-integration-preview.pages.dev' node --import tsx --test tests/native-it-saved-fleet-actor.test.mjs tests/native-it-saved-readings.test.mjs
```

Deploy through the existing two-file immutable-import pattern. Pin this directory to its exact published Git commit in the wrapper. Re-read and validate the live v155 version, archive, wrapper, and config immediately before the v156 durable-board deployment. The preparer pins v155 archive `9065cf46375d02eb339504dd4d559a95e9e8312eb472b57b1223076f21921121` and its exact immutable wrapper. If either differs, stop and incorporate the newer native release. Keep `verify_jwt:false` and the unchanged `deno.json`; custom authentication remains in the handler.

After deployment, verify the served wrapper/config separately from the immutable source hashes. The connector’s served readback does not expose the remote bundled dependencies. Authenticated Owner/IT reopening and account isolation remain a real-browser verification gate. Preview access expires at 2026-11-09T23:59:59Z (November 9, 5:59:59 PM CST).

The candidate is prepared here; a subsequent deployment receipt records any deployment that actually occurred. No credentials, operational records, provider scans, schedules, or database changes are included.

## Durable Fleet restore

The real Owner phone trace showed the compact saved counts survive while the full browser presentation can exceed the 4 MB local-storage guard. The durable Fleet payload is server-side and is already scale-tested at 925 inventory records / 739 resources. Enabling `durableFleetBoard` makes reopen read that last completed board. The existing database lease remains authoritative: a normal read starts a new background batch only when `next_at` is due (10-minute cadence), and returns the previous completed board immediately while that work runs. Manual refresh remains the explicit forced path.
