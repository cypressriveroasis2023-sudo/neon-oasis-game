# Audited router-reference corrections (camera project) — NOT INSTALLED

**Status:** built and tested on a branch. Nothing installed. No router record changed.

## Why
`public.camera_unit_routers` (camera project `goqrnolcvqnirjmzaeyk`) has no router-serial
field, no A# link, no history table and no change trigger. Today its writers are:

- `camera-health-sweep` — status fields only (`current_status`, `last_checked_at`,
  `last_online_at`, `reported_latency_ms`, `updated_at`); never an address.
- Direct table edits by an active Owner login (row-level policy). Nothing records the old value.

## What this adds (alters no existing object)
- `public.camera_unit_router_corrections` — append-only receipts (update, delete and
  truncate refused). Each holds the full prior row, old and new address, router serial,
  A#, COS unit id, provider, source, reported status, observation time, approver,
  approval source and reason.
- `public.camera_unit_router_correct_v1(...)` — the only supported correction. Service role only.
- `public.camera_unit_router_revert_v1(...)` — reversal as a new receipt.

## Guards (any failure writes nothing)
1. Record id and unit key are the ones reviewed.
2. Current address still equals the reviewed old address.
3. The record has no `unit_ip` (its meaning is not established; such rows are refused).
4. No other router record holds the new address in either IP field.
5. Provider observation is no more than 24 hours old and no more than one minute ahead of the
   database clock (the minute is tolerated clock skew between reader and database).
6. The serial is not already recorded against a different router record.
7. A correction or reversal id cannot be reused: a repeat is a no-op only when the entire
   reviewed payload is identical (record, unit key, addresses, serial, A#, COS unit, provider,
   source, status, observation time, approver, approval source, reason).
8. Only the latest correction still in effect for a router record can be reversed.
9. `service_role` can read receipts but cannot insert, update, delete or truncate them directly,
   even though production default privileges would otherwise grant that and it bypasses RLS.
10. No API role can read or move the receipt identity sequence (`setval`, `nextval`, `currval`);
    receipt order decides which correction may be reversed.

## What a correction changes
Only the named router row: `router_public_ip`; `reported_status`, `status_source`,
`status_observed_at` (the provider's report); and it clears COS's own probe result
(`current_status='unknown'`, `last_checked_at`, `last_online_at`, `reported_latency_ms`
to null) so a result measured against the old address is never shown for the new one.
The next health check finds the row due and writes its own result.
It never reads or writes camera, SIM, placement, activation or monitoring data.

## Known limits
- Owner direct edits to the router table remain possible and unrecorded. Closing that
  would mean altering the existing table (a trigger or policy change) — not included.
- Tests use a substitute table built from production's column types, defaults, checks
  and indexes. Local PostgreSQL is 16; production is 17.6.
- The receipt records the unit-to-router evidence it is given; it cannot verify it.

The deployed health sweep's compare-and-set save (id, unit key, `updated_at` and all three
endpoint fields must still match) is what stops an in-flight probe of the old address from
writing after a correction.

## Candidates on 2026-11-11 (read-only production precheck, 5:50 PM CT)
| Router record | Old → new | Guards today | Review status |
|---|---|---|---|
| #182 SOLARSPOTTER 053 (A#2300342) | 166.168.147.21 → 38.246.194.11 | pass | VCC screenshot pending Vision's inspection |
| #79 SPOTTER 185 (A#2257840) | 166.203.205.83 → 38.246.195.93 | pass | added for SS019; needs approval |
| #150 SOLAR SPOTTER 019 (A#2258996) | 166.203.204.28 → 166.203.205.83 | refused: #79 holds the address | after #79 |
| #14 RANGER 024 (A#2289749) | 166.203.204.120 → 38.246.195.69 | refused: has a unit IP | on hold |

Duplicate #218 SOLARSPOTTER 019 is left untouched. SS006 and Spotter 263 are on hold.

## Install order (only after approval)
1. Run `20261111_router_reference_corrections_precheck.sql`; every flag must pass. The precheck
   covers schema compatibility and four per-candidate guards only (identity, old address, unit IP,
   address held elsewhere) — not observation age, serial uniqueness, replay or reversal rules.
2. Run `20261111_router_reference_corrections.sql`.
3. Re-read each router live in InHand; call the correction with that reading and time.
4. Read back the receipt and the router row; confirm camera rows are unchanged.
Stop on any mismatch. Rollback of a correction is the revert function; rollback of the
install is dropping the two functions (the receipt table stays as the record).
