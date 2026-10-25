# Indexed exact-address cache lookup

The existing address worker repeatedly normalizes historical addresses and scans
resolution candidates for each distinct Field address. On October 25 the scheduled
worker began failing with SQL 57014 at its historical candidate query (function
line 38), leaving the latest accepted source without its source-specific address
import. The census map correctly rejected that incomplete audit (40001). Saved
placement RPCs also returned intermittent 500s, and one scheduled inventory run
failed at `write` with an RPC lock timeout (55P03); correlation does not prove a
single root cause for all of those failures.

`db/mhelp-address-cache-lookup.sql` is a narrow native migration guarded by the
exact installed worker definition MD5 `01b92cbebfd923130a4985696310684e` and one
unique query anchor. It adds private immutable normalization-key helpers and two
lookup indexes. The candidate address set is the union of matching original
addresses and matching owner-corrected references. The original full normalized
address predicate, accepted-source/payload join, positive-status filter, evidence
priority/order, incomplete-address Product ID/customer/site checks, advisory lock,
source receipt, publication and role guards remain intact. A hash selects
candidates and cannot authorize reuse without the unchanged full predicate.

No source, equipment, GPS, history, grants, cron schedules, API timeouts or source
freshness limits are changed. The worker definition is replaced using its current
catalog text, preserving ACL, security mode and function configuration; exact
catalog readback is checked transactionally. Migration lock/statement bounds only
apply to the migration transaction. Do not reinstall the complete older worker
SQL over later changes, and do not directly invoke imports or clear caches to
manufacture acceptance. After normal review/gates, re-read the actual definition
before installing this delta. Recovery requires a normal scheduled address tick
and source/payload-specific import receipt, followed by ordinary saved map reads.

Focused PGlite tests run the existing safety cases against the indexed query,
exercise normalization/denied roles and deliberately collide lookup hashes. A
synthetic 1,001-product comparison (284 Field / 717 Shop; 109 distinct Field sites;
3,270 unrelated historical addresses) preserves the entire map result, including
original geocoding timestamps. One local sample measured 8,135 ms for the original
lookup versus 214 ms indexed. These are synthetic measurements, not production
recovery or a guarantee of future latency.

The dedicated hosted PostgreSQL 17.11 gate verifies the actual migration hash,
changed-definition rejection and rollback, exact catalog readback/config/ACL,
address reuse, returned-to-Shop scope, denied roles, advisory lock contention and
unchanged protected native data. It uses a fixed ephemeral loopback CI database.
