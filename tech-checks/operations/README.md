# COS Operations on GitHub Pages

Reference: AppDeploy COS Operations v100 (1791112322806, 2026-10-04 11:12 UTC).
The Today, Daily Board and Field Map components, their data/read-back helpers and styling are ported from that source. The new owner shell embeds under tech-checks/index.html, using relative asset paths.

## Authentication and data

The host retains the existing Cameras On Site Tech Check session. Its same-origin iframe bridges give Operations the current bearer only after checking the actual active role and matching subject; auth changes clear displayed iframe data. They do not store tokens or expose service keys. The platform Edge Function independently verifies the bearer against the legacy project and validates a server-side same-person Operations actor mapping.

Operations reads and writes the reference system of record: Tech Check Platform (tughscoxralhofrckvxy), organization ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5. Its existing service-role RPC grants and authorization gates remain intact. James's legacy owner account maps to his already-existing platform owner identity. Only this linked owner can load the owner Operations workspaces. The four verified technicians have restricted read-only queue access. Other legacy owners retain working owner, IT and Service tools; they require a separate same-person platform linkage before new Operations reads or writes.

IT Tech Check and Service Tech Check retain their original source modules, account identities, permissions and database (goqrnolcvqnirjmzaeyk). Existing owner routes are accessible from Operations. Operations visits and tasks remain in the platform database and are not silently duplicated into legacy technician assignments.

## Current scope

The same `tech-checks/` link now opens responsive VISION for authorized owners.
The parent gives Operations the full viewport: phone, landscape and desktop
layouts follow its current width automatically, including after rotation or
window resizing. No device-specific URL or saved device setting is needed.
Options → Use classic layout remains an explicit fallback (`?theme=classic`
inside the Operations frame); Use Vision layout restores automatic VISION.
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
