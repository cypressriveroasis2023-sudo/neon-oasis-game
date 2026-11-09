# Current mHelp Product ID authority — November 3, 2026

Owner instruction: mHelp is the source for unit names, Field/Shop, customer and
service site. Match by exact Product ID. The 2027 tracker supplies IPs.

The importer copied historical hold reasons into new complete API reads even
when an existing reviewed Product ID link remained intact. Restore only exact
original reviewed mappings with current source revisions and unchanged protected
native state. Current mHelp names/assignments/address clocks are retained.
Unknown holds, changed types/models, inactive equipment and competing mappings
remain protected. No name-only or IP-based identity inference is introduced.

Spotter 261 (2226860) and Solar Spotter 054 (2300344) were real recorded Shop
returns: "Pickup unit" and "Swapped out damaged unit-", respectively. Their old
Field geocoding sources were deliberately tombstoned. The new read-only Shop
proof corroborates the exact Product ID/native/tracker mapping, latest Shop move,
model, tombstone event/revision and current native Shop state. It preserves the
inactive sources and movement history. A later move, GPS/installation evidence,
owner identity claim, archival identity or conflicting product cannot borrow it.

## Verified production results

- All 18 previously source-held records now have persisted bindings and no
  source hold after a new complete vendor import (HTTP 200, request 43857).
- That import accepted source
  `37a0f851fc1d0d89d25eaa69911f04dad83e8ce8f1555d02398489782f845142`:
  925 equipment records, 286 Field and 639 Shop. These are equipment counts.
- Placement receipt committed: 434 confirmed, zero held, using real retained
  mHelp/resource observation timestamps. All 434 also passed source_current.
- The first successful publisher then showed 431 unchanged and 3 manual-cell
  holds. Twice-read cells showed Solar Stands 001/012/013 had correct combined
  customer/site text instead of the saved plain-customer comparison style.
  Existing audited repair_bindings accepted all three and retained their exact
  live cell metadata. No Google cells were written.
- Final authenticated publisher request 43864: HTTP 200, committed true,
  434 unchanged, zero held, zero published and zero recovered. All reviewed
  tracker rows already agreed; no fake placement movement was generated.

The 18 records include 15 camera-capable units and 3 support Solar Stands. The
434 reviewed links are a subset of 925 current mHelp records, not a claim that
all equipment is bound or that every camera connection has been verified. The
accepted source still reports 14 holds outside this repaired set. No telemetry,
provider resource, IP address, camera state or source clock was manufactured.
No browser or authenticated IT/mobile acceptance was performed by this repair.

## Validation and deployment

Eight isolated PGlite tests pass, exercising actual SQL: current label/customer/
site authority; retained source dates/history; malformed or changed evidence;
source/native changes; duplicate and competing Product IDs; tracker-only rows;
Shop/support classification; separately reviewed older placement holds; recorded
Shop returns and rejection after changed event/product/model/GPS/owner/archive
evidence. Production checks confirmed all 18 persisted and the final publisher
receipt above. Existing public function ACLs, SECURITY DEFINER settings, empty
search paths and timeouts were preserved; new helpers are postgres-only.

During acceptance, request 43854 failed at publisher begin with a SQL timeout
because the source predicate repeated the historical restoration scan for every
link. The final predicate uses persisted batch records; restoration runs once at
snapshot/admission. This correction was installed and request 43864 then passed.

The guarded install scripts are consolidated fresh-baseline artifacts. Production
already has the applied migrations; do not blindly rerun the install guards.
On the recorded original baseline apply mhelp-product-id-authority-install.sql,
then mhelp-recorded-shop-return-install.sql. Roll back in reverse order:
mhelp-recorded-shop-return-rollback.sql followed by
mhelp-product-id-authority-rollback.sql. Existing batch histories remain intact.

No frontend change, Cloudflare deployment or camera provider change was needed.
