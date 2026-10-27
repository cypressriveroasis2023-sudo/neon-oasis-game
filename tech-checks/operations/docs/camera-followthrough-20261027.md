# Saved placement reads and camera follow-up

This follow-up preserves the exact Product-ID camera rules released by PR #312.

## Saved placement read

Two production statement timeouts were recorded inside the full placement snapshot's return expression. The current snapshot already contains the prior materialization and set-based graph optimizations. They must not be reinstalled from older SQL.

The remaining reviewed CSV lookup is on this return path:

`cos_mhelp_placement_snapshot(uuid,uuid)` → `upload_snapshot()` → `shop_address_baseline(text)`.

The reader selects the latest CSV strictly earlier than the active source, ordered by `admitted_at DESC, source_sha256 DESC`. It validates that selected CSV afterward. It must never skip a conflicting or invalid latest CSV to find an older convenient match.

The measured production selection scanned 84 retained batches, accessed 1,303 shared buffers, and took 791.831 ms. Most retained receipt data is stored out of line; inspecting each JSON contract has substantial cost despite the small heap row count.

`db/mhelp-upload-prior-csv-index-install.sql` adds one nonunique partial B-tree index for that exact predicate and ordering. It changes no reader function, data, permissions, source guard, timeout, or schedule. Exact function, schema, and index fingerprints are checked, lock acquisition is limited to two seconds, and security metadata is checked before and after. The corresponding rollback script removes only the same fingerprinted index.

An index's existence is not proof of a performance improvement. Deployment acceptance requires an unforced production query plan using the index and a new measured saved read. An index cannot guarantee that every future request will avoid timeouts caused by other workload or service failures.

## Camera follow-up

The existing per-product evidence panel and Field CSV now describe the responsible role and a next step derived from known source reasons. The helper does not change classification, totals, observation times, permissions, or source evidence. A broad Unknown check result receives broad guidance; it does not invent a stale, routing, or configuration diagnosis.

Support equipment remains outside camera outage totals. A known independent identity or endpoint-ownership hold may still receive review guidance, without creating a camera outage or treating missing camera checks as support-equipment work.

## Release compatibility and rollback

This frontend remains compatible with the existing `cos-operations-pages` version 127. The index is an independent read-performance improvement with an unchanged API contract; either publication order is compatible. No Edge Function redeployment is needed.

Before applying the index, refresh its guarded catalog and preserve the previous frontend artifact and SQL rollback. After merge, verify the published commit and the bytes actually served by Pages. Read back the index fingerprint and unchanged reader/function security settings. Use protected saved production reads and separately record any actual Owner/IT live-screen checks. Fixture browser results alone do not prove an authenticated production session.

If rollback is needed, use the guarded index rollback and restore the previous reviewed frontend through the normal repository publishing process, after reconciling any later work. Do not restore an older backend over newer runtime changes.
