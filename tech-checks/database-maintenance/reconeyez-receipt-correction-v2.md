Local correction proposal for frozen inventory candidate
`6ffebbf19fc4969626e5bf5dab7c4e088b7099ee`, whose reviewed tree is
`5414705b50db3acb680e5630439ef15fd9a1c43b`. Correction request SHA256:
`a2f73d1222f50cf40e285ab067789d49a80fb45b7a1d89daadb6eb5de1c25b2e`.
The frozen candidate is preserved. This source proposal is a separate local
candidate, with synthetic tests only. It is not permission to install SQL or
grants, change production access, deploy, publish, push, merge, or call providers.
Combined, runtime and production gates remain HOLD. The shared-read barrier,
urgent releases, history and placement releases are separate work.

The following is an explicit proposed narrow internal contract amendment. It
does not comply with, or silently reinterpret, the previous ordinary-receipt
integration-only lock contract. Local implementation was authorized; amendment
acceptance remains a separate review decision requiring the atomicity and
locking regressions. Source assertions and serialized PGlite results are not
actual PostgreSQL contention certification.

1. Ordinary receipt finalization takes the existing Recon integration row
   `FOR UPDATE`, then reads and takes only the requested retained audit row
   `FOR UPDATE`. There is no audit read before waiting for integration
   serialization. It never takes audit then integration, and does not acquire
   device or health locks. It never locks a different delivery's audit row.
   Receiver ACK finalization retains its previous behavior; the inventory,
   projector and archive writer implementations are unchanged. Real PostgreSQL
   tests must still verify both finalizer wait directions, a fresh marker read
   after waiting, concurrent duplicate/fresh receipts, and the absence of a lock
   cycle with inventory, ordered projector and archive operations. This proposal
   does not claim those tests passed.

2. One nullable boolean, `camera_integration_events.recon_receipt_metadata_applied`,
   is added on the existing retained audit row. NULL means not proven applied;
   TRUE means this ordinary event's receipt metadata was committed. FALSE is
   invalid. There is no new clock, list, metadata history, table, delivery row,
   retention job or privilege authority. The integration still stores only its
   existing latest `(receipt_started_at, event_id)` tuple. Attempt bounds and the
   separate 600-second attempt retention are unchanged.

3. `recon_record_webhook_receipt_v2(bigint)` validates the freshly read original
   audit evidence and checks its marker before reading the latest tuple. TRUE
   returns the unchanged closed response schema with `outcome=duplicate` and
   `applied=false`, using the audit's original receipt entry time. Therefore A
   applied, B applied, retry A is duplicate. An unmarked event whose tuple is
   older than the latest tuple remains superseded; equal entry times use event
   IDs as the existing tie-breaker. Neither branch writes or renews evidence.
   A missing audit raises 22023 and changes nothing. A latest tuple referencing
   an unmarked requested event is inconsistent evidence and raises 22023, with
   no implicit marker reconstruction or time backfill. Previously applied but
   unmarked pre-amendment history cannot be inferred from the latest tuple.
   Adoption over such state needs a separately reviewed transition; this local
   proposal does not supply a historical backfill or claim compatibility proof
   for already-published unmarked receipts.

4. A fresh eligible application merges the three existing receipt-owned keys
   into the locked integration's current metadata, then first-sets the requested
   audit marker in the same RPC transaction. Each UPDATE must affect a row and
   return the expected metadata or TRUE marker. Both already-locked rows are
   freshly checked after both writes, including separate AFTER-trigger updates
   that RETURNING cannot observe. A suppressed or altered write raises 22023;
   exceptions between or after the writes roll back both. Unrelated
   metadata and original provider/receipt evidence times remain intact. These
   validation errors do not use 40001. Existing PT409 business conflicts and
   propagation of genuine PostgreSQL serialization failures remain unchanged.

5. The audit trigger rejects non-NULL marker inserts, direct first-sets, FALSE,
   clear/reset, changes to the audit ID or provider/receipt evidence, and normal
   DELETE of a marked Recon row. Only the named ordinary finalizer's existing
   receipt writer context may first-set NULL to TRUE, and that statement may
   change only the marker. Denying marked DELETE is an explicit proposal detail
   preventing ordinary DELETE/reinsert from resetting the accepted event ID;
   unmarked audit deletion remains possible and subsequent finalization fails
   closed. No audit row purge policy was found in the checked source. Evidence
   is guaranteed only while its retained audit row exists under these guards;
   600-second attempt retention is not the ordinary audit lifetime. A future
   authorized purge/retention design requires separate review. The guard does
   not cover administrative TRUNCATE, trigger disablement, owner DDL or other
   trusted authority bypass. GUC and PG_CONTEXT checks enforce consistency
   among the existing trusted invoker writers; they do not create a new security
   boundary against a role able to change functions, triggers or authority.

6. The exact existing `cos_archive_camera_event_v1(bigint,jsonb,jsonb)` remains
   unchanged. Its payload-only compare-and-set may replace an original binary
   array with the existing private archive reference, from that fixed function
   frame only. The guard validates reference shape/path/bucket/size limits and
   exact equality of all nonbinary payload fields, including dedupe evidence.
   The existing compactor still verifies the private storage object and sizes.
   Arbitrary payload edits, archive replacement/removal, restored binary, or
   evidence edits remain rejected. The marker survives compaction and ordinary
   projector `processed`/`processing_note` writes. The projector source, archive
   source and their existing authority are not changed. No hash is rederived
   from JSONB text; the original archive format and hashing contract remain.

The exact proposed ACL manifest is
`reconeyez-owned-metadata-v2-acl.json`. It enumerates all 29 callable public
signatures: nine caller APIs and twenty input-only helper dependencies, with
their direct callers, security modes, owner expectations, effective privilege
requirements and source hashes. Both trigger routines are enumerated separately,
for 31 new signatures in total. This is a proposed 29-function exposed callable
surface, not a nine-function exposed surface. The twenty helpers are necessary
for the unchanged SECURITY INVOKER graph: individually revoking each EXECUTE
breaks an intended API with 42501 in the synthetic fixture. That result does not
prove this is a globally minimal architecture. Explicit acceptance of all twenty
callable helpers is pending; otherwise a separately authorized no-new-authority
refactor is needed. No definer, schema, role or persistent-access workaround is
introduced.

The proposal removes service_role EXECUTE from both trigger routines. Trigger
installation checks the installer's EXECUTE permission; subsequent firing does
not require DML callers to have it. The exact new functions are checked for
SECURITY INVOKER, raw/default ACLs and effective inherited privileges. Unexpected
effective callers, service trigger access, or non-owner EXECUTE delegation
authority (WITH GRANT OPTION, including effective service inheritance) fail closed
instead of changing owners, custom roles, defaults or memberships. Ordinary GRANT
does not remove a preexisting grant option; the preflight rejects it rather than
silently preserving or repairing it. Owners/superusers retain their
existing administrative powers. Current inherited EXECUTE checks do not certify
all possible future SET ROLE or administrative actions. Live exposed schemas,
owners, role memberships, default privileges and effective grants have not been
captured; synthetic ACL results do not establish deployment ACLs. The existing
`save_reconeyez_credentials(text,text)` owner, ACL and security mode are preserved
and excluded from the new-function manifest/grant lists.

C16 covers A/B/A, never-applied old, equal entry times/IDs, discarded committed
acknowledgement replay, missing/removed audit, direct marker forgery including
forged writer GUC, marker immutability/ID reuse, and rollback/fault suppression at
both writes. It also checks the proposed source lock order, explicitly labeled
as a static assertion. C29 covers every one of the 31 new signatures, effective
browser denial, owner/security mode, raw/default/inherited privileges, unchanged
credential authority, trigger firing without service EXECUTE and twenty isolated
helper-revocation failures. Synthetic integrated compactor regressions use the
exact checked compactor source. Test execution counts and exact byte hashes belong
in the accompanying candidate review receipt, not in this pre-execution proposal.

Any eventual authorized installation must be coordinated with accepted lock and
exposure contracts, consumers, deployment ACL review and actual PostgreSQL/runtime
gates. This incremental source patch is not independently runnable rollout
authorization. No production SQL or grants were applied. Rollback at this stage
is simply to discard this separate local branch/patch. If ever installed later,
do not clear markers or reverse only one side of the guard/finalizer contract:
keep evidence and compatible writers together until a separately reviewed
rollback/transition is approved. Dropping the marker loses historical duplicate
proof. Restoring the frozen version also restores its historical A/B/A defect,
blanket compactor rejection and unnecessary trigger grants; it is not an approved
runtime fallback. No automatic cleanup or production rollback script is provided.

The independently captured deployed-v33 timestamp-free Recon failure write and
stale full-metadata snapshot limitations remain runtime gates. This correction
does not edit or deploy that handler. The frozen v2 Recon consumer proposal already
uses ordered attempts for failure/success and is unchanged here; its synthetic
receipts do not certify the deployed handler or a coordinated cutover. A legacy
timestamp-free writer cannot establish ordering merely by retaining proof/time.
Combined validation must use main's forthcoming accepted corrected webhook
consumer and exact v33 fixtures, never the rejected 39aad76c candidate. Those
complete shared sources/harnesses are absent here and were not reconstructed.
