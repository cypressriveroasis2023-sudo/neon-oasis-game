# Camera placement release preparation

PR #301 corrects the v3 provider-folder fallback. Production v121 includes
indexed tracker lookups and optional Shop preflight guards also present in
PR #225. Rebuilding Operations from main would lose those repairs.

`prepareCameraPlacementDeployment` is a pure preparation helper. It accepts the
complete freshly retrieved deployed function and independently reviewed version,
archive hash, authentication mode, serve-file hash and dependency-config hash. The entrypoint and explicit import-map
routing must match the same deployed source directory; the prepared payload keeps
`cos-operations-pages/deno.json` as its import map.
It rejects drift, changed closure, missing/duplicate/already-patched scope, and
changes exactly one `cameraScope2` fallback from Field to Unknown. Every other
deployed byte is retained, including the separate legacy summary routes.
The returned payload is not permission to deploy.

Release remains held until the reviewed draft passes exact-head CI, current
production closure is rechecked, and signed-in Owner Fleet/Camera Health/Map/
Vision/TV acceptance establishes source-separated scope and status counts.
Verify the v3 route uses the corrected function; physical units, IPC channels,
detectors and NVRs remain distinct. Provider status and timestamps must remain
unchanged. Unverified placement must not become a confirmed customer outage.
Preserve all existing release conditions and obtain clearance before publication.

PR #225 cannot be merged wholesale: current main conflicts in
`operations/src/fieldCameraHealth.ts`. Its shared camera placement and Shop-scope
changes require independent reconciliation. This helper does not replace that
work or authorize a broader merge/build/deployment.

## Field Product-ID diagnostics reconciliation

The signed-in October 25 baseline exposed a second issue at the same saved
09:17:45 CDT observation: Fleet showed 201 camera-capable products
(72 online, 2 offline, 127 unverified), while Advanced camera diagnostics
showed 169 legacy units (142 online, 3 offline, 24 unverified).

The frontend now derives Field headlines through the same guarded
`mhelpFieldHealth` and `buildFleetCommandCenter` models as Fleet, including
manual Shop projection. Field filters enumerate exact Product IDs, including
unlinked and held products as unverified; support equipment and Shop products
are excluded. Provider unit groups, channels, recorders and detectors remain
separate diagnostics. No source data or identity is rewritten.

The two-file v121 preservation request alone does not deliver this frontend
change. A release requires the exact tested static artifact plus independently
verified preserved backend closure, explicit scoped release clearance, and
signed-in post-release acceptance. Baseline screenshots and synthetic tests
are not acceptance of an undeployed candidate. PR225's source changes must
still be reconciled without removing existing connection controls or either
Health extension (`sweepCoverage` and `fieldProductScope`).
