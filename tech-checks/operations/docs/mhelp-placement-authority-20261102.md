# mHelp placement and tracker recovery

James confirmed that mHelp is authoritative for Field/Shop, customer and site.
A mHelp return to Shop must remove the unit from the Field map and Field outage
totals while retaining its inventory and dated health evidence. Tracker IPs stay
authoritative for connection targets. Avigilon, Star4Live and Reconeyez are camera
systems; Victron power overlaps the camera equipment, rather than adding units.

Live inspection on November 2, Central time:

- Complete mHelp read at10:06PM:925 current products,286 Field,639 Shop,
  76 historical products absent and33 held source differences. Do not restore
  archived products or treat these equipment counts as camera/channel counts.
- Inventory and placement source controls are enabled; placement confirms432
  of434 reviewed links, with2 identity/lifecycle holds.
- The legacy tracker publisher was disabled. The separate operational two-way
  worker is also disabled, has no verified baseline or successful run, and has
  zero mirror, override and outbox rows. It must not be advertised as working.
- Re-enabled the existing mHelp-to-tracker publisher under James's instruction,
  with a guard against competing operational writers and stale mHelp inventory.
  Its existing job and credentials were reused. At10:34PM it completed with
  434 held,0 published,0 recovered,0 unchanged and0 refresh requests. No tracker
  cell was changed by that run. Existing per-cell, identity, manual-edit and
  freshness checks remain intact; enabling a control is not sync completion.

This narrow code change adds aggregate held-reason counts to the authenticated
publisher response after its existing committed finish receipt. It changes no
planner, writes, baseline, identity, source clocks, credentials, routes, schedule
or authorization. The native preparer requires exact v10 archive/source hashes,
changes one response expression and proves exact reversal. Preserve all three
native files, including the endpoint-source and camera-snapshot integrations.

Verification:16 focused publisher/runtime/mHelp-movement checks pass; native
entry compilation and exact rollback pass. The new test checks reason totals,
zero writes for held rows and no unit/customer details in the response.

Remaining integration work: identify the434 holds from actual live diagnostics;
reconcile the current925 Product IDs with exact tracker cells; implement
mHelp precedence for newer assignments before enabling any reverse tracker
worker. Verify real naturally occurring Field-to-Shop and Shop-to-Field changes
through COS inventory, map membership and tracker readback. Never make a fake
production move or clear manual edits merely to demonstrate a successful run.


## Product-ID and freshness diagnosis

The diagnostic run at10:37PM completed with295 source_unverified,
77 manual_sheet_change and62 sheet_identity_changed. A fresh read of the
2027 Product-ID index and bounded equipment identity columns resolves every
one of434 bindings to exactly one current indexed unit. Precisely62 bound
positions/labels differ; no fuzzy or IP match is needed. No bindings or
spreadsheet cells have been changed by this diagnosis.

The source predicate previously considered only the oldest cached customer/site
metadata clock, despite a new complete equipment assignment pass. The additive
SQL proof path instead requires a fresh complete accepted mHelp API snapshot,
exact unique Product ID, full label/model, matching confirmed customer/service/
placement/site, active lifecycle and unheld source, with unchanged native guard
and no operational override. The existing20-minute actual source/control window
and separate3-hour metadata limits remain. No timestamp is rewritten. Existing
fresh direct observations retain their prior path. A read-only production preview
returns415 eligible and19 held, compared with0 eligible under the old predicate.
This is eligibility, not a claim of writes, Field movements or two-way sync.

The guarded migration refuses any unexpected installed definition. Tests cover
unchanged metadata clocks,19 identity/assignment/metadata mutations, duplicate
Product IDs, stale/failed/paused/incomplete/superseded source, native guard and
operational override rejection, old-path compatibility and migration drift.
