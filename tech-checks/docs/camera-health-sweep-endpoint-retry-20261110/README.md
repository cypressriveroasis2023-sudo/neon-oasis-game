# Camera health sweep: stop repeating endpoint-authority reads (draft, not deployed)

Draft for review. Nothing here is deployed, no schedule is changed and no database timeout is raised.

## What was happening

`camera-health-sweep` v96 (project `goqrnolcvqnirjmzaeyk`) reads its endpoint authority from
`cos-sheets-placement-publish/endpoint-source` (project `tughscoxralhofrckvxy`, v18), and every such read runs
`cos_mhelp_inventory_baseline`. While the accepted mHelp inventory was stale the source answered 503 to every
read, and the sweep kept asking:

- the reader retried every 502/503/504 once after 250 ms, including a refusal that could not change;
- `prepare()` resolves `false` on failure and never throws, but the parent only handled a throw, so it fanned out to four shards regardless;
- each shard built its own authority and ignored its own `prepare()` result;
- each device request without a current authority started another read, and a failed read never latched, so every wave asked again.

On 2026-11-10 that produced bursts of at least 13 endpoint-source calls in about a minute at each quarter hour, all refused.

## The change

Two files, both small.

**`cos-sheets-placement-publish` source** (`docs/fleet-scheduled-repair-20261104/source/trackerEndpointNativeSource.mjs`, the file the deployed v18 pins at `1ecf2da`): the 503 body gains a label. The two checks in `baseline()` map to `inventory_not_current` and `inventory_incomplete` with `retryable: false`; every other failure is `read_unavailable` with `retryable: true`. Status, message and every check are unchanged.

**`camera-health-sweep` v96** (`recipe.json`, exact before/after edits against the deployed file, SHA-256 pinned):

1. Reader: a labelled refusal is thrown as `native_source_refused_<code>` and never retried. Unlabelled 502/503/504 keep the one quick retry.
2. Authority object: a refusal blocks further reads for the rest of the invocation. Two consecutive failed reads for any other reason do the same. A blocked authority issues no tickets, so each device is held as `endpoint_authority_unverified` exactly as today, and prior results stay.
3. Parent: uses the `prepare()` result. On failure the fan-out still runs, because router, provider and Star4Live monitoring do not depend on the authority, but each shard is told `endpoint_authority: "refused" | "unavailable"` and makes no authority read.
4. Shards accept only those two values. The directive can stop reads; it cannot supply or vouch for an authority.

Nothing is remembered between scheduled cycles. The next cycle asks once and resumes as soon as the inventory is current.

## Upstream calls per cycle

| Situation | v96 | Draft |
|---|---|---|
| Inventory stale or incomplete | unbounded by design; 13+ observed | 1 |
| Source failing for a temporary reason | same | 2 (one read, one quick retry) |
| A shard called on its own, source failing | one read per wave, each retried | at most 4 |
| Healthy | parent 1, each shard on start and as its authority ages | unchanged |

## Not changed

The 26-second authority freshness limit, the 45-minute inventory freshness limit, product and endpoint identity checks, the hold for devices without a ticket, retained-claims and source-change checks, the shard count and shard retry, schedules, and all router, provider and Star4Live monitoring.

## Reviewing and testing

The deployed v96 source is not stored in this repository. With the exact file:

    COS_SWEEP_V96_SOURCE=/path/to/camera-health-sweep/index.ts \
      node --test --test-force-exit tests/camera-sweep-endpoint-authority.test.mjs

The test refuses any file whose SHA-256 is not `baselineSha256` in `recipe.json`, applies the recipe, checks `resultSha256`, and runs the reader and authority code lifted unchanged from the result. Without the file the tests are skipped. Server labels are covered in `tests/fleet-scheduled-reader.test.mjs`.

Limit of this draft: the parent/shard hand-off is exercised through a model with the handler's shape (parent prepare, four shards two at a time, per-device requests per wave) plus assertions on the patched handler text. The handler itself is not executed, because it needs the Deno runtime and both projects.

## Order if this is ever deployed

Server label first (the v96 reader ignores the extra fields), then the sweep. An unlabelled server with the patched sweep is still bounded by the two-failure limit.
