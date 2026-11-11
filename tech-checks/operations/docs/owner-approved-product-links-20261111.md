# Owner-approved inventory links (mHelp A# to COS record)

Status: built and tested. **Not installed, not deployed, nothing linked.** Production installation needs James's approval of this final scope.

## What it is
A fresh, recorded Owner approval that ties one exact mHelp Product ID (A#) to one existing COS record. Inventory identity only. It is not camera-health evidence. No tracker row, IP, SIM, camera device, connection or monitoring setting is read or changed.

## What it does not modify
- **Native equipment records (`public.equipment_units`) are never written.** The link is an overlay applied when COS builds the field map. The values it shows on the linked record (mHelp placement, customer, A#) exist only in that built map, exactly as for every existing mHelp binding.
- mHelp upload batches, the importer and its readers, existing bindings, holds, links and Owner identity claims are not altered. No trigger is added to `upload_batches`.

## Actual Fleet behaviour
Before: the A# appears as a source-only Field record with no COS unit, and the COS record is listed separately, so the same unit is represented twice and the A# can never receive a status. After: one roster entry (kind `unit`) carrying the A#. No online/offline status is claimed by the link; health still requires its own evidence.

## Approvals source unavailable
The approvals read is never treated as "there are no approvals". If it fails or is malformed, the field map carries `ownerApprovedLinks.state = "unavailable"`, links are not applied, no identity is invented, and the board producer refuses to save a board from that map (`owner_link_source_unavailable`). The last completed board stays and is shown as last completed, not current. The run is recorded with the existing generic `source_read_failed` code because the saved-board failure function only accepts its existing codes; that function is not changed.

Consequence for ordering: the database install must be in place **before** the function deploy, and the function must be rolled back **before** the database objects are removed.

## Install order (each step verified before the next)
1. Run `db/20261111_owner_approved_product_links_precheck.sql` (read-only). All flags true, no missing columns, both approvals passing.
2. Apply `db/20261111_owner_approved_product_links.sql`.
3. Apply `db/20261111_owner_approved_product_links_two_approvals.sql`.
4. Read back: `select public.cos_owner_product_links_active_v1(...)` returns exactly the two links.
5. Deploy `cos-operations-pages` and `cos-fleet-board-producer` pinned to the reviewed commit.
6. Read back the next saved board: both A#s `linked` with `matchMethod = owner_approved_product_id`; A#2264694, A#2232676, A#2258987 and A#2301876 unchanged; totals still 925.

## Revocation and rollback
- **Revoke one link:** `cos_owner_product_link_v1(..., 'revoke', {revokes: <approval id>, ...})`. Adds a revoke entry; nothing is edited or deleted. From the next field-map build the A# reads back exactly as before the approval (tested).
- **Roll back the feature:** redeploy both functions at the previous pin first. With the old code the table is simply not read. The database objects can then stay (inert) or be dropped in a separate reviewed step.
- **Approval history is kept** in every case.

## What the tests are and are not
- `tests/owner-approved-product-link.test.mjs`: the read-time rule, executed against both the module and the bundled copy that ships; real roster and Fleet census functions; frozen inputs prove nothing writes to a native record; board refusal when approvals are unavailable; revoke readback.
- `tests/owner-approved-product-link-sql.test.mjs`: real PostgreSQL, but the tables it reads, the Owner check and the batch loader are **substitutes** with the columns the install reads. It is not the real importer and not the live schema. It covers guards, append-only history, idempotency, revoke, two racing approvals for one COS record, a source change while an approval waits, and that a batch insert is not held up.
- Live schema: the read-only precheck was run against production on 2026-11-11 and passed (no missing columns, nothing to create already exists, zero triggers on `upload_batches`, both approvals passing their guards).

## Held, not in scope
A#2264694 Spotter 023 and A#2232676 Solar Spotter 011 (identity holds), A#2258987 Solar Spotter 018 (address review), A#2301876 Ranger 029 .2 (distinct from 029.1). An approval cannot answer any of their notes.

## Known limits
- No in-app approve button; the Owner RPC is tested but not routed.
- A board refusal for this reason is stored under the generic failure code.
- The Fleet screen has no dedicated banner for `ownerApprovedLinks.state`; it shows the last completed board as not current.
