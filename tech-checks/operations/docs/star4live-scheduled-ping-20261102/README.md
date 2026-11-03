# Restore automatic Star4Live saved-port checks

COS already has an authenticated Ping/Scan action. It calls camera-health-check
and publishes service-port results through publish_camera_connection_v1.
However, the deployed v64 automatic collector selects only CAMV/Sniper master
families and 2026_unit_tracker devices. It never selects Star4Live resources.

Read-only production diagnosis: 351 active monitored vigilant_control_center
resource records; 312 have saved IP/port configurations; only 14 have any saved
TCP proof and none has a fresh TCP proof. These are resource records, not COS
Field-unit or camera/channel totals. The last checked COS Field panel had
153 Star4Live units:78 Online,1 Offline,74 Unverified.

## Change

Add a separate bounded collector for existing active monitored Star4Live saved
configurations. Run it in parallel with the unchanged Sniper/CAMV collector,
under the same authenticated cron handler and request budget. No new schedule,
API, credentials, Field/Shop assignments, provider bindings or database schema.
The existing job remains at minutes0/15/30/45 with its existing145-second HTTP
timeout; the new collector uses at most95seconds and8 bounded workers.

Only actual configured public IPv4 hosts and ports are used; no mHelp IP or
guessed default port. Share a transport observation for identical host/port
sets, but retain independent per-resource rereads and guarded publications.
Revalidate configuration/source/activation before publishing through the
existing revision/IP/ports/profile CAS RPC. Retain observation timestamps.
Incomplete, technical-error, changed or unconfirmed writes remain unverified.
One complete valid no-response check supplies an Offline connection result.

The installed publisher was read and verified: for non-Sniper/CAMV profiles,
it stores port_status._connection and reachability while preserving existing
provider status, source time, outage/acknowledgment fields and placement. This
collector permits nvr/solar_spotter/ranger/helios/null profiles and excludes
Sniper/CAMV profiles to preserve that separation. A successful port check is
not a camera/channel, recording or live-video verification.

## Native package

Base is ACTIVE camera-health-sweep v64, archive
12bf99331377e33a69eca36359a489c00d0da75265d1d41de4b1c6d2e06238c1.
Preserve its complete captured bundle, cron-secret verification and existing
completed-snapshot/endpoint-source integrations. Four exact literal edits opt
in to the collector and await/log it; append the isolated collector before
Deno.serve. Reversing the exact edits/overlay restores every v64 byte.
Default factory behavior remains disabled unless explicitly opted in; the
deployed entry opts in. No socket can start before the existing POST/secret gates.

From tech-checks/operations:

```sh
node scripts/prepareStar4LiveSweepRuntime.mjs fresh-native.json candidate-native.json
```

The preparer rejects version/archive/configuration/file or boundary drift. It
has no deployment/network action. Deploy only the matched captured function;
do not deploy the repository's older camera-health-sweep/index.ts wholesale.
After deployment read back exact bytes and verify fresh saved Star4Live TCP
proofs from the existing authenticated job. Read the returned log coverage and
COS Field-unit classifications separately from raw resource counts.

## Verification

- 58 focused checks pass locally on Node24.22.1, including the original direct
  scheduler/diagnostic regressions and new Star4Live collector/native routing.
- New module passes a standalone strict TypeScript check. Full prepared native
  bundle compiles for ES2022 with zero warnings, keeping existing imports external.
- Exact full native rollback is verified. Captured factory tests prove bad
  cron secret/GET cannot reach inventory/sockets, and a valid existing handler
  runs the actual new collector with the old collector, preserving publication.
- Tests cover shared-IP resources, configured ports, nullable profiles,
  disabled/retired/private endpoints, missing configuration, changes mid-check,
  CAS/newer-result rejection, technical/malformed probes, abort/deadline and
  hung reads. The captured factory is an exact v64 extract; its old collector,
  router and completed-cycle dependencies are mocked in the routing test.

## Rollback

```sh
node scripts/prepareStar4LiveSweepRuntime.mjs fresh-deployed.json rollback-native.json --rollback
```

Require the pinned candidate file hash before reverting. Restore only this
collector integration; no SQL, device, tracker, provider-status or schedule
rollback is required. New saved TCP observations remain historical evidence.
