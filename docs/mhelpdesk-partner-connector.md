# mHelpDesk Partner API connector

The Owner's Unit Tracker workspace includes a server configuration check and an explicit equipment preview using the [new Partner API documentation](https://www.mhelpdesk.com/partner-api/index.html). The documentation migration does not change the production host, `connect.mhelpdesk.com`.

## Deployed behavior

The existing COS bridge authenticates the existing Owner and linked native identity before reading connector configuration or calling mHelpDesk. Verified IT and Service do not gain these routes. `GET /api/mhelpdesk/partner/status` returns readiness booleans only. `POST /api/mhelpdesk/partner/preview` accepts only an optional full equipment label and reads the first equipment page, capped at 50 records. The UI identifies partial pages explicitly. A successful read verifies API access for that read; configuration alone never means connected.

The explicit preview first calls the production `GET /me` endpoint to verify the token's company `portalId`, then reads that portal's equipment endpoint. A configured portal ID must match the authenticated account; a missing portal ID is resolved for each preview without persisting credentials or changing server settings. The account response has a 16 KiB limit and only the verified numeric portal ID is projected. Username, email, contact fields and other profile data are discarded. The server uses bearer authorization, a field projection, no redirects, a shared 20-second provider deadline, a 1 MiB equipment-response limit and a concurrent-read guard. Errors never echo provider bodies, credentials or request headers. Description, contacts, custom fields, passwords and network credentials are excluded from the preview projection.

This release performs no vendor, spreadsheet, fleet, placement, GPS, IP, telemetry or ticket writes, and has no timer. Camera/Avigilon/Recon connectivity, InHand router connectivity and Victron battery information continue to come from their current providers. mHelpDesk `IsActive` is an administrative flag, not an online/offline signal.

## Connection setup

Configure `COS_MHELP_ACCESS_TOKEN` through the existing Supabase project's protected Edge Function secret settings. `COS_MHELP_PORTAL_ID` is optional: the explicit Owner equipment preview securely resolves it using the [Current User API](https://www.mhelpdesk.com/partner-api/user.html#ep-get-me). If configured, this must be the numeric company portal ID and must match the token's account. It is not a username or password. Do not put credentials in a spreadsheet, repository, public form, browser bundle, log or chat. The API key and client secret are not an access token. The mHelpDesk Developer Access token-generation flow requires password confirmation; production Partner API access also requires vendor approval.

The connector cannot currently refresh tokens. A token may expire; the next read then reports denied API access. Unattended scheduling remains disabled until a reviewed server-side Authorization Code/refresh-token flow, rotation persistence, vendor rate limits and live pagination have been validated. The assistant's Google Drive connection is not backend Sheets authorization.

## Identity and next-stage source admission

Names are preserved exactly, including full variants, leading zeroes and decimal labels such as `023.1`. Exact full-label matches are only review candidates. Imported legacy Product IDs are not assumed to be Partner API equipment IDs. No IP, short unit number or fuzzy match establishes a link.

An existing native metadata binding can be recognized only when `mhelpdeskPartner` contains the exact string `portalId`, string `equipmentId`, `fullLabel` and `model`, and the current native full label still matches. Duplicate candidates/bindings, changed labels and changed models require review. This release does not create bindings or publish changes.

Before enabling tracker/map updates, validate live equipment IDs and full identities, verify customer and installation service-location IDs against the actual response schema, identify placement/IP custom fields by approved IDs, and use the existing source-revision/native-guard rules. The published service-location model does not provide an unambiguous service-location ID; a customer's billing address must never be substituted for installation evidence. Newer Owner/technician address or GPS corrections must retain precedence. Shop/ROOT placement must exclude map pins through existing placement rules. Ticket creation needs its own exact customer/site/unit crosswalk and idempotent reviewed workflow; PUT must preserve all fields because the vendor documents replacement semantics.

## Validation

Synthetic tests exercise Owner-only access, denied IT/Service access before configuration read, decimal identity, explicit binding versus legacy Product ID, duplicate/changed identities, partial pages, oversized/cross-portal responses, request allowlists, concurrent previews, credential exclusion and sanitized errors. Browser fixtures cover setup status, preview review, partial-page wording and separate equipment activity versus connectivity. No production test equipment or rows are created.
