# TechCheck IT ↔ Service mandatory department notifications

Scope: mandatory signed IT checkout notifications and Service-to-IT return alerts. Do not change the approved handoff lifecycle from PR #224, Field/Shop placement, camera health, truck stock, evidence, 2027 tracker or mHelpDesk.

## Requirements

1. When an IT Tech signs Check Out / Hand Off, both active real Service technicians get a TechCheck inbox notification and queued company email. The designated receiver alone may independently confirm physical receipt.
2. When Service taps Send to IT Intake, both active IT technicians receive an inbox alert and queued email with sender, unit, ticket, and COS app link. The source unit remains waiting_it until the actual IT check-in. Direct-to-Shop 110V stands do not require IT Intake and must not produce false alerts.
3. The alerts are mandatory operational records, independent of preference toggles. Device push is opt-in and cannot be forced without OS authorization.
4. Read all recipients from active non-archived staff profiles with verified company-domain email. Exclude historical and synthetic .invalid test users.

## Safety and idempotency

Private RLS-enabled outbox identifies each alert by (source kind, immutable event/return UUID, recipient UUID). Email delivery uses the existing secure Operations Manager Google connection, verifies the account before sending, never accepts client recipient lists, and records Gmail IDs. An ambiguous send stops for review rather than risking duplicates. Neither transaction nor delivery changes physical custody, permanent equipment status, or evidence. Existing return and signed handoff source records remain immutable.

## Release gates

1. Pass dedicated TechCheck mandatory department alert review CI on the exact PR head, including isolated PostgreSQL/PGlite triggers, two-recipient matching, preference-bypass proof, rejection of .invalid accounts, queue idempotency, and stubbed Gmail retry/review tests.
2. Confirm accepted main and live transfer/return architecture have not changed since the source snapshot. Confirm active account roster and Google connection with read-only probes.
3. Install techcheck-department-alerts-v1.sql using an authorized controlled migration, then read back both triggers, routine ACLs and counts. Verify no historical/actual equipment changed.
4. Deploy the three reviewed files of the new techcheck-department-alerts Edge Function. Keep credentials server-side. Verify cron-only auth rejects public callers.
5. Install techcheck-department-alerts-schedule-v1.sql only AFTER the worker and database checks have passed. Read back cron configuration and outbox status.
6. Verify future real events send exactly one message to each department member, while a signed acceptance/actual IT check-in remains separate. No synthetic email to real technicians.

Not in scope: phone OS push without permission, recurring escalation cadence after an initial notice, historical photo/signature migration, other users' preference settings, Fleet and 2027 tracker changes.
