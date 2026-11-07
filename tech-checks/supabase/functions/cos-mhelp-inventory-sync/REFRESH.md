# Bounded customer/site evidence refresh (draft, not deployed)

The normal inventory cycle can complete using cached customer/site resources
whose observation times are older than the Sheets publisher freshness limit.
The publisher's refresh queue only contains eligible movements; unchanged or
identity/manual-held rows do not enter it merely because their evidence is old.
Do not populate that queue artificially or change observation times/TTL.

This patch adds `action: "refresh"` to the existing backend-only inventory
endpoint. It uses the existing cron authentication, read lease, provider
connection, backoff and request budgets. Browser requests remain rejected.
No new credential or permission configuration is needed.

Example shape (synthetic ID; replace only after reviewing the exact baseline):

```json
{"action":"refresh","equipmentIds":["1"],"sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
```

Requests require 1–6 unique exact Product IDs and the current accepted source
SHA. Selection rejects missing/duplicate identities, renamed or inactive
products, lifecycle flags and existing source holds. It forces the selected
customers and complete site membership pages through the existing validated
cache reader, with the existing maximum of 12 forced resource paths. Shared
customer resources can cover additional products; they do not grant binding
eligibility. Equipment is read completely before and after resource reads.

Success requires complete validated source evidence, fresh customer observation
receipts and, for Field products, fresh verified site membership receipts.
Cached dates cannot be relabeled fresh. Provider failure, membership mismatch,
equipment drift, exhausted budgets or incomplete evidence cannot return a
successful receipt. Workers finish before releasing the lease.

Side effects are ordinary resource cache writes, read lease acquisition/release,
and the existing connection's routine renewal/backoff bookkeeping. The action
does not stage or accept source records, modify inventory/bindings, enqueue
publisher candidates, or write Sheet cells. The existing cache records retain
provider observation provenance; the response provides a bounded receipt for
review. It does not add a durable request audit table.

After a separately verified deployment, a protected refresh request can obtain
fresh evidence. The normal inventory and placement cycles must still accept
that evidence through their existing guards. Re-read source and Sheets twice,
regenerate the binding manifest, compare exact IDs and dependencies with the
reviewed scope, and obtain approval before applying any bindings. Refresh
success is not proof of binding eligibility or a confirmed customer outage.
Do not batch the historical 257-row proposal into production automatically.

## Preservation and release conditions

Read-only inspection on 2026-10-25 matched all 11 deployed v18 inventory closure
files to main `6e252ee13daa3bab867240598ab14535f5e1d71c` (only terminal newlines
normalized). This patch changes inventory index/source/serve and adds the
manualRefresh module; shared token and authorization modules remain unchanged.
PRs #301 and #225 do not modify these inventory files. Their Camera Health
reconciliation remains separate and blocked by the v121 release hold.

Do not rebuild/publish the production operations bundle from main: production
v121 contains indexed lookups and currentTrackerShopScope/preflight changes
not yet reconciled into a verified complete source closure. Its inspected
bundle SHA256 was
`8ce24b10e02de6155abe96a52e5bb156375cd0242af523162e9c1873113edba8`.
This draft authorizes no deployment, merge, inventory or binding application.
Reverify deployed closure and exact-head CI before any release consideration.

## Validation

`operations/tests/mhelp-manual-evidence-refresh.test.mjs` exercises authentication,
request bounds, source/identity holds, genuine cache replacement, partial
provider failure, membership failure, equipment drift, lease release, normal
cached behavior, unchanged rows and independent publisher manual/identity holds.
All fixtures are synthetic. No live provider refresh was executed by these tests.
