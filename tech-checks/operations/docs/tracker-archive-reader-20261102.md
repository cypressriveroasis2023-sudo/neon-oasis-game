# Preserve archived WALL-E history without blocking current camera attribution

The November 2 authoritative inventory has 925 current Product IDs. The tracker
overview also has 925 IDs, but its historical MHELP MATCH INDEX retains 1,001.
The previous connection verifier required identical cardinality, rejecting the
entire saved-connection source after the separately approved Shop WALL-E archive.

This repair changes only the server connection reader and its tests. The
equipment-import verifier, placement authority, frontend and TCP evidence rules
are unchanged.

## Evidence boundary

When historical index IDs exist, independently read the existing WALL-E sheet
(ID 1900162011) from the same protected workbook, using the existing read-only
service account and timeout. Also read that sheet when its metadata is present
even if the historical index has since been pruned, preserving archived IP holds.
Read only A:B (label/placement), G (tracker IP), and BE:BH (Product ID,
membership, mHelp placement, lifecycle), bounded by verified grid dimensions.
Never read mHelp IP notes.

Every extra indexed ID must match a unique archived Product ID with exact
WALL-E label/model, SHOP placement in both saved placement columns, ARCHIVED
membership and DECOMMISSIONED lifecycle. Missing current IDs, other-family
extras, duplicates, wrong metadata, shifted ranges and unexplained archive rows
still fail closed. An archive row whose ID is still current cannot excuse a
missing current identity.

Archived IPs reserve ownership. A current record sharing an archived IP receives
the existing tracker_restriction hold, understood by the strict existing V2
consumer. No optional reservation field can be silently ignored by that consumer.
Archive ID/IP/source-row evidence enters the internal source digest and never
leaves in the browser envelope. There is no new public contract or status rule.

## Verification

- 49 focused Node checks pass (Node 24.22.1 locally): existing exact TCP evidence,
  strict import verifier, protected reader/role checks and six archive scenarios.
  The legacy optional CSV fixture check returns early when its historical local
  file is absent; no claim of validating that unavailable file is made.
- Operations TypeScript check passes. The server reader bundles successfully
  with the existing esbuild dependency and ES2022 target. `git diff --check` passes.
- A read-only replay of the actual seven tracker ranges, three archive ranges
  and independently read active protected mHelp inventory succeeds: 925 current
  Product IDs and 76 historical index extras. Nine current products retain
  customer/placement holds. These are source-verification results, not live
  Online/Offline counts. Private source payloads are not committed.
- Tests include 925 current + 76 archived, archived/current shared IP, archive
  IP changes affecting the digest, index pruning without loss of ownership,
  malformed archive evidence, missing current IDs and wrong archive metadata.

## Release and rollback

This is a source candidate, not a deployment. James remains the release reviewer.
Keep separate from redesign PR #325 and the other active camera repair branches.
Production's captured native function has a bundled productTcpRuntime module;
do not replace it with repository index.ts. Before any release, prepare and verify
a matched native runtime from a fresh function capture, preserve other modules
and the temporary exact-preview-origin correction, check for drift, and verify
the authenticated response and current saved TCP producer/attribution state.
Passing this source census does not prove that usable fresh TCP checks exist.

Rollback is the two reader source files from parent main
38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137; no database or tracker rollback is needed.
An eventual native deployment needs its own captured-byte rollback package.

Source references: 2027 UNIT TRACKER workbook
1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA and the November 2 final WALL-E
reconciliation record, Drive file 1600Oi1go-jKcU9Lt6JL32EhlIM9JVfPk.
