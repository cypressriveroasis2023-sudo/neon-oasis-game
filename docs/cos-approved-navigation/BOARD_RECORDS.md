# COS approved navigation — saved Board record details

Date: November 2, 2026. Existing design branch: `design/cos-approved-navigation-20261101`.
Parent implementation: `779eba55b351c1e5518819d246c6f246efb043ae`.
Main inspected: `38a4fb9e16a565d92fc5bd5c0e5a6f55e7337137`.

This is the next source-only presentation slice in the existing app. No merge or deployment is authorized. The exact-unit shortcut remains unavailable; this change does not pretend that an equipment tag is a verified unit binding.

## Verified blocker, not a guessed join

Read-only catalog inspection of the installed Tech Check Platform functions established:

- `appdeploy_owner_jobs_snapshot` returns `equipmentUnitTag` from `equipment_units.unit_number`, but does not expose the equipment UUID or a Product-ID-to-unit binding in its job response.
- `cos_daily_board_snapshot` builds current jobs from that response. Completed visits have their own composite record ID plus explicit `jobId` and `visitId`; their inherited equipment tag and job notes are current-job information, not verified historical visit equipment or visit-specific notes.
- `appdeploy_owner_tasks_snapshot` exposes the existing task instructions, Owner notes, assignee/department, related job ID and recorded task dates.
- The repository's `/api/daily-board` bridge retains the saved board response and enriches existing go-back data. It does not add an exact equipment-ID link.

Only function definitions were read. No functions were executed to impersonate a user, and no schema, role, permissions, inventory, ticket, source, provider, camera check or production data was changed. These observations establish the response contract, not a signed-in UI walkthrough or current operational coverage.

## Implemented presentation

Click an existing Board job/task to open its existing Work details dialog:

- Show the saved responsible person or department rather than substituting the visual Owner Review lane for the assigned technician.
- Keep workflow status, recorded schedule/due date, job type, equipment model and equipment tag visible. No workflow state is presented as camera health.
- Explicitly say **Unit not linked**. No name/tag/IP lookup or dormant unverified unit link is added.
- Show recorded task instructions as instructions, not a newly inferred progress update. Jobs with no next-step field explicitly say none is supplied; free-text notes are not promoted into a new task or automatic instruction.
- Show saved job notes with supplied author/time and explicit unavailable/malformed states. Task Owner notes and recorded start/completion dates remain separate; an updated timestamp is never invented as a note or completion time.
- Capture the response `asOf` when the record is opened. Later Board refreshes cannot relabel that older selected record with a newer timestamp. Existing session invalidation still clears the selection. The snapshot time is explicitly not a camera check time.
- Open the exact existing COS job through the unchanged canonical Jobs hash. Tasks use an explicit valid `relatedJobId`. Completed visits require matching explicit `jobId`, `visitId` and composite identity, and the action says **Open current job**. Missing/conflicting IDs do not produce a guessed link. This is an existing COS record link, not an invented mHelp URL.

mHelp remains the service-job system. No competing ticket system, creation action, source reader, polling mechanism or operational write was added. Original workspace entry points and management controls remain available with unchanged guards.

## Exact change boundary

Only `tech-checks/operations/src/DailyBoard.tsx` is modified. Four small presentation areas change: two imports, the selected-record type, source-timestamp capture on click and the detail presentation block.

Added files:
- `src/boardRecordDetails.ts` — pure presentation/identity validation, no I/O.
- `src/BoardRecordDetails.tsx` — read-only detail component.
- `src/boardRecordDetails.css` — scoped Board detail styling.
- `tests/board-record-details.test.mjs` — synthetic regression tests.
- This review document.

Source/test paths above are under `tech-checks/operations`. No changes to App, canonical routing, Fleet, Camera Health, Team, TV components, board persistence/counting, source/backend/SQL code, authentication, host files, permissions, assignments, timers, dependencies, workflows or generated assets. Existing PR285 Board overlap must be reconciled at combined release; do not replace the full file from an older branch.

## Verification actually performed

- **32 focused tests passed**, zero failures/skips, using Node 22.16.0 with type stripping. These cover exact job/visit/task identity, invalid/conflicting identifiers, no inferred unit binding, assignee vs lane, source notes and missing values, immutable inputs, timestamp capture and Central daylight/standard transitions.
- The source-preservation regression reverses only the four declared presentation areas and requires the result to equal the original Git blob `7ce8f38df99730e8bbe7f49eb65a221cc6c02cc7`. This protects every original poller, TV handler, count, assignment guard/action and remaining render section.
- Strict standalone model checking and syntax transpilation of the model, new component and DailyBoard passed with locally available TypeScript 5.8.3.
- Tests use synthetic identities and text only. No private customer, employee or operational rows were copied into source or fixtures.

Normal project command: `node --import tsx --test tests/board-record-details.test.mjs`.

The runtime cannot resolve github.com for a local full checkout. Connector reads/writes work, but this session did NOT run the complete React application, its full TypeScript 5.7.3 project check, production build, existing full unit/Playwright suites or authenticated Owner/IT/Service screens. No browser or live readiness claim is made for this slice.

## Remaining release gates

An exact Board-to-unit shortcut needs an approved response contract carrying the saved authoritative identity; this UI-only slice does not change that contract. Full Fleet/unit visual work, combined-source repair reconciliation, full application build/browser/role acceptance and James's combined-release review remain outstanding. Source publication uses skip markers, opens no PR and dispatches no workflow. Hosting skip status and unchanged main must be checked after branch publication.
