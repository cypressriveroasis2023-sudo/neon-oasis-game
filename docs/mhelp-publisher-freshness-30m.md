# Bounded publisher evidence refresh and 30-minute inventory

An equipment comparison does not re-observe cached customer or site data. Keep
both resource observation timestamps and the publisher's 20-minute write gate.
The existing 165-minute cache remains useful for saved inventory reads.

After checking live Sheet identities/cells, the publisher queues only proposed
changes that would otherwise be writable except for stale source evidence. It
does not queue manual cell differences, ambiguous identities or pending writes.
The service-only queue is advisory and expires after two hours. The inventory
baseline selects at most six Product IDs, prioritizing older observations and
rechecking native guards and operational overrides. Inventory refreshes their
shared parent/site resources, with at most twelve forced resource requests,
and retains the two complete equipment comparisons. All source workers settle
before the lease can be released on failure. Failed/partial reads do not publish
new source evidence. The subsequent placement and publisher runs apply the
unchanged identity, lifecycle, native/manual override and exact-cell protections.

The queue does not repair or replace reviewed Sheet baselines. The completed
manual tracker reconciliation must remain untouched; manual differences remain
held until separately reviewed. Queue work is bounded, so a large backlog can
take multiple cycles. Existing cache refreshes still discover resource-only
changes without pretending every resource was read on every equipment pass.

## Release order

1. Pass exact-head normal checks, including real PostgreSQL and browser checks.
2. Inspect deployed closures; preserve unrelated modules and configuration,
   including any separately released PR #295 equipment-page implementation.
3. Install `tech-checks/operations/db/mhelp-publisher-freshness.sql` in the
   Tech Check project. Existing workers tolerate the extra baseline field.
4. Deploy the inventory source change, then publisher model/handler changes.
   Preserve runtime authentication and shared token/budget/backoff code.
5. In the original camera project, apply the guarded
   `tech-checks/database-maintenance/mhelp-30-minute-schedule.sql` artifact.
   It edits only three existing jobs: inventory :05/:35, placement :08/:38,
   publishing :10/:40. Existing cron timezone is GMT. Renewal and camera-provider
   schedules are untouched.
6. Read back schedules and observe complete inventory, placement and publisher
   receipts. Validate fresh source provenance, budget use, exception counts and
   actual readback for any naturally occurring eligible change. Do not generate
   a fake movement or overwrite held/manual rows to demonstrate success.

## Freshness and outage behavior

Inventory can be up to 30 minutes behind a new mHelp assignment. Publication
occurs only within the existing 20-minute evidence window, after the scheduled
fresh comparison; no-write intervals between cycles are intentional. A failed
cycle, budget refusal or provider cooldown leaves saved data dated honestly and
holds writes. Do not widen gates or rewrite observation clocks to hide outages.
Hourly token renewal remains independent. The twelve extra forced requests per
cycle add at most 576 requests/day at 48 cycles, still subject to the shared
4,800-admission cap and 200 essential reserve; those are local limits, not a
verified vendor quota. The 48-cycle synthetic fixture also includes ordinary
cache refreshes and both equipment passes, and must stay below 2,600 calls.

Rollback: restore the prior worker source and the previous three schedule
strings from the guarded artifact; do not remove pending publisher intents,
change credentials or delete saved source history. The advisory queue can expire
without affecting existing read/write authority. Do not deploy with failed gates.

## Production safe-update compatibility

The first publisher receipt after PR #298 failed at `finish`: production rejects
DELETE statements without a WHERE clause. Inventory and placement succeeded, and
the publisher transaction rolled back without changing Sheet baselines or
pending intents. The prior finish definition and publisher worker were restored.
The 30-minute schedules and successful inventory worker remain active.

Queue replacement now deletes only equipment IDs already validated into `seen`
by the current complete result set. It does not disable the safe-update guard.
Fresh installations use the corrected primary artifact. For the existing queue
after rollback, use `mhelp-publisher-refresh-safe-cleanup.sql`, then redeploy the
tested publisher worker after required checks pass. The repair refuses a missing
queue or an already-installed handoff. Verify a real scheduled finish receipt
before claiming the publisher repair complete; never reset tracker baselines.
