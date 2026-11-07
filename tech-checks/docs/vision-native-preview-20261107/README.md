# Exact native preview artifact

This directory contains the hash-verified v154 native source plus PR361’s additive verified IT actor field and two literal CORS edits. The temporary exact-origin set contains the existing preview, the current PR361 reliability preview, and the VISION frontend preview. The original expiry, saved-GET allowlist, custom authentication, capabilities, and production origins remain unchanged.

`manifest.json` records the source hashes, three reversible edits, exact preview origins, expiry, and associated frontend commits. `baseline-v154.json` records the existing immutable wrapper/config and their hashes. All seven dependency files are byte-identical to the recorded v154 source; only `serve.ts` differs.

The actual composed source passed 31 offline identity, authentication, preservation, CORS, mutation-denial, and expiry checks. Those tests used only synthetic transport. The exact-origin command was:

```sh
cd tech-checks/operations
COS_NATIVE_PREVIEW_ORIGINS='https://f1d53177.cos-vision-integration-preview.pages.dev,https://9321842b.cos-vision-integration-preview.pages.dev' node --import tsx --test tests/native-it-saved-fleet-actor.test.mjs tests/native-it-saved-readings.test.mjs
```

Deploy through the existing two-file immutable-import pattern. Pin this directory to its exact published Git commit in the wrapper. Re-read and validate the live v154 version, archive, wrapper, and config immediately before deployment. If they differ, stop and incorporate the newer native release. Keep `verify_jwt:false` and the unchanged `deno.json`; custom authentication remains in the handler.

After deployment, verify the served wrapper/config separately from the immutable source hashes. The connector’s served readback does not expose the remote bundled dependencies. Authenticated Owner/IT reopening and account isolation remain a real-browser verification gate. Preview access expires at 2026-11-09T23:59:59Z (November 9, 5:59:59 PM CST).

The candidate is prepared here; a subsequent deployment receipt records any deployment that actually occurred. No credentials, operational records, provider scans, schedules, or database changes are included.
