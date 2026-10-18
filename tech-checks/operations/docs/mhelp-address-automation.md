# Automatic mHelp address pins

After an authorized complete mHelp file becomes the active upload, the native
`cos-mhelp-address-automation` database job detects it within one minute. It
processes the file's actual counts, not a fixed 287/714 baseline. Acceptance of
the original file and existing identity/placement authorization are unchanged.
Address processing does not require GPS or a linked camera identity.

The worker creates an immutable Product-ID/address census for that accepted
source. An identical saved address reuses positive Census or reviewed fallback
results, retaining the provider, point, date and review status. An owner's
explicit corrected address is also reusable. Incomplete original addresses
require every current Field Product ID to belong to the reviewed group and keep
the same recorded customer/site. Returning one product to Shop preserves the
remaining group; new products or changed customer/site context stay unresolved.
A Product ID by itself never authorizes reuse of a previous location.

Only unresolved Field addresses enter the persistent queue. Shared addresses
send once. The worker uses the existing native pg_cron/pg_net extensions and
free US Census structured-address endpoint; no credentials or paid service are
needed. Only street, city, state, ZIP and constant Census query options leave
the database. Customer names, Product IDs and unit identities stay private.
At most eight unique requests are sent per minute. New files and queued results
are checked against the current source/payload before publication. Old requests
are superseded when the active file changes. An advisory lock serializes ticks.

A positive response must contain one numbered address with matching street and
every supplied locality component. Missing locality can be provider-filled;
original source bytes remain unchanged. Coordinates are an address reference
marked for review, never GPS verification. Wrong-city, ambiguous and malformed
results never become pins. The original Census records are not overwritten:
new results append to the existing private resolution ledger.

Provider errors retry with backoff up to six hours. Unmatched addresses retry
weekly, allowing new construction to enter provider data. Unsupported addresses
are rechecked weekly without sending unsafe or incomplete requests. A changed
address in a later accepted file gets a fresh lookup immediately. There is no
operator step to enroll jobs, copy results or restart retries.

Fully automatic processing does not guarantee a geographic match for an
incorrect street or an unnamed bridge. Such records stay visible and retry;
they are not silently assigned a whole-street or city-center point. This version
does not automate browser scraping or invoke Google Maps paid APIs. Existing
reviewed public-site references remain usable and carry forward safely.

## Deploy and verify

Run the address automation, projection, API and client model tests, strict
TypeScript, build, and address-layer browser tests. The automation tests use
synthetic addresses and a local pg_net stub; no provider calls occur in tests.

In the native project, install `db/mhelp-address-automation.sql`, the updated
`db/cos_mhelp_census_map_projection_20261017.sql`, then
`db/mhelp-address-automation-enable.sql`. These files are a single reviewed
migration payload. Publish the UI through the normal main workflow. Rebuild
only the isolated `CosMhelpAddressRelease` helper prefix against the freshly
read deployed bridge, preserving every byte of its protected server suffix.
Do not replace the bridge from an older source bundle.

Verify the active source/payload, complete per-row source hashes, original
Census/native/history/upload fingerprints, Owner/IT snapshot counts, job state,
cron run status and actual Owner map. No new browser/service grants exist;
the private worker functions are invoker functions for the database cron owner.

To pause, unschedule only `cos-mhelp-address-automation`. Keep accepted files,
positive reference evidence and job history. No inventory rollback is needed.

For an already installed worker, `db/mhelp-address-cache-continuity.sql` upgrades
only the private cache-admission function. It preserves existing job state,
source and point evidence and requires no table or inventory recreation.
