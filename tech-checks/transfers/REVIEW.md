# Named handoffs — PR 186 review checkpoint

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
