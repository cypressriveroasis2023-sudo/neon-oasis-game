# Vision command center — design review

James Martin is the sole design reviewer. This draft is an isolated preview based on main `559f14d28b2ac9792626cd7c0c909bbca7c19a3a`; it does not authorize a production merge or deployment. PR321 and PR322 are untouched.

## What changed

The existing Fleet Dashboard receives the reference's navy, cobalt and white palette, spacious summary cards, responsive map/inventory layout and evidence-panel styling. Existing searchable Product-ID inventory, map pins, source details and unit dialogs remain the implementation. A new Owner-only briefing and three review shortcuts use the existing validated fleet model. The briefing has no writes, approval controls, invented operational events or AI conclusions. Missing inventory and health remain explicitly unavailable. Reported work, confirmed approval, monitoring acceptance and billing readiness stay separate.

No data adapters, authentication/session recovery, role rules, backend/provider configuration, equipment identities, IPs, SIMs, monitoring or billing records change. No external fonts or demo hosting settings are added. Saved camera refresh stays at 10 minutes; router and power stay at 15 minutes. Standalone FieldMap and legacy camera-health.html retain their separate behavior. Existing operational controls keep their existing permissions and guards; this branch adds no mutation actions.

## Reference provenance

The Library ZIP transfer failed. The parent supplied its exact three frontend source files as task input, outside the application. All UTF-8 SHA-256 values verified, and the reference was rendered and visually inspected locally before implementation:

- `index.html`: `3b256434274709334f3d0cb9c55891ace31db04c62f27aac36407f279ca04691`
- `style.css`: `e72d9de8709bec5344ef368a75513c9492ef3fe7942828ad2be8874858e07f60`
- `app.js`: `338f25fbcf2bb6fca3c82ca60fabff7c81713e349318a51fea9622dbda71e4b0`

Only presentation patterns were reused. No fictional demo customer, unit, health, timeline or inventory values enter application code. Screenshots in this folder show existing synthetic browser-test fixtures, prominently labeled; they are not operational evidence. Fixture maps use stubbed tiles and cannot certify real basemap delivery or live locations.

## Validation

- TypeScript typecheck and Vite build pass. Existing large-chunk warning remains.
- Existing protected Tech Check/auth preservation check passes.
- 199 focused cadence, session-recovery and in-flight-read assertions pass.
- Browser assertions exercised at 390, 1024 and 1440 pixels: new briefing, inventory filters, Owner/IT boundaries, repeated navigation, dialog close/Escape, fullscreen, failed camera reads/retry, session invalidation, verified same-Owner renewal, permission/actor changes, 401 quarantine, and late old responses. Browser history Back also closes the briefing at mobile and desktop widths.
- Local browser execution used installed Chromium with the project's Playwright page/expect APIs and existing test functions through a temporary sequential harness. The normal Playwright CLI stalled before discovery in this Node 24 environment; its pinned Chromium download was blocked with HTTP 403. This is not a claim that the normal CLI or hosted browser suite passed. The committed specs remain compatible with the existing Node 22 CI workflow.

### Pre-existing failing browser case

`product-proof-refresh.browser.spec.mjs`: “late connection read failure is visible and removes retained exact checks” expects the online total to become `0`, but receives `1` after the source failure. This reproduces at all three widths with both the preview and unmodified main's committed frontend artifact. The source warning is visible. No classifier, fallback, timing or read-clearing code was changed to conceal the failure. Investigate separately before claiming complete health-read failure coverage or production readiness.

## Review

Review the visual layout, density, map/list balance and briefing wording. The screenshots are labeled test data. A hosted authenticated real-data session and provider/basemap availability have not been certified locally. No hosting permissions, workflows, authentication allowlists or production deployments were changed to obtain a preview.

### Screenshots (synthetic fixtures)

- [Desktop fleet](fleet-1440.png)
- [Desktop map and inventory](map-and-units-1440.png)
- [Mobile map and inventory](map-and-units-390.png)
- [Desktop unit evidence](unit-evidence-1440.png)
- [Mobile unit evidence](unit-evidence-390.png)
- [Desktop Owner briefing](owner-briefing-1440.png)
- [Mobile Owner briefing](owner-briefing-390.png)

63 distinct browser scenario/viewport checks passed after updating the intentional gradient assertion. The three delayed-connection failure cases above remain reproducible on main. The final CSS-only inventory ordering adjustment passed six additional briefing/layout checks. Library screenshot upload could not start because the supported upload helper could not reach its tool-discovery service; the screenshots are retained here instead.
