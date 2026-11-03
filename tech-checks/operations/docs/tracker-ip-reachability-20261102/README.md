# Owner-authorized tracker-IP reachability

James explicitly directed: “whatever is stopping this from being complete,
please remove it or turn it off so we can put what’s in the field in the COS
and verify by pinging it.” The preceding manual Avigilon report is testimony,
not relabelled automated evidence. This change removes native equipment UUID /
physical camera membership as a prerequisite for network reachability only.

## Behavior

- Exact mHelp Product ID and current complete V2 2027 tracker IP census define
  the target. mHelp still supplies Field/Shop and customer/address.
- Read actual saved TCP/service-port results for enabled active configurations
  at that IP. Every enabled configuration must have complete, fresh, matching-IP,
  matching-revision checks. A valid response is Online; complete valid no-response
  is Offline. Partial, technical-error, stale and unrun checks remain Unknown.
- Multiple saved records at one uniquely assigned tracker IP are check profiles
  for that target, not extra fleet units or a camera/channel count. Disabled old
  configurations cannot veto a current enabled check and cannot supply evidence.
  Preserve the oldest covered observation time; never renew it on read.
- Native UUID, serial, provider/channel approval and Product-to-camera membership
  are not required for this reachability result. The original strict
  buildExactProductConnections function still requires them and is unchanged in
  behavior. Camera identity, video and recording remain separate claims.
- Source/lifecycle/placement/identity holds, current source hashes, duplicate
  Product IDs, invalid/missing IPs, cross-Product Field/Shop ownership and archived
  IP holds remain enforced. No inventory or registry rows are fabricated.

## Matched native package

Base: ACTIVE cos-operations-pages v138, archive
24716983d4df4b271ae0abc2b191a1437528079cda372ba5d912f439d086474c.
Preserve the approved archive reader and exact preview access correction.

The isolated overlay adds buildTrackerIpReachability to productTcpRuntime.ts;
all previous exported function bodies remain byte-identical. Two exact edits in
serve.ts switch only the saved product-connections GET evaluation to this new
reader and include activationState in its endpoint configurations. No origin,
authentication, role, write route, producer flag, credential, placement or polling
change. The three other function files remain byte-identical. GET issues no live
probes. Existing scheduled checks and Ping/Scan tools supply the saved evidence.
This package does not add a new Product-ID Ping button or open preview POSTs.

Prepare against a fresh captured function, from tech-checks/operations:

```sh
node scripts/prepareTrackerReachabilityRuntime.mjs current-native.json candidate-native.json
```

The pure preparer performs no network/deploy operation and rejects any base
version/archive/configuration or file hash drift. Deploy only the matched five
files with serve.ts entrypoint and deno.json import map, retaining verify_jwt false
and the existing in-function authentication. Never deploy repository index.ts.

## Verification completed before deployment

- 64 focused checks pass locally on Node 24.22.1: original strict attribution,
  new reachability, tracker census, approved archive behavior and native packages.
- Operations typecheck/build and original committed frontend-byte/lockfile gate
  pass. No frontend artifact is included in this backend change.
- Full prepared native function compiles for ES2022 with unchanged deno.json
  jose mapping external to the local syntax check; zero warnings.
- Five-file forward preparation and simulated v139 rollback restore the exact
  original v138 contents. Native tests cover original exports, isolated new
  export, exact patch/reversal and unrelated drift rejection.
- Independently read actual saved source replay: 925 products, 286 Field,
  39 completed Online tracker-IP results, and Sniper148/Product1287578 Online
  from saved resource536 at its original check time. Replay still holds missing,
  stale or conflicting evidence. This replay includes support equipment in its
  Field population; it is not the final displayed camera-only live count.

## Rollback

Freshly capture the deployed candidate and run:

```sh
node scripts/prepareTrackerReachabilityRuntime.mjs deployed-native.json rollback-native.json --rollback
```

Every candidate file must match the pinned after hashes. This restores only
the two edits/overlay and returns all five contents to v138, retaining the archive
reader and preview access. Do not overwrite unrelated later changes. No data,
tracker, registry or producer-flag rollback is needed.
