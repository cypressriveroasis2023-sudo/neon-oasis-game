# IT sign-in dashboard

The existing verified IT fleet host opens `#it-dashboard` after sign-in, as soon
as current fleet access is confirmed. It does not wait for the legacy Home's
all-source task loader. Explicit Field View deep links retain their destination.
`?itHome=checks` opens the existing Tech Checks Home instead. Returning to Tech
Checks or pressing Escape closes the fleet view, and its Home shortcut reopens
the dashboard. A hidden Home never interrupts equipment prep or another task.

The responsive COS dark overview contains six independently loading cards:

- Field View: saved field units, addresses and current verified map pins
- InHand Routers: inventory and saved management-port observations
- Camera Health: source-separated provider observations and camera coverage
- Victron: saved installations and already-approved read-only dashboards
- Unit Tracker: reviewed source rows and pending COS requests
- MHelp information: the current IT user's existing Ticket Lead references

Each card has its own status, refresh/retry and direct workspace navigation.
A slow or invalid source does not block other cards. Counts are never inferred
from an unsuccessful read. Old requests cannot populate a newer account or view.
No device probes, tickets, placements, sync jobs or tracker publications are
created by the dashboard. Existing detailed workspaces retain their permissions.

## Authorization boundary

The same two previously verified IT identity pairs remain required, including
current active legacy profile, same-person native identity, organization and
native IT role. Service, unlinked, inactive, archived and Owner-preview sessions
receive no IT dashboard bridge. The frontend does not grant access.

The only backend expansion is authenticated `GET /api/vrm-fleet`, advertised by
`features.vrmRead`. It reads the filtered saved registry. Discovery refresh,
sharing/admin changes and all writes remain Owner-only. The older static
`/api/vrm-portal` remains Owner-only because it does not apply the dynamic
availability filter. An unavailable installation has no embedded sharing URL.
No grants, schema, credentials, identity mappings or scheduler settings change.

MHelp uses the existing `my_managed_tickets_v1` RPC with the caller's existing
legacy session. That function selects the current active user's Ticket Lead
assignments. A same-origin/current-frame bridge projects only ticket number,
site, type, recorded schedule, Tech Check completion and equipment labels/counts.
Notes, descriptions, lead identities, credentials and billing fields do not
cross that bridge. These references are not a live mHelp API sync, and their
completion status does not represent MHelp billing or ticket status. The Owner
mHelp partner/import flows remain unchanged.

## Release and verification

Deploy only the reviewed `fleetAccess.ts` delta onto a freshly fetched current
Operations function bundle, preserving all concurrent mHelp and Victron files.
The frontend can fail closed against an older backend: no Victron summary read
is made until its feature is present. Publish the verified static build to the
existing GitHub/Cloudflare app. Do not replace the backend with an old checkout.

Checks: `npm test`, `npm run typecheck`, `npm run build`, and the full Playwright
suite. Synthetic tests cover both IT identities, denied roles, unavailable VRM
links, individual source delays/failures, every view, browser Back, repeated
entry, interrupted Home loading, hidden Home, auth changes and stale replies.
Protected legacy technician workflow files and migrations remain unchanged.

On the local Node 24 verification container, Playwright 1.51's optional TS ESM
loader may hang during collection. `PW_DISABLE_TS_ESM=1` disables that optional loader; use the repository's `tsx`
loader for source modules with extensionless TypeScript imports. The existing Node 22 CI configuration
is unchanged.
