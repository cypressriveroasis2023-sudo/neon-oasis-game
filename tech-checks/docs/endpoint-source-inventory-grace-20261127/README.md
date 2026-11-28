# Camera checks keep the last good mHelp inventory for 24 hours, and a customer name alone no longer holds a Sniper

**Prepared, not deployed.** Operations (`tughscoxralhofrckvxy`), edge function
`cos-sheets-placement-publish`, live **v24** (`ffaf4c17…`, a one-line loader pinned to
`d962b03`, `tech-checks/docs/fleet-scheduled-repair-20261104/source/serve.ts`).
Deploying needs James's go.

## Why

27 Nov 2026: mHelpDesk rejected the saved authorization at 08:01 UTC. The accepted
inventory stopped being "current" (last successful sync over 45 minutes old), so
`/endpoint-source` answered 503 `inventory_not_current` from 08:45 UTC and the camera
sweep held all 44 Snipers / CAM Vs until James reconnected at 21:08 UTC: 12+ hours with
no checks. mHelpDesk has cancelled the token 9 times in 30 days.

## The change

Only `/endpoint-source` (what the camera sweep reads):

- accepts the last accepted inventory while its last successful sync is **up to 24 hours**
  old (was 45 minutes); older than that is refused exactly as before;
- adds `inventorySyncedAt` and `inventoryCurrent` to its answer (the sweep ignores extra
  fields) and logs `Endpoint source using last accepted mHelp inventory` with the age and
  mHelp's error code on every read made in that window.

Also (added later on 27 Nov, James's go): a `customer_mismatch` review reason alone
no longer stops a check. It held SNIPER 227 and 328 (moved to AT&T sites after the 2027
tracker's 4 Nov mHelp copy) and 2-347 / 2-348 (customer respelled in mHelp) on every run.
The tracker IPs for all four match `camera_devices`, and no other unit shares them.
Placement, identity, tracker-restriction and binding reasons, and every hold, still stop it.

Unchanged: every other inventory check (complete, reviewed, sync enabled, membership,
not in the future), the tracker read, holds, the publisher, and `/camera-snapshot-source`
(still 45 minutes). Placement and IPs come from the same inventory and tracker as before;
the only risk is that a unit moved Field↔Shop in mHelp during the outage is checked by
its old placement for up to a day.

`source/serve.ts` is v24's `serve.ts` with its two other imports pointed at `d962b03` by
URL, so the publisher and helpers are byte-for-byte live v24. `source/trackerEndpointNativeSource.mjs`
is v24's reader plus the edits above (test 7 in
`tech-checks/operations/tests/endpoint-source-inventory-grace.test.mjs` undoes them and
compares against the v24 file).

## Deploy (after James's go)

Deploy `cos-sheets-placement-publish` with `verify_jwt` false, import map `deno.json`
`{"nodeModulesDir":"auto","imports":{"jose":"npm:jose@6.2.12"}}` and `index.ts`:

```ts
import "https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/<merge commit>/tech-checks/docs/endpoint-source-inventory-grace-20261127/source/serve.ts";
```

Check: the next sweep (:00/:15/:30/:45) publishes as before; function logs show no
`Scheduled endpoint source failure`.

## Rollback

Redeploy the v24 loader:

```ts
// Immutable tested scheduled-reader repair. Existing publisher authentication,
// staged writes, double reads, readback and diagnostics are preserved.
// Merged PR #375: a refused endpoint-source read says whether retrying can help.
import "https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/d962b033234d11a81ada3585725fea9f63749d86/tech-checks/docs/fleet-scheduled-repair-20261104/source/serve.ts";
```
