# Draft: COS Owner mHelpDesk equipment CSV preflight

**Code review candidate; NOT a production import.**

This change adds a strict, Owner-only, read-only preflight of a *complete* mHelpDesk equipment CSV against the existing protected `COS_MHELP_UPLOAD_V1` receipt. It intentionally does **not** create a new authority receipt or write to any equipment, camera, map, tracker, IP, GPS, or history table. Existing mHelpDesk PDF service-ticket import remains completely separate.

The Owner can choose the original CSV and optionally supply the original SHA-256 from its signed-off manifest. Backend recomputes SHA-256 from exact source bytes (including BOM), validates all Product IDs, customer classification, lifecycle, and row shape, and returns a bounded diff. All content stays private in the authenticated request and only aggregate numbers and up to 40 identity/change summaries are returned.

## Production commitment blocker

There is no reviewed Owner-actor equipment import admission RPC or protected current-guarded commit flow in the existing app. The existing `cos_mhelp_placement_private.upload_snapshot()` is a read adapter, **not** a safe write API. The source upload for October 13 already has 1,001 products but October 16 needs six changed assignments plus one Product ID replacement. Implement an independently reviewed *transactional* Owner admission with compare-and-swap against the current active source, current identity/source/owner/GPS guards, immutable audit, full-current 2027 tracker census, and reversible source pointer. Do not use the existing PDF ticket importer, direct SQL inserts or a static old receipt as authorization. Reconcile camera/map counts separately from physical equipment totals.

## Auth and overlap scope

- `index.ts` Owner route: `/api/mhelpdesk/equipment/preview` (new), reuses verified Owner session, bounded existing request transport, existing `cos_mhelp_placement_snapshot` read guard.
- `FleetDashboard.tsx` single data-source view mount for verified Owner only; never accessible to a Service or IT user.
- New parser/preview is pure except SHA-256 digest, no external vendor or secrets.
- Avoid merge until PR174/index/Fleet layout owners reconcile overlap, focused tests and whole-app CI pass. No deployment, migration, mHelpDesk API call, live unit probing or tracker writes.

## Local tests

`node --experimental-strip-types --test tech-checks/operations/tests/mhelp-equipment-csv-preview.test.mjs`

Test fixture is synthetic; the real 1,001-customer CSV is not added to GitHub.
