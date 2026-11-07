# Native IT saved-reading release source

This directory preserves the exact candidate from the merged PR #361 recipe, based on native production v154. The only application-code change is the 43-byte addition `productionTechnicianUserId:context.actorId,` inside the existing successful verified IT `GET /api/session` response. The other seven recorded files are byte-identical.

The frontend needs this verified actor ID to restore saved Fleet readings for the correct IT user. Authentication, organization and role checks, capabilities, Owner responses, saved observations and timestamps, and unrelated routes remain unchanged.

## Package and rollback

Keep the existing two-file `index.ts`/`deno.json` deployment shape. Change only the immutable import URL in the recorded v154 wrapper to this directory's `serve.ts` at the published source commit. Retain the exact live wrapper `deno.json` and `verify_jwt:false`; existing internal authentication remains enforced.

The original wrapper is preserved in `../fleet-provenance-repair-20261104/deployment-v154.json` and was independently read back before this release. It is the rollback payload if this bounded release fails verification. Recheck status, version, archive hash and exact wrapper immediately before deployment; unexpected live drift requires review.

## Verification

All 25 exact native handler tests passed at merged main `f27daa5eb8d5b88ac30792e0ca1f4a1a0ed6851d`. The recorded builder's dry run verified all eight source and candidate hashes. Import closure and entrypoint startup checks confirmed the same module graph, environment reads, single handler registration and unauthenticated rejection with no network calls.

These checks do not by themselves establish authenticated IT browser behavior in production. Deployment metadata, wrapper readback and live browser verification are recorded separately after release. No inventory, Field/Shop, IP, provider-binding, schema or schedule mutation is part of this source package.
