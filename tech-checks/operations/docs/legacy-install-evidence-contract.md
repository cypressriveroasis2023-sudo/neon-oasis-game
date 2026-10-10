# Legacy installation evidence, local read-only implementation

## Scope

`GET /api/owner-review/legacy-evidence` adds a separate evidence section to
Operations Owner Review. It does not create native jobs, equipment, visits,
documents, map pins, permissions, or billing decisions. No mHelpDesk writes are
implemented. The Owner retains the decision to choose Ready for Billing or
another appropriate mHelpDesk status after reviewing the work.

The session capability `legacyInstallEvidence` makes the view discoverable only
when the backend supports it. Existing native Owner Review actions remain
separate and are never offered for projected legacy records.

## Existing authority and bounded reads

- Preserve the active legacy Owner and existing same-person native Owner gates.
- Recheck that verified native Owner role's existing `job.view_all` permission
  with a bounded `role_permissions` read, as in the current private evidence
  reader. No new role/grant is created.
- Read legacy records with the caller's bearer and legacy publishable key, under
  existing RLS. The platform service key never reads legacy evidence.
- Use a 30-day window and at most 10 preparations. Discover at most 11 closed
  preparations and 11 Helios submissions. Return `hasMore` for a truncated view.
- Fetch two preparations concurrently. Per preparation: at most 100 items,
  one solar check, 300 handoff evidence records and 300 field evidence records.
  Exceeding a bound is unavailable, never silently complete.
- Call only the existing STABLE `owner_job_closeout_summary_v1` read RPC, using
  an exact numeric ticket reference. Its current counts cover all SWAP families.
- Detect a newer preparation using a bounded numeric substring query, followed
  by exact trimmed ticket equality, matching the summary's `btrim` contract.
  The current preparation must also be observed. An overflowing alias/history
  search or missing candidate fails closed.
- Fixed error text, 15-second request/body deadlines and 256-KiB response caps
  apply to the new permission/evidence reads. Existing authentication remains
  unchanged. Request paths, actor IDs, filters and tables cannot be selected by
  the browser.

Verified on 2026-10-10 using metadata-only reads: authenticated SELECT and RLS
exist for prep_tickets, prep_items, service_solar_checks,
service_solar_evidence and handoff_evidence; authenticated EXECUTE exists for
the STABLE Owner summary. No production business records or credentials were
read for this implementation.

## Evidence meaning

Every unit keeps its exact legacy prep-item UUID, full equipment family and
unit tag. Bare numbers are not joined across families.

- Generic closed preparation proves the existing Service handoff/receipt
  workflow passed. It does not prove a universal field installation-complete
  action. All historical equipment families are displayed without re-enabling
  retired equipment.
- Helios Service submission requires the actual completion timestamp, accepted
  handoff, all 13 saved field checks, installation photo count and a dated
  installation signature. Evidence times must fit the saved handoff/completion
  order. Photo/check evidence is prep-level, not a per-photo unit identity proof.
- Eligible Helios items are DELIVERY or SWAP with `swap_outcome=installed`.
  Unused replacements and BACKUP truck spares are not installed units. A used
  spare still does not inherit the prep-level final installation checklist.
- Other families' explicit installed SWAP outcome is displayed as that recorded
  outcome, with final installation review still required. Generic DELIVERY
  stays installation-pending. Ranger field Victron confirmation is displayed
  separately and never treated as a full installation-complete event.
- Newer preparation, corrections, open assignments, missing returns, pending
  intake/site registration and unresolved escalations remain visible blockers.
  Saved historical field proof is not a claim about current field location.
- Owner verification is a separate valid later timestamp. Service submission
  is displayed as awaiting Ops verification, not Owner approval or mHelp status.

Source references:

- `20260925_production_reliability_authorization_v1.sql`,
  `save_my_helios_field_install_v1`
- `20260926_remove_duplicate_service_receipt_photos.sql`, `close_prep_ticket`
- Current metadata for `owner_job_closeout_summary_v1` and
  `get_swap_closeout_state_v1` (the 2026-09-21 checked-in summary predates the
  current all-family SWAP outcome gates)
- `technician-wizard-owner-dashboard-v5.js`, `heliosFieldItems`, Ranger field
  confirmation and Owner Helios final review

The older protected `owner_verify_helios_install_v1` counts all Helios SWAP rows,
including unused replacements. This projector uses the newer Service submission
semantics instead. No protected function is changed.

## Field Map and future explicit completion source

There is no verified exact installation link from legacy prep item to native
equipment **and** native site in the inspected contract. Existing Owner identity
claims may prove an equipment association, but do not themselves prove the
installation site. Legacy site labels and registry current-site values are text.

Therefore every projected record says exact linkage is pending. This change
does not modify Field Map or its snapshots. Newer manual location overrides,
pickups, returns, holds, reopened work and technician changes keep their existing
precedence automatically; no legacy handoff is allowed to override them.

The separately authorized future `service_field_install_v1` proof requires its
own immutable event/item/assignment identity and explicit Service submission.
It is not queried or assumed enabled by this version. A future optional reader
must distinguish unavailable/not enabled from a successful empty result and
must not suppress these existing legacy records when its migration is absent.
COS submission, Ops verification, mHelpDesk synchronization and billing decision
must remain distinct states.

## Privacy, UI lifecycle and verification

The DTO contains only safe labels, exact source IDs, timestamps, check booleans,
fixed blockers and evidence counts. It excludes names, contacts, notes, private
paths, storage URLs, signed URLs, credentials and raw provider payloads. Photos
and signatures remain in the existing authenticated Tech Check viewer.

Refresh clears old evidence first; errors are unavailable rather than empty.
Close, unmount/navigation, page hide and the verified host-hide message invalidate
pending reads and clear records. Display expires after one minute. Browser
history stores no evidence. The client validates the full DTO, bounded dense
arrays, identity uniqueness, semantic completion/readiness invariants and
snapshot clock bounds.

Tests use synthetic records and intercepted services only. The focused Node
suite includes authorization, current permissions, cross-family identity,
unused swaps/spares, malformed/future/stale proof, trimmed-ticket history,
missing location, blockers, bounded reads and no-write guarantees. Browser
scenarios cover close/late replies, Back/new navigation, auth failure, host hide,
expiration, all-family display and phone/tablet/desktop overflow.

Local typecheck/build and focused tests passed. Browser execution remains a
separate gate: Chromium cannot launch here because `socket()` is denied, even
under the supported escalation; the standard runner also stalls in discovery.
The authored browser tests are not claimed as passed. No deployment, push,
migration, production write, or mHelpDesk status change was performed.
