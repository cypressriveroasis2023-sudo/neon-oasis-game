# Automatic mHelpDesk inventory

The protected `cos-mhelp-inventory-sync` worker reads all equipment for the
authenticated portal 224643. Product IDs, full labels, customer identities,
explicit service-location membership and every referenced equipment category
are checked. A second complete equipment read rejects assignments that changed
during collection. Customer/default service self-references use that exact
record; missing or unrelated service IDs never fall back to a billing address.
Only address1/city/state/ZIP are selected. Address supplements, vendor GPS,
network credentials and IP fields are not imported.

`compare` returns a bounded structural comparison; `preview` reads complete
service addresses without writes; `stage` creates a private candidate; `run`
activates a complete source only when the native control is enabled. No action
accepts equipment or credentials from its caller. Existing cron authentication,
encrypted token rotation and shared rate-limit backoff are reused. Empty,
partial, duplicate, cross-portal, changed-source and failed reads retain the
previous source and record a failure for the existing COS alert.

API snapshots have their own `COS_MHELP_API_V1` contract and provenance. Original
accepted files remain immutable. Source admission changes only private source
records and the active-source pointer. Native equipment, camera identities,
IP/SIM data, activation, GPS and history are never written. Existing reviewed
Product-ID bindings carry forward only with the same label and current graph;
new or changed identities remain source-only or held for review. Exterior label
padding is normalized; punctuation, suffixes and decimal identities are retained.
Missing IDs are recorded separately, retain history, and cannot acquire a new
camera link. Their old native display is excluded only with a current reviewed
binding and no newer protected placement evidence.

The existing one-minute address worker consumes the new active source. It
deduplicates Field addresses and reuses only positive, correctly matched
evidence; changed addresses get a new Census lookup. Shop is excluded. Incomplete
or unmatched addresses remain in the visible review queue and retry. API success
does not prove GPS, video or camera health.

## Deployment

Install `mhelp-live-inventory-baseline.sql`, then `mhelp-live-inventory.sql` with
the control disabled. Deploy the protected worker and verify a staged live
source. Before touching the current bridge, retrieve its latest files and
compare the baseline helper implementations with the exact source checkout;
do not replace an older or changed server bundle.

Bundle `mhelpLiveInventoryRelease.ts` using esbuild, IIFE format, global name
`CosMhelpLiveInventoryRelease`, ES2022. `build-mhelp-live-release.mjs` prepends
only the isolated helper and assignments to a freshly retrieved bridge. It
retains every original byte and runtime file. Verify the exact deployed bytes,
unchanged server suffix and unauthenticated rejection. Then install
`mhelp-live-inventory-projection.sql` to add private API status and current
missing-ID guards without changing the installed scoped/identity kernels.

Publish the UI through the normal repository checks and verified static-bundle
workflow. Verify the actual live index/JS/CSS against that publishing commit
before enabling API-source activation. Schedule the new worker every fifteen
minutes using the original scheduler's existing server-held credential, offset
from placement reads. Observe an actual scheduled full update and subsequent
address tick. Verify totals, changed assignments, Shop exclusion, source/pin
coverage and unchanged native/device/history fingerprints before completion.

Pause by disabling `live_inventory_control.enabled` and unscheduling only the
new inventory job. Restore an earlier immutable source pointer only after
checking the expected current source. Do not delete snapshots or native data.

## Shared inventory and placement reads

Install `database-maintenance/cos-mhelp-single-inventory-reader.sql` before the
updated workers. A private five-minute read lease admits one complete inventory
reader across instances. The durable vendor cooldown returns explicit HTTP 202
deferral with `sourceRefreshed:false`; it is never shortened or counted as a
successful source refresh. The existing fifteen-minute schedules stay active.

The complete source includes versioned placement proof from the same verified
equipment/customer/service collection and second equipment pass. The placement
job projects that proof without another vendor read. It retains exact model,
label, lifecycle, native-graph and service-membership checks, and records the
actual full-source observation time. A stale source or pre-upgrade proof defers
without publishing a new placement receipt. Disabling the full source retains
the existing placement fallback. Address pins continue through the existing
Product-ID address worker; no native GPS or history is changed.

For the live bundled placement runtime, use
`scripts/build-mhelp-placement-single-reader.mjs` with a freshly retrieved native
bundle. It checks the original handler against the base source, adapts native
helper aliases, and changes only that handler plus its optional RPC callback.
All remaining native bytes stay intact. Keep the original native token/runtime
dependencies when replacing the inventory worker's three source files.
