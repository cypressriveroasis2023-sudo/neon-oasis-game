# Owner assignment review: historical timestamp compatibility

## Observed failure

On October 21, 2026, the exact October 20 CSV staged successfully. After the
PR272 database optimization, the assignment-review RPC returned HTTP 200 in
about 2.7 seconds, but the edge runtime returned HTTP 409 with:

> Protected COS equipment admission: current explicit assignment review required

The deployed v114 response validator required timestamps ending in `Z` or
`+HH:MM`. Saved historical evidence includes valid PostgreSQL timestamptz text
such as `2026-10-13 08:09:49.646709+00`. That explicit hour-only offset caused
352 of the 354 returned review items to be rejected after the database had
successfully produced the review. The five actual CSV assignment changes remain
eligible in the saved database review; these 354 references do not represent
354 new equipment movements.

## Scope

Accept the valid database timestamp representation using a complete timestamp
grammar, calendar checks, clock/offset bounds and a finite date-parse check.
Return the original string, including all fractional digits and timezone text.
Accept ordinary ISO timestamps and PostgreSQL's space-separated explicit
hour-only offset. Reject missing timezones, impossible calendar dates, invalid
clock/offset fields, special timestamp values, extra text and trailing newlines.

Only timestamp validation in `mhelpEquipmentAssignmentReview.ts` changes.
Source/stage/census/digest checks, identities, Shop receipt checks, protected
state, continuity classification, safe field projection and approval checks
remain in place. No SQL migration, stored-data rewrite or automatic guard
refresh is included. The existing authenticated Owner approval and commit
remain mandatory.

## Runtime candidate

`prepareOwnerAssignmentTimestampRuntime.mjs` rejects any drift from the reviewed
v114 serve bundle, configuration, function version and authentication metadata.
It replaces only the assignment-review helper. Every byte outside that helper,
the other runtime file, and runtime configuration are preserved.

The pristine current-main helper rebuild is byte-identical to the installed
31,191-byte helper. This establishes that the unchanged helper dependencies in
the candidate match the deployed implementation.

| Item | SHA-256 |
|---|---|
| Installed v114 serve.ts | `0811c03334092d7aff72695484471116d3976df7cbc542df9eba0fbd38371df7` |
| Installed deno.json | `c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be` |
| Prepared serve.ts, 982,256 bytes | `4353ed28cc58bc52858f949678c6b395ee60b447f625bd06af9e8c0efd5b4a8e` |
| Prepared assignment-review helper | `db75da92a418caac35a3678851a134f3406eaf13850fc9cf446913ec12e2c8c6` |

No UI/Pages publication is necessary for this runtime-only repair. A later
runtime version or changed bundle requires a fresh preservation review; do not
overwrite it with this candidate.

## Validation

- A synthetic 1,001-record / 354-review-item fixture covers all five required
  assignment cases, including tracker-only equipment and existing Shop receipts.
- Focused tests cover accepted timestamp spellings, invalid dates/zones, full
  safe review/digest equality, sensitive-field exclusion, stale source/census/
  stage/digest rejection, identity/continuity conflicts, late failures, retries
  and exact approval-digest forwarding.
- Runtime tests cover preservation outside the helper, ambiguous anchors and
  rejection of version, source-byte, configuration or authentication drift.
- Strict targeted TypeScript compilation passed.
- Offline replay of the actual saved review: the old deployed validator rejects
  352/354 items; the prepared helper accepts all 354. Complete safe projection,
  original timestamp strings and review digest are preserved; all five required
  cases remain eligible. This replay performed no production writes.
- The existing guarded Owner workflow retains all earlier transactional tests
  and adds the focused timestamp/runtime checks. Hosted results are recorded on
  the pull request.

## Approval and import boundary

This new protected runtime validation change requires separate Owner approval
before deployment. Earlier PR272 approval covers the already installed SQL
optimization, not this candidate. No additional database migration is proposed.

After approval, refresh the installed runtime, verify the exact baseline, merge
the tested head, deploy only the guarded candidate and save an exact readback.
Then retry the authenticated Owner assignment review. Use a fresh preview/stage
if the current stage has expired; never extend its expiry or refresh bound
guards manually. The original CSV remains unapplied until protected review,
assignment approval and commit succeed. Require the exact-file receipt and
saved inventory/binding/map-placement readback. Inventory is not camera health.
