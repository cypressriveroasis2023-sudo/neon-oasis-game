# Reviewed Shop address enrichment

The API collector deliberately leaves Shop source addresses empty. CSV staging
must not confuse a known company postal address with a new physical installation.
This exception requires a complete reviewed portal-bound API baseline, an entirely
empty API address, explicit API service-not-collected evidence, exact unchanged
Product ID/label/category/customer/Shop/lifecycle, and the same address and identity
in the latest earlier reviewed CSV batch. When that Product ID was not in the
last CSV Shop inventory, the current verified API Shop assignment can instead use
the company’s single unanimous postal address in that sealed CSV. A conflicting
historical Shop row for the same Product ID always blocks this fallback; another
row supplies postal evidence only, never identity or physical location. That historical batch must pass its
stored payload checksum and complete unique-ID coverage. It never searches past a
conflicting or invalid latest CSV to find an older convenient match.

The snapshot adds bounded private historical Shop source evidence. Preview retains
the raw address-change count and labels eligible samples as enrichment. Admission
planning excludes only proven enrichment from assignment holds. Stage independently
reads the sealed history under its existing source lock. Existing scoped, stale
native/tracker, identity and lifecycle holds run first. Retained binding bytes and
guard digests are unchanged; the original CSV bytes and address remain intact.
Commit still checks the census digest, active/scoped revisions, expiry and current
native guards. No native location, camera, IP/SIM, GPS, history, scheduler or provider
record is written by this correction.

Release requires passing latest-head PR gates, exact fresh installed function
readback, and the guarded SQL/runtime builders. `prepareMhelpShopAddressSql` patches
only three stage anchors and the outer snapshot expression, retaining installed
security/configuration and all other bytes. It compares current definitions inside
the transaction and aborts on drift. The helper is private invoker code with execution
revoked from public/anon/authenticated/service_role; no access grant is added. The
runtime builder preserves all existing deployed bytes and config. Verify deployed
file equality, function attributes and actual served version before asking the Owner
to rerun preview. This release does not stage or commit the user's file.

Real customer/placement/address changes remain held. Existing Fleet Shop return
records a native move but does not restore held camera associations or update CSV
guards. The camera Owner identity confirmation binds physical resources and is not
an mHelp Product-ID reassignment approval. Scoped inventory review can preserve
source bindings for specific assignment corrections, but it is an administrator
transport, not the authenticated CSV workflow, and the CSV stage deliberately holds
scoped-authority rows. None should be used to silently refresh the two stale guards.
The five genuine changes therefore require an exact current-state Owner association/
installation reconciliation path before committing a source with those holds; this
patch does not claim to implement or authorize that separate path.
