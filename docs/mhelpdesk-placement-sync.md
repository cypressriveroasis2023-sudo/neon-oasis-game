# Reviewed mHelpDesk placement feed

The protected `cos-mhelp-placement-sync` endpoint reads equipment/customer assignments and saves private placement observations. It reuses the existing camera scheduler verifier and server-held mHelpDesk token manager. It never writes to mHelpDesk, provider telemetry, native equipment, operational tracker rows, GPS, sites or jobs.

An administrator admits explicit equipment IDs only after a live same-portal equipment read corroborates the existing ProductId source binding, complete stored native/tracker labels and customer/job placement. This is a new reviewed crosswalk, not an assumption that every legacy ProductId is a Partner ID. Formatting/known annotation differences are reviewed before admission; runtime uses exact admitted vendor labels/models and UUIDs. Decimal identities, missing/retired/Do Not Use labels, hardware contradictions, archive conflicts and unverified assignments are held.

The customer rule accepts exactly Cameras Onsite or Cameras Onsite LLC as Shop. Other verified parent customers are Field only with a separately verified installation service-location record. A billing/account address is never fetched or used as an installation address.

The native reader rechecks a commitment to the full existing tracker/native rows and source revision. New manual edits, GPS, location history, installed-site authority, retirement and identity/archive changes hold the observation. Current legacy placement history has priority in the final map/camera projection. Camera placement crosses only existing complete provider/native identity proofs; it establishes no new camera association. Provider status, router status and battery observations are unchanged.

Assignment changes clear the displayed old address/pin and request location verification. Original operational addresses and GPS/history are retained. Observation age is capped at 40 minutes. The existing UI refresh cadence remains unchanged; the source scheduler runs every 15 minutes. Only one four-minute database lease can start a source run, incomplete inventory reads fail, customer failures are isolated, and expired leases cannot commit. Scheduled responses return aggregate counts only.

## Google tracker boundary

This source feed does **not** publish Google Sheet changes. Its receipts explicitly report `sheetsPublisher:false`. The separately implemented [guarded publisher](google-placement-publisher.md) requires workbook-scoped Editor access, reviewed exact-cell baselines, its own enabled control and verified readback. The connection panel's existing OAuth scope remains read-only; the isolated publisher uses the write scope on the fixed workbook. Do not advertise this source feed as a Google publisher or activate the existing default-off ticket intake/pending queue.

## Release

Run the focused runtime/database tests, full repository checks and hosted real PostgreSQL placement lease contention gate. Apply the private schema artifact; verify its ACLs. Compose the changed native modules over a fresh deployed readback, deploy the maintenance function with custom scheduler authentication, and verify anonymous denial. Admit only freshly reviewed private crosswalks, then enable the source control and schedule using the existing Vault credential in the original camera project. Keep all actual customer/unit crosswalk data out of GitHub. Verify complete live reads, exception counts, current map projections and unchanged operational/GPS/provider preservation hashes. Disabling the private control or schedule stops further observations without deleting history.
