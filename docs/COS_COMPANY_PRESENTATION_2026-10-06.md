# COS company overview and connected job presentation

The company layout now uses the requested dark presentation with restrained blue
accents across the actual Operations platform. The company overview begins with Camera Health,
stored InHand router records and the Victron monitoring entry point, followed by
the eight-stage customer journey, review work and responsible teams.

## Scope

- Responsive COS shell with Overview, Job flow, Schedule, Equipment, Customers,
  Team and Finance. The searchable More menu retains every existing destination.
- Job detail with the ordered Quote, Agreement, Signed, Schedule & Parts, IT Prep,
  Service Install, Closeout and Billing stages; connected context; six information
  tabs; confirmed facts; known attention items; and responsible team.
- Existing scheduling, dispatch, closeout and job actions retain the selected
  authoritative job ID. Browser Back/Forward and stale-link behavior remain safe.
- Shared native form, dialog, loading, unavailable and empty-state styling.
- CSS-only presentation of the protected IT/Service tools and standalone Camera
  Health, Camera Detail, OnSite Vision and IT repair pages.
- Local Open Sans assets, without a runtime font CDN dependency.

## Data boundaries

The lifecycle is a read-only view of the existing workflow, not a new workflow or
a substitute for backend authorization and readiness checks.

- Quote totals count quote records. Later operational status does not establish
  that a quote was accepted, an agreement exists, or an agreement was signed.
- The current job snapshot does not expose agreement/signing status, parts
  requirements/readiness or an originating request. These appear as unavailable
  or not connected, never as invented complete or missing records.
- The jobs snapshot's placeholder empty evidence arrays do not prove that field
  evidence is absent. Existing Owner Review remains the evidence authority.
- InHand counts are stored inventory and management-port observations. They do
  not claim live GPS, cellular connectivity, SIM health or a live cloud feed.
- Victron power readings remain in the existing VRM workspace/portal; the
  overview does not fabricate alarm or battery totals.
- Failed sources remain unknown. A missing response is never converted to zero.

The native shell retains explicit boundaries to the separate COS AppDeploy host
for Work Requests, CRM, Accounting, Collections, Payments, Needs Attention,
History, Reports and Activity, and for the existing financial document builders.
Vendor portals and embedded Victron dashboards keep their vendor presentation.

## Preservation and verification

No production data, backend code, schema, account, permission, credential,
authentication bridge or protected technician workflow implementation is changed
by the native presentation release. Standalone HTML tests hash all original
script tags and original markup except the added stylesheet/theme metadata.

Run from `tech-checks/operations`:

1. `npm ci`
2. `npm test`
3. `npm run typecheck`
4. `npm run build`
5. `npx playwright install chromium`
6. `npm run test:browser`

Browser fixtures block or intercept external traffic and use synthetic records.
They verify navigation, multiple widths, exact-job actions, repeated/cancelled
flows, saved-result verification, unavailable sources and technician boundaries.
They do not certify an authenticated production write.

The Pages verification script compares published bytes for the generated bundle,
all new presentation styles and fonts, standalone pages, host bridges and the
preserved technician scripts. The release can be rolled back by reverting its
frontend commits; database rollback is not required.

## Dark presentation correction

The October 6 follow-up changes presentation only. Dark chrome is declared in
the initial HTML before scripts/styles load. Company overview, connected job
flow, native forms/dialogs, host authentication and technician tools, Camera
Health/Detail, Vision and repair screens use dark surfaces with readable text.
Green, amber and red states retain separate semantic colors and labels.

The seven-area navigation, eight-stage lifecycle, dimensions, responsive
breakpoints, backend contracts and existing workflow scripts are unchanged.
Legacy light theme preferences do not override the requested dark default.
Third-party vendor content keeps the vendor's presentation.

Rendered browser checks cover contrast on every native destination, populated
overview/lifecycle, forms, menus, errors and authentication states. Responsive
screenshots cover mobile, tablet and desktop. A blocked-script/style test verifies
that the initial document canvas is already dark. This is a presentation check,
not certification of authenticated production writes.
