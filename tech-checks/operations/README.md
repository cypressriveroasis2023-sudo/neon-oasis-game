# COS Operations on GitHub Pages

Reference: AppDeploy COS Operations v100 (1791112322806, 2026-10-04 11:12 UTC).
The Today, Daily Board and Field Map components, their data/read-back helpers and styling are ported from that source. The new owner shell embeds under tech-checks/index.html, using relative asset paths.

## Authentication and data

The host retains the existing Cameras On Site Tech Check session. Its same-origin iframe bridges give Operations the current bearer only after checking the actual active role and matching subject; auth changes clear displayed iframe data. They do not store tokens or expose service keys. The platform Edge Function independently verifies the bearer against the legacy project and validates a server-side same-person Operations actor mapping.

Operations reads and writes the reference system of record: Tech Check Platform (tughscoxralhofrckvxy), organization ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5. Its existing service-role RPC grants and authorization gates remain intact. James's legacy owner account maps to his already-existing platform owner identity. Only this linked owner can load the owner Operations workspaces. The four verified technicians have restricted read-only queue access. Other legacy owners retain working owner, IT and Service tools; they require a separate same-person platform linkage before new Operations reads or writes.

IT Tech Check and Service Tech Check retain their original source modules, account identities, permissions and database (goqrnolcvqnirjmzaeyk). Existing owner routes are accessible from Operations. Operations visits and tasks remain in the platform database and are not silently duplicated into legacy technician assignments.

## Current scope

The same `tech-checks/` link now opens the approved VISION-branded Operations workspace for authorized owners.
The parent gives Operations the full viewport: phone, landscape and desktop
layouts follow its current width automatically, including after rotation or
window resizing. No device-specific URL or saved device setting is needed.
This is the only layout. Older `?theme=vision` bookmarks open it and retain
their workspace route. Desktop uses its sidebar; mobile uses bottom navigation.
The Menu opens the full tool list. Light/dark preferences are preserved.
IT/Service applications and the owner authentication bridge are unchanged.

Native owner views now include the shell/navigation, Today, Daily Board, Field Map, Owner Tasks, Jobs, Unscheduled, Dispatch, Owner Review, Calendar, Handoffs, Camera Health, Customers, Sites, Equipment, Team, Quotes, Invoices/Billing review and Purchasing review. Directory and equipment editors use existing native save functions. Finance reviews issue one decision and confirm it from independent list and detail reads.

Four existing same-person technicians (Teddy/Victor in IT, Abel/Josh in Service) can open the separate read-only Operations assignments view alongside their original Tech Check workspace. Its backend authorizes only that technician's existing active native assignments, tasks and workflow details. It does not copy assignments or submit workflow evidence/completion. Owner role previews cannot enter it.

CRM, Work Requests, Accounting, Collections, Payments, Needs Attention, History, Reports and Activity still open AppDeploy. Financial builders, charge review, payment posting and document/email workflows remain linked to AppDeploy within the new review views. Existing Owner Tools remain available alongside Operations. Mike and Jacob have no existing matching platform authentication identity; linking them requires their own authorized platform identities, never James's actor.

## Verification and build

From this directory:

- npm install
- npm test
- npm run typecheck
- npm run build
- npx playwright install chromium
- npm run test:browser

GitHub Actions runs preservation checks, unit/contract tests and desktop/mobile browser tests, then commits the verified dist/ output to the integration branch. The committed bundle is served directly by GitHub Pages; no Node server is required.

Browser fixtures exist only in tests. Production uses authenticated backend responses. Schedule and GPS writes are issued once and confirmed with a fresh backend snapshot. Connection failures do not automatically replay writes. Production database checks exercised native schedule, task and GPS saves with fresh snapshot readback inside rolled-back transactions. The next-pass verification also exercised native purchase review and Customer/Site/Equipment saves with full row/audit restoration, and invalid-state quote/invoice/AP denials. Four technicians' own reads and cross-technician denials were checked without changing identities or assignments. Browser tests verify saving and reload with test-only intercepted fixtures; a signed-in production browser save/reload has not yet been exercised.

## End-to-end audit, 2026-10-05

The [verification matrix](verification/end-to-end-20261005.json) distinguishes real authenticated owner reads from synthetic mutations, external workspaces, role boundaries and remaining gaps. All 20 native owner workspace reads loaded against the baseline deployment. This is not a full production write/technician/billing certification.

Owner controls now verify resulting job/visit/approval state after a write, keep uncertain actions locked until a successful explicit refresh, and prevent overlapping refreshes and writes. Manual job creation confirms the new returned identity and workflow in the current jobs list; the existing snapshot does not expose title, description, priority or site IDs for full-field readback. Task saves verify related records, owner notes and both individual/department assignment fields. Truck approval retains nested shortage details and does not imply receipt.

Workspace navigation reaches all AppDeploy handoff panels, supports Back/Forward, and dismisses old job dialogs when changing workspaces. AppDeploy may require a separate sign-in. Legacy IT/Service code, identity mappings, backend RPCs, database policy and permissions are unchanged by these front-end fixes. Separate backend lifecycle boundaries remain listed in the matrix until independently resolved.

### Owner viewing Service tools

The host now labels the three daily truck/trailer/inventory actions `Service Tech sign-in required` and disables them only while a normal Owner is viewing the Service home. An accessible explanation makes clear that daily checks belong to the signed-in Service Tech. Job lookup, equipment return and return-to-Operations remain available. The guard clears on role/view/auth changes and does not apply to real Service accounts or the existing owner test-persona preview.

Live diagnosis confirmed that the protected legacy home calls `service_departure_readiness_v1` with the normal Owner's identity; that RPC requires an active Service Tech target and rejects the Owner before its data-maintenance steps. The original legacy call and console warning remain; the host does not retry it or turn the rejection into a successful readiness result. This endpoint can initialize truck baseline/restock data for Service targets, so it must not be treated as a read-only production probe. Actual technician sessions and genuine technician network failures are separate from this owner-only presentation fix. Browser regression runs the protected Service-home render/read functions against synthetic clients at phone/tablet/desktop widths, including successful Service/persona results, an actual Service error, legacy redraws, role changes and navigation.

## Rollback

Revert the Operations commit set starting after f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3, or restore that commit's tech-checks/index.html to remove the new entry points. The existing technician source and schema were not replaced. The owner bridge can also be removed independently without altering either database's records.

### Helios Victron VRM

Units → Victron VRM includes the nine installation IDs verified in the signed-in fleet. Portal links require Victron sign-in. COS does not manufacture or cache battery/solar readings.

The Owner-authorized `GET /api/vrm-portal` returns the fleet and optional read-only per-installation embeds. Configure approved links only in the Edge Function secret `COS_VRM_EMBEDS`, a JSON object keyed by installation ID. Never commit sharing tokens or API credentials. Invalid origins, mismatched installations, and unknown IDs fail closed. An unset secret leaves all signed-in portal links available with no embedded dashboards.

VRM sharing is disabled by default and must be approved before activation: anyone possessing a sharing link can view that dashboard. Hide exact locations and leave Victron World publication off. COS authorization restricts link delivery but cannot revoke a copied Victron link; disable sharing in VRM to revoke it, then remove the corresponding secret entry. Readings refresh at the installation's VRM reporting interval; inspect last-update time before operational decisions.

### Private Owner Review evidence

Owner Review loads eligible saved photos and signatures only when an existing authorized Owner chooses View. The protected `GET /api/evidence/:id` bridge rechecks the current active same-organization Owner identity, role and job-view permission, then verifies the document/job organization and private bucket/path before reading bytes. It never returns a Storage URL, signed URL or credential, and does not create roles, grants, identities or public buckets.

The current JSON transport supports private JPEG/PNG/WebP and photo-GIF previews up to 4 MiB. Larger or unsupported files stay preserved with an explicit explanation. Preview bytes are local to the page, clear on close/navigation/background, and expire from the view after one minute; reopening rechecks access. The host clears previews even when it hides an iframe without unmounting it.

Focused reader tests use synthetic files only. A production success check requires a legitimate saved evidence record; no sample job or upload is created for verification. The separate AppDeploy Operations viewer follows the same reader contract.

### Camera Health connection history

The diagnostic unit cards and camera detail view share `camera-health-history.js`.
They keep the latest check/observation separate from the last recorded successful
connection. Star4Live uses `source_last_seen_at` with its reported outcome and
`last_online_at` for historical online evidence. Reconeyez uses the same provider
fields but labels the incoming observation as a cloud status update. Direct
service-port diagnostics use `checked_at` and `last_probe_online_at`; a responding
port does not prove camera video. Router recovery timestamps are not substituted.

History is neutral even while a unit is offline or unverified, with explicit local
timezone labels. Missing values remain unrecorded; malformed or future values are
unknown. CSV inventory refreshes preserve existing success timestamps. Stale port
results no longer display a current green response or latency. Tests exercise the
actual card/detail presentation against synthetic data, without operational writes.

### Dashboard ticket creation

The owner dashboard now exposes Service, Pickup, Install / Delivery and Swap entry points.
These open the existing Owner manual-job action with a preselected supported type; opening,
searching, cancelling or changing navigation never submits a job. Install / Delivery is
explicitly the existing DELIVERY workflow (IT preparation followed by Service delivery and
installation), not a new backend type. Successful creation offers the existing scheduling view.

Ticket entry searches the complete active customer directory returned by the existing
customers JSON-snapshot RPC, then restricts sites to that customer's real active records.
A customer with no site is shown with an explanation. The inline Add site editor reuses the
existing explicit site-save and fresh-readback contract, preserving the ticket draft and type.
No customer/site associations, production tickets, equipment or permissions are changed by
this interface update. An uncertain site save requires refresh and review of existing sites
rather than replaying the save. Tests cover a 1,506-customer directory, keyboard selection,
customer/site isolation, no-site and failed-source states, navigation, duplicate clicks, site
save recovery and owner-access restrictions using isolated synthetic fixtures only.

### Uploaded customer contacts

Customer records have a read-only View contacts action. Ticket entry can optionally include a
selected customer's saved name, title, phone and email in a separate editable Contact instructions
snapshot. Selecting a contact does not assume it is an on-site contact, send a message, or create a
job-contact relationship. Changing/deselecting the customer/contact clears the snapshot while
preserving general work instructions. The existing creation API stores it in the job description.

The contact GET endpoint preserves the existing Owner identity and customer.manage RPC guard,
requires the selected customer to remain active, scopes by customer and organization, paginates,
and verifies every returned parent identity before exposing the minimum contact fields. This
schema has no contact-level archive flag; inactive customer/owner and cross-organization access
are blocked. All contact fixtures are synthetic.

Deployment requires applying the reviewed contact route delta to the exact currently deployed
Operations bridge to preserve existing routes. Do not deploy an older checkout as a full replacement. No deployment, contact mutation, outbound message or production job
creation is part of local verification.

### Per-unit diagnostic reports

Camera Health unit details expose a saved diagnostic report with copy and plain-text
download. Legacy diagnostics bind direct evidence to the saved IP/revision, exclude
metadata from numeric port results, and distinguish refused, timeout, unchecked and
stale evidence. Provider observation time, last check attempted, historical success,
and service reachability stay separate; none proves camera video or recording.
A pending or failed unit verification keeps reports unknown until a newer supported
verification succeeds, including when a user leaves and reopens the unit.

Native reports use the released version-2 source-separated DTO. Observed per-port
results are not in that summary and are explicitly unavailable there; existing unit
diagnostics remain the verification route. Owner ticket entry appends a bounded
sanitized report through the existing current-unit context only while instructions
are untouched. The owner reviews and saves the existing ticket workflow. Copying,
downloading, opening a draft and generating a report do not create or send tickets,
call mHelpDesk, run probes or grant IT dispatch rights. Solar stands, poles and skids
remain zero-camera support equipment. Automatic saved-data refresh stays 15 minutes.

Exports allowlist presentation fields and redact URL, credential and contact-like
label content. Raw integration payloads/errors and contact records are not exported.
Regressions cover IP/revision mismatch, stale direct proof despite fresh provider
timestamps, malformed/false/zero/skipped port values, metadata keys, inventory-only
Recon updates, hostile labels, failure/navigation races and safe export.

### Verified equipment/resource identities

Field Map and native Camera Health share an additive authenticated identity DTO.
The initial reviewed scope links 65 existing native equipment records through
110 existing provider-resource mappings and exact external device IDs, plus one
explicit Owner placement with four camera records. Opaque commitments guard the
complete association; the public source does not contain the provider serial
roster. Missing, added, duplicated or reassigned resources invalidate the link.
An approved label is not permission to strip model suffixes or match another
asset by its number, site, address or IP. The 39 unresolved map records remain
unlinked (37 equipment records and two tracker-only records).

Source cards preserve raw observations when an equipment association is invalid,
but visibly mark the equipment link unverified and exclude it from verified unit
rollups. A legacy name match cannot claim resources belonging to another proved
identity. An Owner-created map row uses its validated control/audit resource set,
so a generic display model does not hide valid camera observations. Distinct
unproven native and Owner rows are not silently merged or deleted.

NVR observations are labelled RECORDER; IPC observations are labelled CAMERA
RECORDS; saved endpoint responses are labelled IP / PORT. None verifies live
video or complete camera-channel coverage. The placement-aware v3 endpoint now
uses the same current IP/revision/actual-port-bound service projector as the
other saved-evidence endpoint. Source times use a consistent 20-minute freshness
grace; scheduled synchronization and visible saved-data refresh remain 15 minutes.
Auth failure, incomplete identity evidence and old observations fail closed.

The deployment baseline is the actual 15-file v23 bridge. Unrelated authentication,
IT permissions, Owner placement, reviewed address estimates and reticle styling
are preserved. Verification uses read-only production snapshots and isolated
fixtures; no physical unit probes, moves, endpoint edits or test records are used.


### Effective installation address in the legacy editor

Camera Health's placement editor reads the existing authenticated Field Map and
version-3 health-identity endpoints with the current Owner or approved IT session.
The backend's effective installation address remains authoritative: reviewed
Owner placement overrides take precedence over linked native sites and eligible
tracker fallback. Billing addresses and provider labels do not fill the address.
The frontend requires a complete, consistent inventory and a unique full-family
placement identity, honors current durable resource proofs, and refuses competing
aliases, missing source records, or identity-review warnings. A proved alias that
cannot be targeted by the existing placement writer is displayed read-only.

Opening or cancelling never writes. Saving the same effective FIELD address,
including a site-name-only edit or a stale legacy placement label, is a no-op.
Known camera-only SHOP records retain their explicit new-installation workflow;
no fabricated equipment UUID or default street address is used. Missing or failed
reads stay visibly unavailable with inputs disabled. Reads and late dialog results
are bounded; a cancelled unit cannot populate the next unit's form.

Before an intentional move, the editor reads the effective address, identity,
location history/pin revision, and legacy audit again. A change requires refresh.
The existing placement writer still checks its audit revision and retains its
confirmation, reason, idempotency, and uncertain-save handling. This frontend
preflight is not an atomic cross-database lock. It does not rewrite GPS, import
records, alter permission gates, or change the deployed backend. Regression tests
use synthetic data only, including no-op, source disagreement, interrupted reads,
Owner/approved IT/Service boundaries, and genuine move confirmation.


#### SHOP deployment and incomplete-detail repair

A valid unit identity no longer needs a complete old installation address before
an Owner or approved IT user can enter a corrected destination. Explicitly empty
recorded site/address values can be repaired; missing response fields, malformed
types, access failures and ambiguous identities still fail closed. An unchanged
complete FIELD address or verified pin is protected from accidental move audits.
Completing a previously missing site without a verified pin requires the same
reason, confirmation, fresh source reads and audited save as an address change.

Known SHOP units begin with a blank new destination. Old imported tracker FIELD
membership does not itself establish a native installation: only the narrow
unassigned tracker case (no installed site, current native location, active job,
Owner placement or verified pin) is treated as a new SHOP deployment. Its original
row, import revision, identity and audit still participate in the preflight check.
Native current installations and verified-location evidence are not silently
reclassified. No source rows, GPS, health data or permissions are rewritten by
opening or cancelling the editor.

### Reviewed native placement aliases (projection version 2)

The native Field Map backend reuses the exact current `summary-v3` identity inputs
and verifier before projecting Owner placement. Its additive
`placementProjectionVersion: 2` / `nativePlacementAliases` capability advertises
only complete, unique reviewed native-provider groups with one exact source key,
one writable native UUID and label, the complete device set, identity proof and
latest audit ID. Every target declares `COS_NATIVE_PLACEMENT_ALIAS_V1` and the
existing `COS_CAMERA_PLACEMENT_V2` writer contract. No model suffix is removed,
new identity is reviewed, or native/control record is edited or deleted.

A valid raw-key Owner FIELD/SHOP audit applies to that native UUID exactly once;
the synthetic control projection is not generated. Raw `placementUnitKey` and
audit provenance remain intact. Warnings, changed association, aliases, competing
resource claims, reused controls, native/control collisions and newer conflicting
audits fail closed without a name fallback or generated shadow. Native sites and
tracker addresses never overrule a valid Owner move. Existing history/GPS rules
are unchanged: moves invalidate old current pins, while only a later matching,
unique Owner location-history proof can restore a verified pin.

The legacy editor independently refreshes the native map/capability, health
identity and legacy state on open and again before save. It binds the full
capability into the preflight revision; an older/incompatible backend keeps
incompatible-name aliases read-only. A successful legacy receipt must be followed
by matching legacy state and one matching native map/identity row without a
shadow. Uncertain readback locks the form and never replays the write or reports
it as confirmed. The existing reason, physical-placement confirmation, request
ID and expected-audit CAS remain unchanged. Owner/approved IT checks remain in
place; Service gains no access.

This is not an atomic cross-database identity guard. The unchanged legacy writer
locks its own source rows and audit revision, but cannot atomically guard the
independently fetched native proof. If either database changes after preflight,
the write may commit while readback becomes uncertain. Reload and review the
saved result; do not automatically repeat it.

Release this delta only through the coordinated backend release. The reviewed
baseline was the actual native `cos-operations-pages` v24 bundle (17 files,
`serve.ts` entrypoint, custom authentication with `verify_jwt: false`). Re-fetch
before deployment, preserve every unrelated file and auth/route, and integrate
any separately approved address-estimate delta without replacing its source.
Backend deployment must precede enabling the frontend capability. No SQL/schema,
credential, grant, identity-review scope, provider setup or production test move
is included. Local tests use synthetic placement/resource data and injected
transport only; fixed existing auth-map constants are used solely to test the
unchanged role gate.

After any alias move has been saved, restoring the old name-only backend can
reintroduce a generated shadow or stop the move from affecting the native row.
For a frontend-only rollback, restore the previous read-only editor and retain
the reviewed backend projection. Do not roll the backend back across saved alias
moves without reviewing their effective map projection first; never compensate
by deleting control/audit/native records.

A retained reviewed resource commitment is also a deny-only tombstone after its
positive native digest is removed. It emits a bound identity warning and cannot
make a replacement association. Warned native UUIDs remain quarantined even if
all current source keys/device IDs disappear: they remain in inventory as
UNKNOWN with historical GPS preserved, but have no current field membership,
coordinates or verified-history marker. Independently fetched native membership
must agree with every writable map UUID and exact label; missing, duplicated or
renamed membership makes the snapshot unavailable rather than reviving an old
field pin. These checks also apply before the first alias move.

Keep quarantine commitments when revoking a positive review. Deliberately erasing
both the positive proof and its resource commitments, or restoring the old
name-only projector, is not a safe post-use revocation: it removes the evidence
needed to prevent a camera-only fallback. No such scope edits are in this patch.
