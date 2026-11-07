# Preserve completed Fleet presentations through verified Owner recovery

## Problem and scope

Baseline: `f27daa5eb8d5b88ac30792e0ca1f4a1a0ed6851d`, after PR361 and PR359 merged.

The API emits `cos-private-data-invalidated` when the parent supplies a renewed bearer or its handshake times out. The session controller already hides private content and can revalidate the identical Owner. The full Fleet presentation listener previously erased every saved presentation for either event, while the separate aggregate reading survived. A successful recovery could therefore reopen with only the dated totals summary and have to read all unit details again. A source outage during that read could produce partial counts or an empty board.

The loss is reproducible with the existing synthetic Product-ID fixture. It is a confirmed failure mechanism; it has not been established as the cause of every production reopen failure. Payload validation, browser storage failure, changed inventory authority and incomplete server responses remain separate possibilities.

## Change

`savedFleetPresentation.ts` now suspends both cache reads and writes during transient session revalidation. It retains existing bytes for `token-renewed` and `parent-timeout`. Hard, unknown and untyped invalidation events still erase them immediately.

`useOperationsSession.ts` releases the suspension immediately before publishing a freshly authorized session. During recovery, the existing controller first requires the same server-verified Owner UUID, role, legacy scope, mode and complete Boolean feature map. A rejected or changed session erases the retained presentation. No controller authentication rule has changed.

Normal `pagehide` still makes the current document terminal and hides private content. Its saved bytes may survive for a new document, which must authenticate afresh. A persisted `pageshow` continues to reload instead of reviving the hidden document. The `leavingDocument` guard prevents the new rejection cleanup from deleting the cache during every ordinary reload.

Original observation times, exact Product-ID/source-hash validation, size limits and credential-field stripping are unchanged. The patch does not substitute historical aggregate counts into a different inventory source. Request generation fencing, stale-response rejection and write-intent fencing remain in place. It adds no API calls, scans, probes, polling, database writes or backend configuration changes.

## Validation

- TypeScript checking and production build passed. The matching committed static entrypoint and generated JavaScript are included.
- 76 focused tests passed for full presentation validation, actor-scoped aggregate readings and session recovery.
- 162 existing API read-ordering, snapshot-retention and write-preparation tests passed.
- 13 new browser regressions passed at 1440 pixels. They use complete exact Product-ID evidence and verify retained bytes, hidden private content during a held session check, unchanged counts and timestamps after recovery despite failed source reads, and a subsequent normal reload with only a session request.
- The new cases also cover changed actor, permissions, role and mode; missing identity; an unauthorized or rejected verification; hard/untyped invalidation; a late verification after a security hide; and a temporary verification outage.
- All 40 existing session-recovery browser cases passed at 1440 pixels, including TV lifecycle, stale responses and unsent GPS write fencing.
- All 48 existing full-reopen browser cases passed across 390, 1024 and 1440 pixels, including verified IT identity, Owner controls, failed scheduled reads and cache invalidation.

Browser commands in this managed runtime used `PW_DISABLE_TS_ESM=1 node --import tsx node_modules/@playwright/test/cli.js`. The installed Playwright ESM-loader registration stalled under the runtime's Node 24; its supported loader-disable switch with the existing `tsx` loader allowed normal collection and execution. No dependency, lockfile or repository CI workflow changed. Runs used zero retries and synthetic routed responses; no real credentials or provider traffic were used.

## Release and remaining evidence

This is a frontend change based on the merged repair. It is independent of PR362's VISION Field briefing. Rebuild the static entrypoint if both branches are integrated; do not select a generated bundle from the wrong source tree.

Production acceptance must verify the deployed frontend and a genuine Owner recovery/reopen. The repair does not claim to resolve independent server response failures or full-cache persistence rejection. The existing aggregate-before-full-presentation save ordering also remains unchanged.

The tests prove that explicit hard invalidation erases saved presentations. They do not establish that every host sign-out emits that event before removing its iframe; actor-scoped keys still prevent a different verified account from restoring the prior account's presentation.
