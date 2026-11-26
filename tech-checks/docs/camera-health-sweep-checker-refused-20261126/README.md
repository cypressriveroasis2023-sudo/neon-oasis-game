# Camera health sweep: do not write "offline" when the checker itself is refused

**Deployed 2026-11-26 18:39 UTC as `camera-health-sweep` v104** on James's go: a one-line
loader importing `source/index.ts` at commit `caa6d893e2d159c782e0407533535fe73f246cd4`.
Before that it was v103 (the loader in "Deploy and rollback" below).

## What was happening

Snipers and CAM Vs read Down in groups for one or two sweeps and then all came
back together. On 2026-11-26 eight Snipers read Down from 17:30 to 17:45 UTC.

The units were not down. The sweep runs as four shards (device id mod 4), each
in its own worker. In the bad runs, every unit in one shard that sits on the
AT&T cellular range was written offline with the same result:

- **every saved port answered "Connection refused (os error 111)"**, including
  the ports that had been open fifteen minutes earlier;
- all of them within **one millisecond** of each other, across different sites;
- a unit on another carrier **in the same shard and the same run answered
  normally**;
- the same units were open again on the next run, from a different worker.

A unit that is really down does not answer at all: its ports **time out** (that
is what a confirmed outage looks like in the same table). An instant refusal on
every port, for several units at once, comes from the worker's own network path
to that carrier, not from the units.

Seven days to 2026-11-26, sweep rows written offline for these units: 313.

| What the ports said | Rows | |
|---|---|---|
| Every port refused | 235 | all on the AT&T range; 234 in groups of three or more in one shard (37 group events, all four shards) |
| Every port timed out | 75 | real misses |
| Mixed | 3 | |

So three in four "offline" readings last week were this, not the units.

## The change

`recipe.json`: four exact edits to the source the live function loads (v103,
`docs/camera-health-sweep-endpoint-retry-20261110/source/index.ts` at commit
`91e8d52`, SHA-256 `385c4247…`). Result: `source/index.ts`, SHA-256
`0e85bc0fa172fd0d…`. Only `collectScheduledDirect` changes.

- In one run of the collector, endpoints whose **every** saved port answered
  "Connection refused" are counted (by address, not by unit).
- At **three or more**, nothing is written for those units in that run. Each is
  held with reason `checker_connection_refused`, exactly as the collector
  already holds a unit whose probe did not complete: its ticket is finished
  unverified and its **previous result stays**.
- One line is logged: `direct_sweep_checker_refused {shardIndex,shardCount,endpoints}`.

## Not changed

- A unit whose ports **time out** is written offline as before, and its miss
  count still goes 1, 2, 3 (confirmed outage at 3).
- One or two endpoints refusing on their own are written offline as before.
- A unit with some ports refused and some timed out is written offline as before.
- A healthy run writes exactly what v103 writes (compared in the test).
- No schedule, timeout, table, function signature, action value or allow-list
  changes. `checker_connection_refused` is a hold reason in the sweep's reply
  only; it is not a `camera_inventory_audit` action.
- Routers, the provider check and the Star4Live saved-port check are untouched.
  The Star4Live path also accepts "refused" as a completed answer and may have
  the same exposure; that is not addressed here.

## What the board shows after this

A held unit keeps its last reading. The board treats a reading as current for 45
minutes, so a shard that is refused once or twice in a row stays as it was; if
it were refused three runs in a row the units would read Not verified, never
Down. The cause (some workers cannot reach that carrier) is not fixed by this;
the sweep stops recording it as an outage.

## Test

`tech-checks/operations/tests/camera-sweep-checker-refused.test.mjs` applies
the recipe to the stored v103 source and runs the real collector from the result
(database client, TCP connect and console replaced). It covers: the fault on the
live source; a refused group held with nothing written; a unit on another path
written online in the same run; a timed-out unit still written offline beside a
refused group; one or two refusals unchanged; mixed errors unchanged; a healthy
run identical to v103; the hold applying inside one shard and across waves.

## Deploy and rollback

Deploy (after this directory is on `main`): a one-line loader, as v103 is today,
importing `tech-checks/docs/camera-health-sweep-checker-refused-20261126/source/index.ts` at the pinned commit that contains it.
`verify_jwt` stays off.

Rollback: redeploy the v103 loader unchanged (the same import it has now, commit
`91e8d520acf56e5bcfb2c7b7096826daa551cdca`,
`docs/camera-health-sweep-endpoint-retry-20261110/source/index.ts`).

After deploy, check the next two sweeps:

```sql
select public.cos_sweep_watchdog_recent_v1(3);
```

and that 34 of 44 are still published.
