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

## Rollback

Revert the Operations commit set starting after f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3, or restore that commit's tech-checks/index.html to remove the new entry points. The existing technician source and schema were not replaced. The owner bridge can also be removed independently without altering either database's records.
