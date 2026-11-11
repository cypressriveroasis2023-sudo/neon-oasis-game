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
4. Shards accept only those two values, and only on a shard call. The directive can stop reads; it cannot supply or vouch for an authority.
5. A refusal is authoritative over everything held. The saved-snapshot fallback no longer answers for a source that is refusing (the snapshot is dropped and the refusal is latched for the invocation), a read that was already in flight cannot restore the authority after a refusal, no ticket is issued after it, and a ticket issued before it cannot complete its re-check.
6. Each shard reports what its own authority concluded (`endpoint_authority` in its reply). When a shard reports `refused`, the parent sends that directive to every shard call it has not yet made, including retries.
7. The 503 label is bounded before it is read: a declared length over 512 bytes (or not a plain number) is not read at all, and an undeclared body is abandoned once 512 bytes have arrived.
8. Final write fence in the collector: immediately before `publish_camera_connection_v1`, the device's ticket must still stand for a current authority. If a refusal (or the two-failure limit) was latched while the TCP probe was in flight, nothing is written, the device is held as `endpoint_authority_unverified` and its previous result is kept. In v96 and in the earlier draft the health write happened first and only the later receipt was rejected.

Remaining window: the fence is checked in the function, not in the database. A refusal that arrives after the check, while the write request itself is in flight, cannot stop that one write. Closing that would need the database write to carry the authority generation, which is a schema change and is not in this draft.
9. Temporary failures behind the saved snapshot are counted. After two consecutive failed reads the source is not asked again in that invocation; the snapshot fallback keeps its 26-second limit and then the failure is reported, which blocks the authority.

Admission and write are both guarded: no ticket is admitted once the authority is blocked (item 2), and no health is written for a ticket admitted earlier (item 8).

Nothing is remembered between scheduled cycles. The next cycle asks once and resumes as soon as the inventory is current.

## Upstream calls, by scenario

There is no single limit. Each figure is endpoint-source calls for one scheduled cycle (parent plus four shards, two at a time, one retry each), measured by a test that runs the real handler or factory.

| Scenario | Draft | Why |
|---|---|---|
| Inventory stale when the parent prepares | 1 | parent asks once; every shard is told and reads nothing |
| Parent's read fails for a temporary reason | 2 | one read and its quick retry; shards are told |
| Healthy parent, then stale; shard replies arrive | 3 | parent 1, plus 1 from each of the two shards running together; later shards and retries are told |
| Healthy parent, then stale; every shard reply is lost | 9 | the parent can only pass on a refusal it has heard: 1 + 4 shards x 2 attempts, one call each. Worst case for a refusal |
| One invocation, healthy, then refused | 2 | the refusal is latched; no ticket is admitted and no health is written after it |
| One invocation, healthy, then temporary failures | 5 | 1 healthy, then two failed reads with one quick retry each; after that the source is not asked again in that invocation. The saved snapshot answers only inside its unchanged 26-second window |
| One invocation, failing temporarily from the start | 4 | two reads with one quick retry each |
| Healthy throughout | 5 in the test | parent 1, each shard on start; each shard also re-reads as its authority ages, as in v96 |

Not bounded by this draft: a cycle in which the source keeps answering successfully. That is normal operation and is unchanged.

## Not changed

The 26-second authority freshness limit, the 45-minute inventory freshness limit, product and endpoint identity checks, the hold for devices without a ticket, retained-claims and source-change checks, the shard count and shard retry, schedules, and all router, provider and Star4Live monitoring.

## Reviewing and testing

The deployed v96 source is not stored in this repository. With the exact file:

    COS_SWEEP_V96_SOURCE=/path/to/camera-health-sweep/index.ts \
      node --test --test-force-exit tests/camera-sweep-endpoint-authority.test.mjs

The test refuses any file whose SHA-256 is not `baselineSha256` in `recipe.json`, applies the recipe, checks `resultSha256`, then loads the whole result and runs the real handler, the real authority factory (`scheduledEndpointFromExistingCron`, including its snapshot cache) and the real reader. Only the platform edges are replaced: the database client, outbound `fetch`, the TCP connect and the clock. Shard calls are routed back into the same handler, so the parent and its four shards all execute. Without the file the tests are skipped. Server labels are covered in `tests/fleet-scheduled-reader.test.mjs`.

Cases covered on the real code: stale from the start; temporary failure in the parent; healthy parent then refused shards, with and without shard retries; healthy throughout; the next cycle and recovery; a healthy preparation followed by 20 refusals; a refusal racing a read already in flight (both orders); body bounding. The write fence is tested through the real factory, reader, producer and collector with a held probe: healthy (health written, receipt committed), refusal during the probe with the fence (no write, no receipt), and the same without the fence edit (write happens), which shows the reported race and that this edit is what stops it. The same harness run on unmodified v96 shows the fault.

Limits: the database, the network and TCP checks are stand-ins, so this does not exercise the Deno runtime, real timing or either project. One test replaces the device producer with a stand-in that uses its ticket the same way, to control the order of two overlapping reads.

## Order if this is ever deployed

Server label first (the v96 reader ignores the extra fields), then the sweep. An unlabelled server with the patched sweep is still bounded by the two-failure limit.

## Deployed source (added 2026-11-11 for release)

- `source/index.ts`: the recipe applied to v96 (SHA-256 `resultSha256` in `recipe.json`). This is the file the deployed function loads at a pinned commit.
- `source/v96/index.ts`: the unchanged v96 source (SHA-256 `baselineSha256`), kept so the previous version can be redeployed the same way.

Both were committed at the account holder's direction so the function can be deployed by pinned import like the other COS functions. Neither contains credentials; all secrets are read from the function's environment.
