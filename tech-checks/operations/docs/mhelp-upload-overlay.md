# Reviewed mHelp equipment upload overlay

This is an offline-prepared private source overlay. It does not replace an API
refresh, write equipment or tracker rows, move a camera, write GPS, or infer camera
hardware identity from a label. Source CSVs, Library IDs, customer data, approval
transcripts, concrete source hashes, generated plans and SQL stay outside git.

## Source and precedence

- Preserve each distinct ProductId and the complete source-file record count.
- Classify company assignments from the reviewed exact customer-ID set. Keep
  recorded FIELD/SHOP separate from UNFLAGGED, DO_NOT_USE and MISSING lifecycle.
- Retain the original CSV hash, Library identity, received-message provenance,
  received timestamp and its precision. The filename and row status dates do
  not establish a timezone, export as-of, API success, or physical verification.
- Review exact ProductId bindings first; additional canonical family/unit links
  require a distinct reviewed evidence artifact. Generations, model families,
  decimal suffixes and unapproved aliases must not be silently collapsed.
- Bind the current authority-graph digest and the exact visible UUID set to each
  review. Changed graph, renamed/missing/extra representations, identity warnings
  and competing ProductId sources hold the assignment projection.
- Newer or undated Owner changes, newer source observations and newer/undated
  verified native location evidence protect the entire bound identity group.
  Minute-precision receipt times use the beginning of the minute conservatively.
- Current CSV assignments can supersede older recorded source placement only
  after these checks. A missing CSV row never deletes or retires tracker data.
- A later confirmed API observation remains visible to the precedence guard even
  on protected Owner/GPS rows. An older upload cannot hide that observation; the
  proven group stays in review unless retained placement is explicitly corroborated
  without a recorded move, or a later protected authority resolves it.

## Private persistence and rollback

`db/mhelp_upload_overlay.sql` is a reviewed deployment candidate, not an applied
migration. It adds private immutable upload batches, a single active pointer and
append-only activation/rollback audit. Private review functions remain restricted
to existing administrator roles. Existing equipment-view actor checks and RPC
ACLs are retained; no credentials, roles or service grants are added.

The offline builder validates original CSV bytes against the receipt and every
sanitized row against those bytes. It writes dry-run, explicit apply, rollback,
normalized-plan and hash-manifest files to a private directory outside this
repository. It never connects to a database or provider. Operators must review
and authorize the plan before executing any prepared SQL.

Admission locks the authority graph, verifies all records and bindings, rejects a
changed active pointer, and commits the complete batch atomically. An identical
active batch is idempotent. Reusing its source hash with different reviewed
content fails. Rollback checks the current activation head and restores the prior
pointer; original API observations, source records, batches and audit remain.

## Read contract

The existing authorized placement snapshot adds `upload`, which is consumed by
`projectMhelpUploadPlacement` after API placement/location projection. The helper
returns `{snapshot, authorities}`; only its matching authority echoes are passed
to the effective placement finalizer.

`uploadInventory` contains the complete equipment-record census, received-at
provenance, source-record counts, lifecycle, source-only customer address and
reviewed binding state. Unlinked source records use a distinct source record ID,
never a fabricated equipment UUID. Customer addresses cannot produce map pins.
The combined roster is responsible for one consistent active count/list across
MHelp-primary records and explicitly reviewed current tracker gaps. Its count
basis must not claim complete physical deduplication while identity holds remain.

## Existing map evidence

The upload can retain an existing point only through the server's independently
validated location-proof map. It never treats CSV customer postal addresses as
installation addresses or geocodes. Manual verified GPS may survive missing older
customer IDs when no positive movement evidence exists. Address estimates require
an exact prior customer assignment or the unique exact customer/site representation
attached to the same reviewed equipment identity. Any original assignment comes
from the same UUID, immutable label and unchanged installation address.

SHOP, changed customer assignment, an explicitly different service address/site,
and a confirmed saved assignment-change marker invalidate old active points while
retaining history. A later independently validated Owner installation can supersede
an older change marker; a later geocode timestamp alone cannot. Original Owner
placement and verification timestamps remain intact. The upload receipt is separate
recorded evidence and does not renew the map's verification date.

## Verification

Run the builder, projection and database test files with Node/tsx. Database tests
use synthetic PGlite fixtures and cover read-only dry run, atomic/idempotent
admission, stale guards, incomplete files, identity collisions, unchanged provider
state, retained rollback evidence and access denials. Production application or
deployment is a separate step and must not be inferred from local test success.
