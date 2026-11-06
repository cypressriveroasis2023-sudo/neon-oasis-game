# Owner-only InHand connection test

The normal COS control is under Units → InHand Routers. Public source contains no real provider account, organization, device ID, or serial configuration; device identifiers arrive only through authenticated status. It uses the existing same-person Owner sign-in and fixed Helios 001 device identity. No Console command or credential is requested by the UI.

Opening the page makes no pilot request. An explicit Test InHand connection click reads the protected control status, then submits one test only if the server reports a currently ready window. Check test status is read-only metadata; it never contacts InHand or consumes the permit. There is no polling, retry, credential refresh, fleet fetch, map write, or guessed association.

The current-session latch prevents repeated clicks and survives workspace navigation. A submitted or uncertain attempt cannot be unlocked by returning to the page or reading later ready metadata. Results are transient, clear on navigation/hide, and do not survive authenticated-iframe replacement. Keep the page open until the result appears.

Results distinguish provider-reported online/offline/unknown, unknown status observation time, reported public/WAN addresses, and cell-tower location with its original observation time and age. They are not labeled live GPS or management-port reachability. No COS map pin is moved.

Backend support:

- GET /api/inhand-pilot/status: five-second, 4 KiB, allowlisted metadata read through the existing Owner gate.
- POST /api/inhand-pilot/run: existing durable one-use claim and independent nonce readback before provider-secret access.
- cos_inhand_pilot_status: service-only SECURITY INVOKER RPC. It rechecks the fixed active native Owner, reads private control metadata, and never changes the permit.
- Account-specific server configuration and SQL are maintained separately in the authorized backend project. They are deliberately excluded from this public client-only release.

Local verification: 464 offline unit/contract tests, application TypeScript, strict adapter TypeScript and production build passed. Status SQL tests and code/SQL review passed. The existing three deployed-endpoint tests were excluded from the offline run.

The dedicated browser cases are prepared for 390, 1024 and 1440 widths, covering repeat clicks, statuses, expiry, missing data, authorization failures, timeouts, navigation/remount, hiding and late responses. They were not executed locally: the Node 24 Playwright CLI stalls during collection and direct Chromium launch is denied Unix socket creation. Run the normal Node 22 repository CI browser suite before merging. No browser or visual pass is claimed here.

Release: preserve current main, the Camera Health changes and animated-eye work. Publish the separately approved status support without changing existing custom auth, and publish this client-only source through the normal required-checks/verified-bundle flow. Keep the permit expired during release. Never reset a consumed permit or enable ongoing fleet access under this one-device pilot.
