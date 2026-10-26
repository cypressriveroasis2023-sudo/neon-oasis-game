# Review an existing provider mapping

`POST /api/owner-identity/mapped-preview` is a read-only preparation endpoint behind the existing active Owner authorization gate. It accepts only `{productId, unitKey}`. It derives the native unit from the current reviewed Product-ID binding; it never searches by similar labels or accepts a client-supplied unit, proof, actor or timestamp.

Two independent complete source reads must produce the same review digest. The receipt validator, current binding guard, lifecycle/placement holds, native and resource epochs, existing identity reservations, complete-group membership and unique provider ownership all remain mandatory. Saved provider observations must satisfy the existing camera freshness boundary. Source errors and partial reads fail closed.

The response contains resource IDs and types, provider-reported statuses and original observation times. It does not expose serials, IP/SIM values or credentials. Provider-reported online is not a live-video test. An NVR observation is not camera-channel health.

This endpoint returns `reviewOnly: true`, `commitSupported: false` and `liveVideoTested: false`. The review digest is not an Owner confirmation token. No identity, inventory, placement, binding or Sheet write is implemented. Existing mapped units remain excluded from the separate unlinked-identity confirmation workflow.

This change does not include a production identity commitment or a UI button. A future exact identity admission needs its own reviewed scope, fresh evidence, tests and release approval. Deploying this preparation endpoint alone cannot change health counts. Backend deployment must preserve the current deployed source closure; merging source is not evidence of production preservation.

`scripts/mappedIdentityDeployment.mjs` prepares an isolated extension from a complete deployed two-file source response and separately reviewed version, configuration and source hashes. It refuses drift, ambiguous anchors and repeated installation. It bundles only the preview helper, inserts a guarded route, preserves the existing import map and application authentication, and returns an exact rollback payload. Removing its two additions recovers every original runtime byte. Preparation has no network or deployment operation. The helper hash is reported by its synthetic preservation test for comparison with hosted verification.
