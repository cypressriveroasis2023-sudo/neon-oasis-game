# Inactive source placement

Apply `db/cos-inactive-source-placement.sql` to the native database only, after
the existing reviewed mHelp administrator importer. The patch adds a separate
private `cos_geocode_sources_admin_inactive_reviewed(uuid,jsonb)` entry point.
It preserves the original importer body, its creation-path hash gate, all reader
ACLs and the V1/V2 bridge contract. Application roles cannot call the new function.

The normal reviewed import shape is retained, with `placement: "INACTIVE"`,
`installation: null`, `addressSha256: null`, and these required source fields:

- `sourceStatus: "DO NOT USE"`
- `sourceFullLabel`: the entire target label followed by ` - DO NOT USE`
- `sourceObservedAt`: a finite, nonfuture ISO timestamp from the reviewed source

The native and tracker labels must be exactly equal. Site/customer display and
address component masks are forbidden on this inactive request. The immutable
source file and row hashes remain the provenance; retain the exact source record
and review evidence privately. This path does not infer an identity from a base
number, model family, address or provider name. A differing variant or qualified
family needs review and must remain held.

Before admission, independently re-read the full source/identity evidence and
current placement/GPS/audit records. Freeze the exact ProductId, target UUID,
complete labels, source hashes, previous source revision and current native guard.
Recheck that no newer manual/Owner instruction conflicts with the source. Legacy
and native systems are separate databases: the transaction does not lock legacy
history, and a fresh read after admission remains mandatory. Do not recalculate
an expected guard inside the apply statement to silently accept changed state.

Use a short READ COMMITTED transaction with lock/statement timeouts. A review
dry-run calls the same function and rolls back. Like every actual admission,
that dry-run may consume source sequence values, which are nontransactional;
never reset a sequence or cursor to remove gaps. Any row failure rolls back the
whole batch. Repeating an identical admitted record with its current source
revision produces no new source event.

Admission changes only the source-owned ledger. It emits the existing redacted
`tombstone` DTO/event, which retires that geocode binding through the existing
consumer without a provider request, cache purge, budget refund or cursor reset.
V1 ProductId and V2 tracker DTOs keep their existing wire shapes. The ledger row
stays active for display; its geocode eligibility is `tombstone`.

The effective map retains the asset in searchable inventory and shows
`INACTIVE / DO NOT USE` separately from field pins. It clears only effective
current address/pin presentation. Raw tracker/native inventory, historical
coordinates, provider activation, connection observations, camera identity and
health stay untouched. It never fabricates a Shop move, Owner audit or outage.
Current Owner placement, manual/verified GPS, installed sites and ambiguous
identity still take priority and hold the overlay. The legacy editor recognizes
the complete source proof and uses its existing authorized, confirmed placement
workflow for an intentional new deployment.

Verification includes the actual source readers/role denials, FIELD-to-INACTIVE
events, V1/V2 byte preservation, queue tombstones/budget preservation, projection
holds, current legacy editor evidence and searchable inventory presentation.
