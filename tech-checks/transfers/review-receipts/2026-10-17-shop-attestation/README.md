# Independent review: held handoff candidate

This directory publishes the exact successful local test logs and effective ACL
receipt from the isolated candidate. All test rows, Auth responses, signatures
and provider responses are synthetic. Captured SQL fixtures elsewhere contain
function definitions, not real customer records. No signing key, service secret,
live bearer, customer export or production evidence screenshot is included.

## Tested source and receipt provenance

- Tested implementation commit: `ec154c0765af7a90b5a01914fb781b662e8213b6`.
- Tested tree: `1a9c434e72bc73d1a77b2146d585f891922a154f`.
- Implementation base: `9229fa773f9a154d1bbd0391d18879e1e7767a72`.
- Integrated main: `ba1b7422b88de41ee2e4344857333aca7cbe0073`.
- Preserved backend: `09be92ae74d5cb412d2f0000b39c38844a9b914f`.
- Original implementation receipt SHA256:
  `0a807c542a22e744d36083c1bf01be63b00de2b47408b19110a6ba61082846ea`.

The publication commit adds only this review-receipts directory. Runtime, SQL,
tests and the approval bundle remain byte-identical to the tested implementation.
`RECEIPT.json` is the original prepublication receipt, so its no-push status
describes that earlier checkpoint. It also hashes local archives and exploratory
logs that are not duplicated here. `SHA256SUMS` covers the exact files published
in this directory; verify it with `sha256sum -c SHA256SUMS`.

## Validation and limits

| Receipt | Result and scope |
| --- | --- |
| `native-scoped-recovered.log` | 35 passed: 34 native SQL cases plus actual native SQL/bridge/legacy consumer integration |
| `adapter-reviewed.log` | 67 passed: handler and proof issuance, current identity/capability checks and revocation |
| `postgres-exact-final.log` | 63 passed: 30 legacy assembly/custody/location/delivery/partial-return cases plus earlier 33 native/integration cases; latest native run supersedes those 33 |
| `bridge-compatibility.log` | 26 passed: existing IT host, company tools, Owner import and identity routes |
| `node-exact-final.log` | 148 passed, two PostgreSQL-only concurrency skips; affected adapter/native tests subsequently rerun above |
| `browser-transfers.log` | 73 passed, zero retries: all six handoff browser specs against fresh dist, system Chromium 154 |
| `operations-typecheck.log`, `proof-typecheck.log`, `build.log` | TypeScript checks and Vite build passed |
| `native-effective-access.json`, `access-export.log` | Exact new RPC/helper ACLs and rollback denial; existing local fixture's 37 function definitions/owners/ACLs, 68 relation owners/ACLs and three schema owners/ACLs unchanged |

The native lifecycle integration uses actual native SQL in PGlite and the actual
bridge handler to produce a proof consumed by PostgreSQL legacy v7. Auth responses
are synthetic. Native concurrency uses two actual PostgreSQL clients. Browser
fixtures use earlier handoff SQL; the new v7 chain is covered separately, not by
a live browser-to-provider flow. No fresh hosted CI, independent sign-off, live
role smoke, inventory coverage or genuine event/email/archive delivery is claimed.

## Custody and placement requirement assessment

The candidate provides a shared transaction gate for legacy custody, exact
equipment/revision binding, current actor checks at issuance and consumption,
and two scoped observations of current guarded Shop authority. The 105 captured
legacy writer definitions are sealed and prefixed with the same lock; tested
race directions reject conflicting custody. Every historical writer branch and
production contention pattern has not been exercised.

**It does not satisfy a strict requirement that native placement remain Shop
and exclusive through the legacy checkout commit.** The native project and
legacy project do not share a transaction/reservation. Native movement can commit
after the final read and before legacy consumption. Tracker/source change-and-
restore sequences are also not completely excluded. The ten-second issuance
budget and at-most-30-second expiry bound the observation window; they do not
remove that race. Native freshness is additionally capped at 40 minutes.

The implemented guarantees support a bounded point-in-time Shop check plus
legacy custody serialization. Treating that as sufficient for the complete
checkout requirement requires an explicit product/security decision. A strict
cross-project guarantee requires a separately designed native reservation/writer
protocol. This draft is **not ready to activate**.

## Independent review requested

1. **Identity and revocation:** exact native/source identity, legacy bearer and
   capability revalidation, linked-account gates, Owner evidence and deactivation
   between issuance and consumption; inspect synthetic Auth test limitations.
2. **Least privilege:** existing `service_role` receives EXECUTE on only the exact
   new native RPC. Review SECURITY DEFINER ownership, empty search path, dependency
   seals, default-ACL closure, input bounds and complete response-field disclosure.
3. **Concurrent movement:** assess native post-read movement/ABA and whether the
   explicit timing contract is acceptable; review both PostgreSQL race tests.
4. **Legacy writer coverage:** review all 105 sealed writer bodies, eight guarded
   tables, lock order, both race directions and untested historical branches.
5. **Rollback:** exact native EXECUTE revoke/cache reload, already-issued proof
   lifetime, legacy hold procedure, retained reservations/history and provider
   in-flight handling. No rollback may silently release custody.

The exact production scope and separate decisions are in
[NATIVE_SHOP_ATTESTATION_APPROVAL.md](../../NATIVE_SHOP_ATTESTATION_APPROVAL.md)
and [INSTALL_ACCESS_APPROVAL.md](../../INSTALL_ACCESS_APPROVAL.md).
All production installation, EXECUTE grants, signing keys, deployment and
activation remain held. All four legacy release flags remain false in the install
candidate. Parent owns integration. PR187 is untouched.
