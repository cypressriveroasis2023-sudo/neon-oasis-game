# Reconstructed shared-job foundation (inactive proposal)

This is newly reconstructed source, not recovered byte-for-byte from lost local
commits. Prior test results do not validate it. The private SQL is independent of
the old single-assignee intake DDL and is excluded from deployment assembly.
There are no public functions, application grants, configuration seeds, activation,
or automatic claim/start/completion actions in this checkpoint.

## Stable shared contract

- `work_orders`: one immutable source key/printed ticket and nullable UNIQUE
  canonical prep. Positive `revision`, `membership_revision`,
  `source_scope_revision`, `installation_scope_revision`; source scope JSON is
  `{work_type,site,required_unit_type}`, independent of crew changes. Installation
  scope is a separately sealed physical/evidence snapshot owned by the IT extension.
- `work_order_assignments`: immutable assignment/work/department/source identity,
  `origin` scheduled_source or counterpart_queue, source ownership and full
  current assignment baseline. Assignments are never retargeted to other people.
- `participants`: immutable UUID/work/assignment/person/department/origin linkage;
  active or withdrawn with preserved history. Scheduled source identities are
  exact opaque identities. Local department claim members have no source identity
  and require same-transaction proof around the unchanged genuine claim primitive.

Private helpers (SECURITY INVOKER, empty search_path, all app-role access revoked):

- `register_assignment_v1(work uuid,assignment uuid,department text,source_identity text default null)`
- `reconcile_memberships_v1(work uuid,expected_membership_revision bigint,source_revision text,members jsonb)`;
  members are exact objects with sourceIdentity,legacyUserId,department,
  assignmentId,scheduledFor,scheduledTime. Reconciliation requires unchanged
  prestart assignment baselines, including outgoing members. It writes only
  membership history, never coworker assignment audit/lifecycle rows.
- `has_source_binding_v1(assignment uuid,prep uuid)` classifies source markers,
  registry or canonical prep so broken source linkage cannot fall back native.
- `fence_assignments_v1()` takes NOWAIT write-excluding assignment/prep/return
  table locks. All source writers lock canonical work first, then this fence. Read-only
  resolution locks exact rows and checks registration without this table fence;
  mutation admission rechecks under the fence. Global mutation fences intentionally
  reject unrelated concurrent writers rather than permit phantom legacy history.
  Their contention/latency is a required hosted-native gate before deployment.
- `resolve_participant_v1(assignment uuid,actor uuid,prep uuid)` locks and validates
  current exact active member/profile/assignment/department/canonical prep.
  It rejects cancelled markers even if status says assigned; genuinely completed
  current members can still read and supply downstream completion proof.
- `lock_participant_v1(assignment uuid,actor uuid,prep uuid,check_scope bool default true)`
  adds the physical scope assertion. Each phase writer must enforce its own NEW
  mutation lifecycle gate. Completed history is not broadly erased or rejected.
- Both resolvers return bounded JSON work_order_id,membership_id,assignment_id,
  actor_id,department,prep_id,revision,membership_revision,
  installation_scope_revision,writable. `writable` describes draft/prep state,
  not blanket authority for other workflow phases.
- `prepare_it_shared_prep_v1(ticket_number text,actor uuid)` returns that DTO;
  `bind_prep_v1(work uuid,assignment uuid,actor uuid,prep uuid)` atomically binds
  the exact genuine new prep; `assert_release_admission_v1(work uuid,prep uuid)`
  rejects untracked assignment/prep or changed current identity.
- `prepare_department_claim_v1(assignment uuid,actor uuid)` then actual existing
  claim then `record_department_claim_v1(assignment uuid,actor uuid)` must occur
  in one transaction. Admission is pristine, active same-department only; the
  actual resulting person/time/status delta is verified. Intake never calls it.
- `assert_installation_scope_v1(work uuid,prep uuid)` is deliberately fail-closed
  until the IT extension replaces the hook with genuine sealed-scope validation.

Synthetic importable fixture: `tests/mhelp-shared-membership-fixture.mjs`. It
mirrors narrowed published schema evidence and uses explicit audit/notification
stubs, not an entire production clone. IT/Service extensions must compose fresh
captured actual function/trigger definitions and retest. Native concurrency is a
separate hosted-CI gate, not proven by PGlite. No installation or production safety
claim follows from local success.

Revokes enumerate only this proposal's tables, sequence and helper signatures;
unrelated preexisting private functions/tables are not swept into ACL changes.

`bind_counterpart_queue_v1(work uuid,assignment uuid,prep uuid)` is reserved for
explicit source IT release. It verifies current IT authority and the entire
pristine queue baseline, sets only the exact canonical prep pointer and the same
transaction timestamp used by the genuine release primitive, then refreshes that
queue's baseline. A changed/claimed/cancelled queue holds. Named coworkers are not
retargeted or completed. New schema USAGE is revoked only if this proposal creates
the schema; existing schema/table/function permissions survive (canary tested).
