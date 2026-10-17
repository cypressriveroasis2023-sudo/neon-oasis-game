# PR206 independent review and correction

Two internal agents independently reviewed published head
`675227c85f27246ed0597469569b7d33c0085302`. They inspected native SQL/bridge code
and legacy writer/custody/consumption/rollback code separately. No external person
was contacted. All reproductions used disposable local PostgreSQL or PGlite with
synthetic rows; no production access or changes occurred.

## Findings addressed in this correction

1. **Writer preflight omitted equipment_master (P2).** A new function taking a
   row lock and updating only that guarded table passed installation without the
   early shared gate. The preflight now scans all eight guarded table names
   case-insensitively. A real installer regression rejects an unreviewed locking
   function for each table in both identifier cases, and proves rejection leaves
   every existing function body/owner/ACL unchanged. The test failed on the old
   migration and passes with the correction.
2. **The documented plain flag update was not an in-flight hold barrier (P2).**
   A checkout already admitted and blocked on a row committed after a bare
   four-flags-false update. The operator instructions now acquire the exact shared
   custody transaction lock before setting all four flags false and committing.
   PostgreSQL tests cover the hold waiting for an admitted checkout and the reverse
   ordering where checkout/Owner release have read old readiness and wait behind
   the hold. Final v7 rejects those queued calls, leaves no proof/event and retains
   reservations. This result requires **all four** false flags and final v7;
   a reports-only change is not equivalent. Delivery/storage do not share this
   barrier, so provider lease reconciliation remains separate.
3. **Hosted real-PostgreSQL handoff coverage was missing (P2).** The dedicated
   review workflow now starts disposable PostgreSQL 17.6 on runner loopback,
   installs only the already-pinned pg client, and runs native attestation,
   bridge-to-legacy integration, full legacy assembly, writer preflight, custody,
   hold races, proof consumption, partial returns and delivery SQL sequentially.
   It also runs the actual bridge/proof authorization suites. Path filters include
   their SQL, helper and fixture dependencies. No production credential or new
   deploy step is used; workflow permissions remain contents:read.

The first hosted operations run had one unrelated preservation expectation made
stale by this candidate's Owner return-review module: actual script count nine,
baseline eight. The test now explicitly requires exactly one exact-version Owner
module and excludes that single reviewed extension before comparing the original
eight scripts against their unchanged SHA256. No host runtime or baseline script
hash was changed.

## Findings still open — activation remains held

- **P1 design limit:** native movement after final observation can precede legacy
  consumption. Two observations, a ten-second issuance budget and short expiry
  provide bounded point-in-time evidence, not Shop/exclusivity through the legacy
  commit. A strict requirement needs a separately reviewed reservation/writer
  protocol; this draft does not satisfy that strict requirement.
- **P2 unverified legacy evidence gap:** Owner camera placement/device evidence
  enters the signed hash, but consumption directly rereads only equipment_master.
  The existing Owner placement RPC is identified in the client; its exact writer
  and trigger side effects are unavailable in the offline checkout. Verify
  post-issuance and post-reservation movement before claiming comprehensive legacy
  placement protection. No exploit against production was established.
- The 105 writer definitions are loaded with check_function_bodies=false for
  incomplete historical fixture dependencies. Their identity is preserved and
  selected real paths/races execute, but this is not full workflow/trigger coverage.
  Text-based preflight still needs a separate review of dynamic/indirect writers
  and excluded package families.

The native reviewer found no additional verified native SQL/bridge authorization
or least-privilege bypass. That is a scoped review result, not activation sign-off.

## Evidence

Original published-head independent reruns: 101 native/adapter cases (99 passed,
two PostgreSQL-only skips), plus 19 actual PostgreSQL legacy cases. Four separate
legacy race/preflight reproduction scripts establish the findings and hold limits.

Correction local validation: 68 PostgreSQL cases passed without skips, and 69
adapter/host cases passed. The host/preflight focused rerun also passed all three
cases. Workflow YAML parses with read-only permissions and no deployment step.
The latest exact-head CI receipt is supplied separately after its terminal result;
the original hosted failure is not represented as a pass.

The stronger legacy install has SHA256
`f0b057870a4a50f89cf4f6255eedbf6f75e7fce030562490812df8727e43d31e`.
Native install/rollback hashes and all existing caller grants are unchanged.
All production installation, grants, signing keys, deployment, activation and
merge remain held. PR206 remains draft; PR187 is untouched.
