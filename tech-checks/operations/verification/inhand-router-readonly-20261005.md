# InHand router visibility: read-only phase

This phase connects native COS Operations to the existing Camera Health router inventory. It does not establish a connection to an InHand cloud account or receive GPS telemetry.

## Included

- Owner dashboard counts for management-port reachable, unreachable, stale and unknown observations.
- Units → InHand Routers with search by unit/name/model/IP, status filters, IP/port detail, last TCP check, last recorded recovery, and historical imported status/source/time.
- Field Map contextual information for a unique same-name COS unit. Name comparisons ignore case and repeated whitespace only. They are displayed as unconfirmed suggestions. Duplicate names, alias conversions, and number reformatting never produce an automatic association.
- Map popups retain the existing COS coordinate source/time and show same-name router context separately. No router marker is invented, no coordinates are changed, and absent/invalid coordinates remain unpinned.
- A 60-second visible-tab read refresh. This only reads saved observations; it never runs a router probe. Each status uses its own check timestamp, with checks older than ten minutes marked stale. The current 25-router/five-minute sweep can take approximately forty minutes across 188 records; the UI does not claim all checks occur every five minutes.

## Trust and authorization

`GET /api/routers` remains behind the existing active, same-person-linked Owner gate. It reads legacy `camera_unit_routers` through the caller's verified legacy bearer and existing RLS, never with a service key. COS equipment-unit names are read with the existing server bridge, constrained to its fixed organization. Only explicitly selected non-secret inventory fields are returned. No Service or IT permission expansion, router commands, new tokens, schema/cron changes, saved crosswalks or production writes are included.

`reported_status` from an imported export is historical context. It cannot set current connectivity. `last_online_at` is labeled last recorded recovery because the sweep does not advance it on every successful check. Latency is not displayed: the source may retain it after a failed probe. A failed management-port check means that port did not respond, not proof the router, SIM or InHand cloud session is offline.

## GPS next phase: required evidence before implementation

1. Confirm the actual InHand portal/account and the router hardware's GPS capability. Use official, account-specific read-only API documentation and existing approved access. Any new persistent API grant or credentials need separate approval.
2. Establish immutable source device identity (serial/device ID) and an explicitly reviewed device-to-COS-unit crosswalk. A matching display name alone is insufficient to move a map pin.
3. Receive latitude/longitude, the GPS fix time, source identity, fix validity, and accuracy when provided. Reject nonnumeric/out-of-bounds/future fixes and distinguish observation time from fetch time. Keep cloud connectivity, management-port reachability, reported WAN IP, and GPS freshness as separate facts.
4. Add the telemetry source server-side with credentials kept out of the browser. A missing or stale GPS fix must be shown as missing or last-known. Stored site/manual/phone coordinates cannot be relabeled as live InHand GPS.
5. Propose any persistence/history/retention migration and rollback for review before database changes. Do not change lifecycle placement, installed site, or job assignments from GPS movement.
6. Extend the map read contract only after the telemetry feed and crosswalk are verified. The current `gpsAvailable: false` / `gps: null` contract deliberately rejects injected GPS rather than enabling an unverified feed by accident.

## Verification

Final local run with main 13072d7 (private-evidence and VISION layout releases) integrated: 307 Node unit/contract tests passed, strict TypeScript passed, production Vite build passed. Focused headless Chromium ran the compiled UI at widths 390, 1024 and 1440: search/filter/IP drilldown, duplicate-name refusal, same-name map selection, unchanged stored coordinate, source outage/retry, and missing GPS remaining unpinned. All requests were intercepted synthetic read-only fixtures; these are not authenticated production proofs. The normal Playwright CLI stalls during collection under this local Node 24 environment; the repository's Node 22 GitHub CI remains the full-suite gate. Final CI results belong in the PR. The PR carries source only; the publishing-branch workflow rebuilds and commits the verified static bundle after merge. Router polling updates popup content without clearing the marker or recentering the map.

## Release and rollback

Preserve the latest main commit, including the private-evidence reader. The Edge Function release must include the existing entrypoint, index, VRM helper and private-evidence helper plus `routers.ts`. No credentials or router inventory values are committed. Publish the backend read route and native static bundle only under separate release authorization. Revert this feature's commit and restore the previous Edge Function bundle to roll back; no data migration or state restoration is needed.
