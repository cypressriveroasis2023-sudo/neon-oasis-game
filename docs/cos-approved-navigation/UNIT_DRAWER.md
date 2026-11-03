# Approved COS linked-unit drawer presentation

November 2, 2026. Existing branch: `design/cos-approved-navigation-20261101`.
Starting head: `86180b5cd30be32d839f52ffdb594e845881e132`.
This is design-only implementation, not a release.

## Programmed changes

- A high-contrast recorded-address panel, larger unit heading and source text.
- The existing camera observation/check timestamp is visually separated from the status and remains the original value and label.
- Camera and router cards stack at phone widths; they remain side by side on larger screens. Power spans the full card area, with vertically stacked metrics on phones.
- Close, existing action buttons, expandable evidence summaries and the Victron link have at least 48-pixel targets in this Owner view. Existing scrolling, focus handling, close/back callbacks and hidden editor state are preserved.
- Only drawers containing the existing unit-health grid inside `.cos-approved-shell` are styled. Unlinked/source-record drawers, IT-only views and TV screens are not rethemed.

## Exact application scope

Added `tech-checks/operations/src/approvedFleetUnit.css` and one stylesheet import in `ApprovedCosNavigation.tsx`.

No FleetDashboard, FleetUnitHealth, FleetCameraTools, battery component, health/model/evidence calculations, data readers, request timing, App.tsx, shared Fleet styles, route keys, unit IDs, camera links, auth/role behavior, inventory assignments, backend, database, dependency or lockfile changes. Source-preservation tests check 17 protected file blobs and reconstruct the prior navigation component after removing the sole import.

No content is invented through CSS; status colors and source warnings are not overridden. The view does not infer GPS from an address, combine power sources, produce a new camera check, create a job or change equipment placement. mHelp remains the service-job system.

## Test boundary and results

The full application is built with the repository's locked toolchain. New Playwright cases use the existing synthetic Fleet saved-read fixture at 390, 1024 and 1440 pixels. They verify exact-unit selection, existing Victron URL, independent power-source values, wrapping, timestamp readability, Close/Back, expanded installation evidence, unchanged IT scope, and the original status labels/classes. The More navigation browser cases run alongside them. These are not real signed-in Owner/IT/Service sessions or live operational evidence.

Candidate run `41475848247` at `b632508be55cc4c67c033d9d2c39fc2470e0f361` passed all 88 focused Node checks, the full TypeScript check, original technician-auth preservation, complete Vite build and independent local/hosted byte comparison. All 30 targeted full-App browser cases passed with zero retries. The original artifact gate still failed there because the matching compiled entries were not yet attached; this is not waived. Exact-head validation must run again after attaching the compiled files.

An initial browser run passed 27 cases and failed three assertions because the new test expected the word `Offline`, while the existing source emits `Camera outage observed`. The correction asserts all three complete original labels and their separate online/offline/unknown classes. The runtime label, status computation and all prior tests are unchanged. The initial failure logs are retained.

The first CI source-boundary command also mistakenly included the entire working directory in its protected-file comparison. The command was narrowed to the stated protected paths; explicit source-change allowlisting and file-hash assertions remain. This was a validation-script correction, not an application change.

The original compiled-artifact verifier is retained. The matching three generated entries are attached only after independent local/hosted byte comparison and targeted browser checks. Temporary CI staging creates hash-verified Git objects only; branch attachment is a separate expected-head, non-force connector operation. Final validation is read-only.

## Remaining release holds

This change does not complete the Board-to-exact-unit link: the existing Board response still lacks the authoritative unit ID. Broader Fleet composition, active camera-repair reconciliation, the complete regression suite and secure live-role acceptance remain separate open gates. No merge or deployment is authorized. Screenshots contain labeled synthetic records, not current fleet counts or dates.
