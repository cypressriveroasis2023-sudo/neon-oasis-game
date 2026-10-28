# Narrow v127 native-alias read CPU candidate

Local candidate based on main `c5346bec1a625c64b97444a492e993eef2737459`. It changes only `nativePlacementAliases` in the backend placement projection. It does not change frontend behavior, SQL, credentials, permissions, schedules, source protections, provider calls or the publisher candidate. PR311 and its release holds remain separate.

## Evidence and limits

Release QA supplied two ordinary authenticated read failures after PR314: HTTP546 at 2026-10-28 19:55:14.137 UTC and 19:56:41.870 UTC, with function v127 shutdown logs explicitly reporting `CPUTime` at 2014 and 2001 ms. The outer POST envelopes do not establish an internal API path. A later Dispatch/TV read succeeded. These establish intermittent Edge CPU exhaustion; they do not identify a SQL timeout or prove a particular projection caused those two failures.

One authorized read-only function-source capture confirmed v127. No live full-fleet request was made for this work. The captured source has the same native-alias helper as the main source: for each native proof it repeatedly scans the whole inventory, camera list, proof list and audit history, repeatedly normalizing the same exact labels. `/api/field-map` invokes the complete Owner placement projection twice, around its existing fresh-source read. This creates avoidable quadratic work even though all inputs are bounded.

The fix indexes only candidate positions by exact existing IDs and normalized keys within one helper invocation. Candidate unions preserve ordinal order and repeated proof entries; duplicate objects are not collapsed into a single authority. The original validation predicates, complete membership comparisons, warning holds, audit chronology, UUID checks, resource checks and return contract remain. String-normalization reuse is pure and invocation-local. Malformed non-string behavior and lazy malformed-device inspection are preserved. No identity decision, source snapshot, authorization, digest or freshness result is cached between calls.

## Measurements

Node 22, synthetic inputs, three alternating measured rounds; complete output equality checked outside timing:

| Native proofs / cameras | Baseline mean CPU | Candidate mean CPU |
| --- | ---: | ---: |
| 203 / 812 | 118.974 ms | 7.634 ms |
| 434 / 1,736 | 520.088 ms | 8.789 ms |
| 1,001 / 4,004 | 3,021.994 ms | 18.593 ms |

The 1,001-proof case is a stress case, not the current live identity distribution. It independently crosses the observed two-second CPU threshold before other request work.

A broader full-artifact startup fixture was adapted from PR311's synthetic profile fixture without applying its implementation or changing its gates. It has 378 native units, 476 inventory rows, 1,001 upload records, 739 devices, 468 providers, 241 matches, 20 Owner claims, 476 imported sources, 54 audits and seven marked groups. These are historical aggregate-inspired synthetic counts, not a fresh production inventory capture. The complete current v127 artifact and one-function candidate produced identical bodies/statuses for 64 responses across Field Map and camera-health routes: load/repeat, failure/retry, stale/partial health, newer history, changed upload/import guards, Owner revocation, epoch/serial/revision changes, denied authentication and malformed upload.

Ten alternating measured Field Map rounds (warm-up excluded) averaged 802.2585 ms CPU before and 691.4546 ms after; medians were 755.181 and 666.3295 ms. That is approximately 13.8% lower mean CPU for this broader fixture. It does **not** establish the exact production trigger, end-to-end hosted latency, or that every read now fits the hosted CPU allowance. Other projection/digest costs remain. Root must perform separately authorized bounded live acceptance before describing the production issue as fixed.

## Validation and private release packet

- Focused source/route/identity/placement suite: 64 passed, including seeded permutations, duplicates, malformed values, exact variants/decimals, conflicting history, revoked identities, fresh-call changes and linear camera-label reads.
- Captured full v127 artifact: boots before/after; complete projection/error parity at 0/3/203/434/1,001 units; denied-route parity; unchanged configuration and all bytes outside the helper. Both artifact tests ran without skips using the private capture.
- Strict backend TypeScript, application TypeScript, static build, protected-technician preservation and whitespace checks are run with this candidate. Full unit results are recorded in the handoff receipt.

The private v127 capture and prepared packet remain outside git. `prepare-native-alias-cpu-v127.mjs` has no network/deployment capability. It pins name, version, archive hash, both file hashes, helper hash, import-map/JWT settings and entrypoint routing; it refuses drift or reapplication. It replaces exactly one top-level function and preserves the complete surrounding deployed closure. Do not rebuild/deploy the entire modular repository as a substitute for this captured closure.

Pinned v127 archive SHA256: `c13e84a906521969b37e6503aec366cacc6bc81c50def72b4f79be70e518f34b`.
Original serve SHA256: `c846255ca8c0c7869d47b5755a9e4b1e4bed603ba44c20d0cc4e72b37c559774`.
Candidate serve SHA256: `1999dc9e1ffbc9dfe4d89bc609e913cbef34e1f28f9ef9392fcb5b3bf40c72f9`.
Unchanged deno.json SHA256: `c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be`.

Reproduction (all local; capture is private):

```sh
COS_NATIVE_ALIAS_V127_CAPTURE=/private/deployed-v127.json node --import tsx --test tests/native-alias-cpu-artifact.test.mjs
node --import tsx --test tests/native-alias-cpu.test.mjs tests/native-placement-alias.test.mjs tests/native-placement-alias-route.test.mjs tests/placement-cpu.test.mjs
node --import tsx tests/native-alias-cpu-benchmark.mjs
COS_NATIVE_ALIAS_V127_CAPTURE=/private/deployed-v127.json node --cpu-prof --import tsx tests/native-alias-startup-profile.mjs
node scripts/prepare-native-alias-cpu-v127.mjs /private/deployed-v127.json /private/candidate-packet.json
```

Publication and deployment require separate grants. Before release, re-read the current artifact, reject any drift, retain the complete original closure, run required hosted checks and perform authorized bounded Owner/IT/TV saved-read QA. No live deployment or database mutation is part of this task. Rollback is restoration of the exact retained v127 closure/settings through the authorized deployment process; there is no data migration or data rollback.
