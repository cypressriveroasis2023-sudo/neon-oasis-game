# Named equipment handoffs

Phone IT opens Check Out / Hand Off and Check In / Return. Desktop IT retains Camera Health and Fleet Map. ITTECH uses the same verified legacy IT capability as Teddy and Victor.

The server binds every request to an active technician account. IT selects exact saved Shop equipment and a named Service recipient, completes existing equipment checks, attaches photos and signs. Service independently records equipment received; mismatches remain discrepancies. Check-in records intake checks and keeps equipment held for inventory review or repair.

Transfers do not automatically change permanent truck stock, Field/Shop placement, source equipment, IPs, camera health or activation. Legacy preparation, registry custody, truck assignments and unresolved returns block duplicate issue. Family and full unit tag are matched together. Request UUIDs and revisions prevent duplicate and stale submissions. Accepted evidence cannot be replaced.

Every signed event has a private Drive archive, full answers and a readable PDF. The server delivery queue uses provider-generated file IDs and leases. Interrupted archives retry; an ambiguous email send stops for review instead of sending a duplicate. Service daily signed snapshots retain receipt event IDs and revisions, and their archives include receipt PDF appendices. Google credentials stay server-side.

Deployment uses database-maintenance/techcheck-handoff-activation-v1.sql, which combines v1, v2 and v3 and installs disabled. The release operator verifies the delivery connection, live rollback lifecycle and hosted browser checks before enabling all four release gates. techcheck-transfer-delivery-schedule-v1.sql schedules retries using the existing server-only scheduler secret. Historical files under supabase/migrations remain unchanged.

Validation: 77 focused automated tests, strict TypeScript and a production build. The transfer review workflow runs mobile/desktop and Service browser cases with actual v3 SQL in a disposable database. Live verification must leave no synthetic handoffs, events, files or inventory changes.
