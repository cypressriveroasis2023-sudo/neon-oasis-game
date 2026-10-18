# Named handoffs — historical PR 186 review checkpoint

The current backend implementation and exact held installation/access boundary
are documented in [BACKEND_INSTALL_REVIEW.md](./BACKEND_INSTALL_REVIEW.md).
The unfinished list below records the earlier PR186 checkpoint; delivery, daily
receipt binding, custody, partial returns and Owner release are implemented in
the new review candidate. Production installation and activation remain held.

**Not ready to merge, enable, or deploy.** Base: `760eced55a47ebf36691159aa53c9bfdf5e9f6d4`.
The additive migration installs disabled. There is no technician-accessible enable function.

Implemented in the review candidate:
- Desktop IT entry is Camera Health only. Phone IT entry has check-out and check-in actions inside the existing app.
- Named Service recipients read only their own handoffs; IT cannot accept on their behalf.
- Exact existing `equipment_master.equipment_key` identities, per-unit checks, SIM strings, batteries and parts, photos and authenticated sign-off.
- Check-only workflows reuse the existing BACKUP rules. Only explicitly mapped families can be issued; unsupported model variants stay held.
- Service independently enters receipt information. The server records mismatches or missing equipment as a discrepancy, not acceptance.
- Request UUID replay, revision checks, equipment reservation locks, private evidence, device draft recovery and immutable signed events.
- A checked-in return remains review-held or repair-held. No transfer changes permanent truck stock, camera health, activation or physical placement.

Unfinished / release blockers:
1. Link the new transfer outbox to the existing authenticated Google delivery worker. Current `awaiting_delivery_adapter` is not delivery success. No transfer PDF/email has been sent.
2. Link receipt event/version references into the Service daily signed snapshot and PDFs. The existing daily report is deliberately untouched; the new receipt currently records separately in COS.
3. Reconcile reservations against existing legacy prep/handoff, field custody and `unit_returns` records before enabling; this draft uses the existing equipment key but does not yet reconcile those global custody guards. MHelp placement authority and newer verified location evidence must be checked before physical actions. Returned-review release must pass the existing IT/Owner inventory gates. Partial returns need an explicit per-item workflow.
4. Implement/review the remaining camera metadata/identity/SIM/router/GPS editing paths with backend grants, audited revisions and global association/collision guards. Existing IP/port and placement controls are reused; this is not a claim that every requested camera field is editable. Owner administration is unchanged; Service gets no camera-edit grants.
5. Update and run the older four-workspace IT browser expectations for the new product scope, without dropping session, late-read, deep-link or Owner-isolation coverage. Complete full CI and review mobile/desktop screenshots.

No protected PR174 camera files, shared camera-status helper, live equipment, credentials, production permissions or deployment settings were edited. Synthetic PostgreSQL tests use PGlite with the actual candidate SQL and minimal source-schema fixtures; they do not establish production migration compatibility. Browser tests intercept every request and use a disposable PGlite database. Local managed Chromium refuses navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`); do not bypass that policy. Run those cases in GitHub's review job using its test browser.

Validation commands:
```
cd tech-checks/operations
node --import tsx --test tests/transfer-core.test.mjs tests/service-daily-report-sql.test.mjs tests/service-daily-delivery.test.mjs tests/it-daily-availability.test.mjs tests/it-daily-camera.test.mjs
npm run typecheck
npm run build
npx playwright test --config tests/playwright.transfer.config.mjs
```

## Missing-backend entry repair

The phone UI now requires an account-bound, timed readiness response before opening handoffs. A missing function, disabled rollout, incompatible schema, missing submit endpoint, public/incompatible evidence bucket, unfinished report/daily-link/custody gate, or unavailable read keeps transfer controls closed. IT receives the existing authorized Camera Health view with a retry notice; Service's original morning form remains usable. The transfer client also preflights reads/submissions, and a schema-cache mismatch after a successful probe returns the host to its safe view. Late readiness replies cannot change a newer account or replace a timed-out fallback.

`techcheck-transfer-rollout-v2.sql` is an additive migration after v1. It adds separate operator release attestations (`reports_ready`, `receipt_link_ready`, `custody_ready`), all false by default. Public context/submit entry points and storage access require all gates; the previous core routines move to private, client-inaccessible names. No flag is enabled by this migration. These flags do not implement or prove the unfinished report adapter or custody reconciliation; the original release blockers above remain.

Local focused validation: 64 Node/PGlite tests passed, strict TypeScript passed, and build passed. The browser configuration includes 39 cases (8 existing transfers, 13 new readiness cases, and 18 original Service basics cases); browser execution must be verified in the normal GitHub review runner. No local browser policy bypass or production migration was attempted.

Additional command:
```
node --import tsx --test tests/transfer-core.test.mjs tests/transfer-readiness.test.mjs tests/transfer-rollout-sql.test.mjs tests/service-daily-report-sql.test.mjs tests/service-daily-delivery.test.mjs tests/it-daily-availability.test.mjs tests/it-daily-camera.test.mjs
```
