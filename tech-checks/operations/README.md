# COS Operations on GitHub Pages

Reference: AppDeploy COS Operations v100 (1791112322806, 2026-10-04 11:12 UTC).
The Today, Daily Board and Field Map components, their data/read-back helpers and styling are ported from that source. The new owner shell embeds under tech-checks/index.html, using relative asset paths.

## Authentication and data

The host retains the existing Cameras On Site Tech Check session. Its same-origin iframe bridge gives Operations the current bearer only after checking the active owner role; it does not store tokens or expose service keys. The platform Edge Function independently verifies the bearer against the legacy project and validates a server-side same-person Operations actor mapping.

Operations reads and writes the reference system of record: Tech Check Platform (tughscoxralhofrckvxy), organization ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5. Its existing service-role RPC grants and authorization gates remain intact. James's legacy owner account maps to his already-existing platform owner identity. Other legacy owners retain working owner tools; they require a separate same-person platform linkage before new Operations writes.

IT Tech Check and Service Tech Check retain their original source modules, account identities, permissions and database (goqrnolcvqnirjmzaeyk). Existing owner routes are accessible from Operations. Operations visits and tasks remain in the platform database and are not silently duplicated into legacy technician assignments.

## Verification and build

From this directory:

- npm install
- npm test
- npm run build
- npx playwright install chromium
- npm run test:browser

GitHub Actions runs preservation checks, unit/contract tests and desktop/mobile browser tests, then commits the verified dist/ output to the integration branch. The committed bundle is served directly by GitHub Pages; no Node server is required.

Browser fixtures exist only in tests. Production uses authenticated backend responses. Schedule and GPS writes are issued once and confirmed with a fresh backend snapshot. Connection failures do not automatically replay writes.

## Rollback

Revert the integration commit to restore the previous index.html and remove Operations entry points. The existing technician source and schema were not replaced. The owner bridge can also be removed independently without altering either database's records.
