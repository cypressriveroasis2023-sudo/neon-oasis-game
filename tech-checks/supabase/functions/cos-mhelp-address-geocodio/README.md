This worker runs only operator-enrolled mHelpDesk address-reference jobs in the
legacy COS geocoder project. It does not import equipment, join native/camera
identities, change placement, or publish coordinates. Native Census results and
the current source file remain authoritative.

The handler uses the existing `x-camera-cron-secret` verification RPC and the
project's existing `GEOCODIO_API_KEY`. Deploy with gateway JWT verification off
because the handler independently authenticates that existing operator secret.
No browser route, new credential, or caller-supplied address is accepted.

Release procedure:

1. Merge through the existing protected checks. Apply the additive migration
   `operations/db/20261018021255_cos_mhelp_address_geocodio.sql` to the legacy
   geocoder project only. It requires the existing account ledger and preserves
   the original Owner and native-import job constraints.
2. Deploy this directory with `serve.ts` as entrypoint. Confirm readback matches
   the merged files. Do not replace `camera-field-geocode` or the native bridge.
3. Re-read the current authorized native source snapshot and reconcile its exact
   source/payload hashes, Field Product IDs, and unresolved street addresses.
   Enroll only the specifically approved address-only batch, one row per source
   address hash. Enrollment is operator SQL, never a public RPC.
4. Invoke one enrolled address at a time using its three source hashes. Read the
   existing cron secret inside the server-side request; never print or export
   either credential. Check a small sample before continuing the batch.
5. Every actual provider send has one durable typed reservation in the same
   account ledger, atomic daily credit limit and account-stop state used by the
   existing geocoder. Missing configuration consumes no credit. There is no
   automatic provider retry, refund or separate allowance. Provider 403/429
   signals stop subsequent requests through the existing shared account state.
6. Review the private sanitized receipts. A received result is not an accepted
   coordinate. Reject street/ZIP/city centers, ambiguity and unsupported methods.
   Record only independently acceptable results in the native private address
   resolution table, bound to the still-current source/payload/address hashes.
   Flag discrepancies and preserve the original mHelpDesk address.
7. Verify the actual authenticated map, complete Field Product-ID coverage, Shop
   exclusion, and before/after source/equipment/history fingerprints. Unresolved
   addresses and provider failures remain actionable; they never remove units.
