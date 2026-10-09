# Field View rollback and router sweep coverage

The production Field View handler uses `importedSourceProjectionV2.ts`, the
verified reader from the production rollback. Keep the V3 candidate and its tests
available for review, but do not route production map reads through it until its
database rollout and live map check succeed. This does not change stored sources,
sites, coordinates, placement history or technician permissions.

Router `batch_size` now limits concurrent probes rather than the number of records
checked. The sweep visits every due router within the existing 48-second window,
using only its saved public IPv4 and management port. Results still require the
original configuration and timestamp to match at publication. A changed record,
invalid endpoint, truncated inventory or expired deadline stays unverified.
Unfinished records remain due for the next run. The existing cron authentication
and schedule are unchanged.

The existing camera sweep metadata includes `router_coverage` with total, due,
scanned, published, unverified and deferred counts. Router evidence expires after
20 minutes, allowing the existing 15-minute schedule plus five minutes of jitter.
Imported provider status cannot replace a live router probe.

Verification: the actual handler tests cover all 188 synthetic routers, bounded
concurrency, technician changes during checks, deadlines, invalid endpoints,
inventory truncation and unauthorized calls. Map and technician access use the
existing application regression suite. Authenticated production browser checks
are a separate release verification step.
