# Service daily report rollout

The deployed host fixes the phone sign-in layout and Enter-key behavior. It keeps the existing password authentication, inspection and inventory authorization. Service Home hides ticket lookup and department assignments. A single **Complete & Send to Ops Manager** action saves stock, physically verifies it, snapshots today's passed inspection and photos, and returns home.

## Evidence and completion

Four units (Sniper, Ranger, Spotter, Solar Spotter) each require one front photograph and one rear unit-tag photograph. Each of the three individual SIM cards requires its own front and back photograph, associated with SIM slots 1, 2 and 3. Each battery type (Recon batteries, AGM 12V 110Ah, LiTime 12V 100Ah and 12V 35Ah) requires its own photograph, with a second optional photograph per type. This is 18 required / 22 maximum photos per daily submission. Apply `service-daily-individual-sim-photos-v2.sql`, followed by `service-daily-battery-type-photos-v3.sql`. Existing public endpoints preserve identical historical submission retries while enforcing the new photo contract on new submissions. SIM numbers remain strings, including leading zeros. Images are converted to JPEG, at most 1920 px on the longest edge and 5 MB each. The technician must ensure the tags are readable.

Drafts and images live in IndexedDB, scoped by authenticated technician and Chicago work day. Offline, upload and submission failures preserve the draft. Server completion is atomic and idempotent by report UUID: no shortage, failed inspection, missing object or incorrect photo identity can create a completed archive. Submitted records and evidence cannot be overwritten by technicians. A correction creates another report version rather than rewriting history.

## Server delivery connection — required before claiming delivery is live

Project: **Cameras On Site**, `goqrnolcvqnirjmzaeyk`. Function: `service-daily-delivery`.

The Google account is **jmartin@camerasonsite.com**, verified from connected account identity and recent Operations Manager signatures. Destination folder:
https://drive.google.com/drive/folders/1sEOK-nffQB46pcSj7rifT-9Huts4P2B4

Its literal name is `TechCheck Truck/Trailer/Truck Inventory`. Each submission creates a dated technician subfolder containing a readable HTML report, JSON answers and inventory, and all JPEG photos. The email contains all answers, exact stock and private Drive photo links. The connected sender must be James's verified Google identity; the server rejects other identities.

Configure a work-owned Google OAuth client with Drive and Gmail APIs enabled and obtain offline consent from James. Required scopes are `openid email`, `https://www.googleapis.com/auth/gmail.send`, and Drive access to the destination folder (`drive.file` if the folder was explicitly granted to the same OAuth app via Picker; otherwise `https://www.googleapis.com/auth/drive`). Store only in Supabase Edge Function secrets:

- `TECHCHECK_GOOGLE_CLIENT_ID`
- `TECHCHECK_GOOGLE_CLIENT_SECRET`
- `TECHCHECK_GOOGLE_REFRESH_TOKEN`

Never paste secrets into chat, source code, browser local storage or the technician application. The ChatGPT Drive/Gmail connection and the existing Sheets service account do not provide these app credentials. No outgoing email service was configured when this work was prepared. Automatic delivery therefore remains blocked until the app connection is configured and verified with an authorized real report. Do not claim that reports were emailed or archived based on a folder creation or local provider simulation.

The daily queue stores a pending/blocked state independently of completion. The authenticated technician can request delivery for their own report; a Vault-authenticated server cron retries every five minutes. Leases prevent concurrent processing. Provider-generated Drive IDs are saved before file creation, allowing safe retries after timeouts. Email is sent after all archive objects are confirmed. An ambiguous email timeout stops for review instead of sending a duplicate; an administrator should verify the deterministic Message-ID before any manual retry. There is no automatic expiration of evidence or reports.

## Deployment

1. Apply `service-daily-reports-v1.sql` as an additive migration.
2. Deploy `supabase/functions/service-daily-delivery/serve.ts` with its local dependencies. Gateway JWT checking is off because the handler itself verifies a Supabase user token or the Vault scheduler secret; it never accepts an unauthenticated delivery request.
3. Apply `service-daily-delivery-v1.sql` to install the server-only queue API and scheduler. Its random scheduler secret stays inside Vault and is not returned.
4. Publish the host assets through the repository's existing Pages deployment.

Legacy `app.js`, the protected technician wizard and protected migrations are unchanged. Existing submitted inventory remains in its original tables; new daily records are additive. An accepted submission is marked completed even when external delivery is pending, and the home screen states that delivery is pending.

## Validation

Disposable SQL tests cover atomicity, idempotency, evidence validation, role/identity isolation, private access, shortages and queue leases. Provider simulations cover unauthorized callers, missing configuration, archive-before-mail ordering, persisted Drive IDs and ambiguous email failures. Browser tests exercise real legacy inspection/rendering code with synthetic identities and fully intercepted requests, including phone/desktop layout, conditional trailer checks, one-button completion, exact SIM strings, photos, failure recovery and unchanged Owner/IT tools. No synthetic production technician reports or test emails are sent.

## Attachments and technician sign-off (v4)

Apply `service-daily-signoff-attachments-v4.sql` after v3. Technicians can use the native photo/library picker for each evidence slot and attach up to ten additional saved images. Extra images are converted to private JPEG evidence with the same actor/submission path restrictions; each can be removed before completion. The required truck, SIM and four battery type photos remain required.

A technician must sign on screen or choose the keyboard alternative and type their own account name, then explicitly confirm the accuracy statement. A blank drawing, missing confirmation or different typed name cannot complete the check. Changing an inventory entry, photo or attachment clears the confirmation. Drawn signatures are stored as private JPEG evidence. The server binds the sign-off to the authenticated account ID, canonical profile name/username, a fixed statement/version and the database completion timestamp. Client-supplied signer IDs, times or statements cannot replace those values. The readable report ends with the sign-off and a Chicago date/time; the JSON archive retains the exact timestamp and account identity.

Earlier report versions are preserved as unsigned history and can only retry their identical saved submission through earlier endpoints. New submissions require sign-off; no historical signature is invented. This records the technician's acknowledgment of the report; it makes no claim about legal enforceability. The external Google delivery connection requirement above remains unchanged.
