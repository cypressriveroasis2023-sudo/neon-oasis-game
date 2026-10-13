# Owner one-Census proof: access and preflight contract

This change is local implementation only. It does not authorize deployment,
enrollment, re-binding, a provider request, credentials, grants or record changes.

## Access equivalence

The existing active, linked actor authentication in `index.ts` runs first.
Execution requires the Owner role; shared reads use the existing Field View gate. The
same legacy bearer is forwarded to `camera-field-geocode`; no service key or
source-read key is substituted. The new action is outside the approved-IT
allowlist. Service gains no reads or actions; verified IT cannot execute or open
the history route. Shared consumed results are admitted under its own existing
read permissions as described below.

Extra reads occur only for exact native IDs in existing `censusOnly:true` legacy
records. The existing `appdeploy_unit_location_history(actor, unit)` RPC is called
before the selected native read. Its live definition was inspected read-only on
2026-10-12: it resolves the exact unit's organization, checks active actor and
`equipment.view`, and returns every history row without pagination or a LIMIT.
The existing authenticated equipment SELECT policy requires `equipment.view`.
Site SELECT requires membership of the same organization. Native/site reads use
exact ID plus fixed organization filters, selected fields, and `limit=2` so
duplicates fail closed. The backend reads under its existing service identity
only after that actor-scoped permission gate succeeds.

Read-only live catalog inspection also verified authenticated table-level SELECT
on `sites`, with `sites_select` using `app_private.is_org_member(organization_id)`.
That predicate requires the same current active user_profiles membership checked
by existing authentication. There is no additional column-restricted site grant.
The requested minimum fields therefore have the existing actor permission;
possession of the backend service key alone is not the permission argument.
An actual site/history read denial produces no proof and no alternate read path.

Direct authenticated history-table access is explicitly denied and is not used.
History input is the full authorized RPC response: ID, coordinates, accuracy,
source, note, recorded time and recorded-by display name. Its hidden historical
author UUID is not exposed or claimed as part of the commitment. The current
native GPS recorder UUID is already an equipment field and is included.

Every extra response is capped at 2 MiB and 10 seconds. History is capped at
10,000 rows after complete RPC retrieval; oversize/error is unavailable, never an
empty history. There are at most 1,000 enrolled candidates. Two independent exact
native/site/history/camera-epoch reads must produce the same proof and source receipt.

## Read inputs

`ownerCensusProof.ts` exports `OWNER_CENSUS_NATIVE_FIELDS` and
`OWNER_CENSUS_SITE_FIELDS`; these are the exact selected-field lists. No metadata,
access instructions, credentials, customer contacts or unrelated site data are
read. Site is null only when no installed-site reference exists. Camera epoch
uses the existing actor-authorized `cos_camera_identity_epochs_v1` RPC with one
exact key.

Existing map inputs remain authoritative: pre-projection native snapshot, full
identity-source rosters, verified identity result, complete Owner placement
audits, native identity epochs and current mHelp placement receipt. The canonical
hash selects the complete target and relevant collision graph from those full
rosters. Unrelated fleet changes and global crosswalk revisions do not invalidate
the target. New related devices/native labels/provider claims/audits do.

The private authorizing native Owner UUID participates in the execution hash,
but is not returned. The source hash covers the identical full canonical source
identity and binding, omitting only the actor, with the separate domain
`COS_OWNER_ONE_CENSUS_SOURCE_V1`. Full-address digest, exact Owner audit/key, historical native/site
tuple, all authorized historical rows, physical identity/incarnation, related
claims and collision evidence participate. Lookup state, allowance, leases,
attempts, geocoded output, health observations and retrieval timestamps do not.

## Historical-site eligibility

Unassigned available native records must have no installed site/reference.
Installed/site records may remain historical only when their exact site and
current-location references agree, their native update and site update precede
the Owner audit, their complete GPS source is `site`, and all GPS/history times
precede that audit. Both-null site coordinates are allowed; partial or conflicting
site coordinates are denied. Every existing native GPS tuple requires one unique complete history
counterpart. A missing or conflicting same-time row is denied, including for
historical site GPS. No old field is cleared, changed or verified.
Current Owner GPS, active jobs, newer history/site/native placement, incomplete
sources, ambiguous identities and any relevant mHelp authority remain holds.

## Synthetic/offline proof testing only

Production enrollment MUST obtain both digests from the distinct normal
Owner-authenticated preparation route described below, after its exact immutable
preparation marker is installed. Do not use offline reconstruction for production
bootstrap. In particular, legacy epoch/audit RPCs are auth.uid-gated; setting JWT
claims, extracting a token, substituting an Owner, or copying private RPC logic
to fill missing inputs is prohibited.

`preflightOwnerCensusBinding` is retained only for synthetic fixtures and offline
analysis of already legitimately obtained complete inputs. Its explicit trusted
UTC argument tests freshness deterministically; local shell time is not authority.
The authorization structure below is test/operator evidence, NOT authentication,
NOT an enrollment permit, and NOT a substitute for the production preparation
route. Never manufacture those flags from an assumed identity.

Inputs:
- actorId: verified current linked native Owner UUID
- binding: nativeUnitId, auditId, exact unitKey, full addressSha256
- rawSnapshot: unprojected existing native field-map RPC response
- snapshot: current Owner-placement projection with native aliases
- bundle: existing complete sources and verified identity result
- mhelpReceipt: current existing actor-authorized placement snapshot
- target: selected native row, exact selected site or null, complete authorized
  history RPC response, exact camera epoch response
- authorization: contract `COS_CURRENT_OWNER_READ_AUTHORIZATION_V1`, actorId,
  fixed organizationId, role `owner`, active true, equipmentView true, verifiedAt,
  and history `{actorId,nativeUnitId,authorized:true,complete:true}`

Use the same PostgreSQL JSON transport values as the runtime RPC/REST calls
(`to_jsonb`/`jsonb_build_object` where preparing read-only SQL evidence). Do not
reformat timestamps from connector display strings: spaces versus `T`, timezone
offset forms and preserved microseconds can otherwise produce a different hash.

Authorization must be at most 60 seconds old. Output is only eligibility plus
nativeGuardSha256, nativeSourceSha256 and safe identity/history/placement facts. Negative reasons:
`current_owner_authorization_unavailable`, `owner_placement_unavailable`,
`native_fields_incomplete`, `native_authority_changed`, `site_scope_mismatch`,
`historical_site_unproven`, `history_unavailable`, `history_newer_or_malformed`,
`gps_partial_or_current`, `gps_history_unbound`, or
`complete_current_source_unavailable`.

No source inputs are persisted by the helper. Synthetic regressions demonstrate
canonical-helper/producer hash equivalence without any production enrollment.
Only the normal production preparation route authenticates the current Owner and
collects the complete live inputs before returning the reviewed digests.

## Public contract and limits

Existing Owner field-map response gains `ownerCensusProofs`, at most 1,000 entries:
`{contract:'COS_OWNER_ONE_CENSUS_NATIVE_V1',nativeUnitId,auditId,unitKey,addressSha256,nativeGuardSha256,complete:true}`.
Draining, ready and consumed return the same native hash if sources are unchanged.
Only ready may invoke Owner POST `/api/field-map/{nativeId}/owner-census-once` with
`{auditId,unitKey,addressSha256,nativeGuardSha256}`. It uses the same narrow read-only proof helper described below,
compares the complete proof and enrolled marker, and forwards only auditId/key.
Uncertain outcomes instruct refresh/readback; never retry or reset the allowance.
Only this new forwarding call has a 210-second timeout. The targeted guarded
worker has a 200-second budget, 45-second native proof reads and a scoped
120-second SQL claim lease; its post-claim/pre-provider lease checks require at
least 115 seconds and 70 seconds respectively. Existing ordinary app/worker
timeouts and leases are unchanged.

Saved guarded success requires an independently recomputed matching native proof
before projection. Drift withholds the result and blocks fallback. Historical
native GPS remains history; this creates no live or Owner-verified GPS.

Separate database reads are not a distributed transaction. The workflow relies
on independent pre-claim, post-claim/pre-provider, post-provider and later map
checks plus the durable legacy one-attempt hold. No new native/history write,
lock, epoch or ACL is introduced. These guarantees must not be described as
byte-for-byte access to hidden history fields or atomic cross-database locking.


## Shared saved-result admission

Live read-only catalog checks on 2026-10-12 verified both exact linked IT actors
are active native users with the matching `it_technician` role and
`equipment.view`. Both Owner and that IT role have this permission. The existing
history RPC is service-role EXECUTE only, but its actor predicate is active exact
user in the unit organization plus `equipment.view`, not Owner role. The bridge
passes the actual authenticated IT actor to that same predicate. It never uses
an Owner actor in place of IT or accepts a caller-supplied actor. Equipment and
sites have authenticated table-level SELECT, covering every selected column;
equipment RLS requires `equipment.view`, while site RLS requires the same active
organization membership. The direct history table remains denied.

For already-consumed successes, existing authorized Field View readers can
therefore recompute the complete source commitment under their own permissions.
IT performs these exact-target reads only for consumed successful enrolled rows.
The immutable enrollment binding stores `nativeSourceSha256`; read-many exposes
it internally as sibling `censusOnlySourceSha256`, outside the unchanged strict
two-key `censusOnlyGuard`. Preflight returns both hashes. Neither lease state nor
lookup result changes either hash.

`readOwnerCensusEvidence` returns Owner-only seven-field execution proofs and
backend-private source receipts. `projectFieldGeocodes` accepts the latter as a
separate argument, never a response field. Consumed success requires one fresh
exact source receipt matching `censusOnlySourceSha256`; it does not depend on
which authorized viewer opens the map. Missing/denied/drifted evidence withholds
the estimate for all viewers. The authorizing Owner's ready action still requires
the actor-bound proof. IT and different Owners cannot use the source receipt to
execute. IT receives no execution proof, guard, source digest, native raw tuple,
site tuple or history. No new endpoint or permission grant is involved.

A reduced map-only receipt is insufficient: native update/reference/recorder,
site update and hidden coordinates, exact address components, and older history
are not covered by the latest-note projection or identity-only native epoch.
The full exact reads remain mandatory for shared admission. History commitment
still means the complete authorized RPC projection, not hidden historical author
UUIDs absent from that existing response.


## Bounded Owner proof-read action

Owner-only POST `/api/field-map/{nativeId}/owner-census-proof` accepts exactly
`{auditId,unitKey,addressSha256,nativeGuardSha256}`. Existing Owner authentication
runs first; the action is absent from the verified-IT allowlist. The forwarding
action calls this same internal helper. No provider call, claim or write happens
in the proof-read action.

The helper has a 45-second total cancellation signal. It reads only the exact
legacy policy row; it retains initial/fresh full native snapshots, identity and
collision rosters, Owner audits, current mHelp receipt, and both archive reads.
V2 imported source/precedence projections are read for the exact target and all
archive endpoints, with complete original inventory retained. This keeps archive
protection state and all identity collisions; it does not hydrate unrelated
imported geocodes, Census rows, fallback rows or source-recorded points. The
existing V2 source guard leaves historical-GPS/installed-site targets untouched,
and Owner history vetoes source-only/imported-precedence overrides. Archive
validation is still run after proof construction: a hidden/conflicting target
never appears in the proof envelope. Reviewed, imported, source-recorded and
field-recorder result overlays cannot admit or replace this exact Owner row.

It performs the same two exact target/history/site/epoch reads and canonical
proof calculation as the full map. The response is restricted to the unchanged
seven-field Owner proof, exact verified native alias, projection version, and
one whitelisted current Owner row in items/inventoryItems. Native/history/site
raw values and actor-independent receipt are never serialized. Mixed case or
extra spaces in the original Owner address remain untouched; the worker compares
normalized text and the full normalized-address digest to its cached address.
The native canonical commitment continues to bind the original Owner audit text.

Tests compare full-map and narrow proofs, run the real worker verifier against
the native handler with normalized cache text, and reject initial/fresh archive
conflicts, permission failure, drift, malformed bindings and IT execution.

## Exact-target normal Owner preparation

The separate immutable database preparation marker is not an enrolled allowance.
Only its exact authorizing legacy Owner receives `censusPreparation:{nativeUnitId}`
from the existing read-many RPC, while the selected cache remains the exact
`invalid_address` before-image and no real one-Census policy exists. Native Field
Map projects this one-key metadata only for an Owner and the matching current
Owner audit/key/full-address digest/native ID. IT receives no preparation marker.
There is no browser opt-in, placeholder guard, generic target permission or
provider retry in this metadata.

Owner-only POST `/api/field-map/{nativeId}/owner-census-prepare` accepts exactly
`{auditId,unitKey,addressSha256}`. It requires that server-returned preparation
marker and unchanged invalid-address cache before any extra target read. It uses
the same bounded full narrow authority pipeline, two exact target/history/site
reads, complete legacy epochs under the original Owner bearer, and final archive
denial. A final read-many call must return the identical preparation before-image.
It returns exactly `{eligible:true,nativeGuardSha256,nativeSourceSha256,preparedAt}` or a safe
failure. `preparedAt` is the Edge server UTC ISO timestamp after proof completion
and final marker readback; it is never part of either canonical digest. No source snapshot, raw history/site fields, credential, claim token or
actor UUID is added to the response.

The normal preparation path calls `readOwnerCensusPreparation`, which computes
both canonical digests directly from its independent exact binding. It does not
construct an enrolled record, invent a native guard, or set authorization claims.
The existing four-field proof and once routes remain separate and require the
real immutable enrollment. Preparation performs no policy write, allowance
consumption, provider call or forwarding. A positive receipt describes the checked
sources only; enrollment and any later one-shot action remain separate steps.

This normal actor-authenticated path resolves the offline legacy-epoch collection
dependency: `cos_camera_identity_epochs_v1` requires the original actor's auth.uid.
Do not extract its bearer, set JWT claims, impersonate that actor, or reconstruct
private epoch SQL through a connector. The offline validation helper still requires
explicit independently trusted UTC and independently collected authorized inputs;
its authorization structure is never a public authentication mechanism.
