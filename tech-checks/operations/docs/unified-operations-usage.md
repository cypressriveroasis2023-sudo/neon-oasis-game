# Working in COS Operations

## Tech Checks

Use **Tech Checks** for IT and Service checklists, check assignments, readiness,
review and technician tools. Return and browser Back/Forward bring you to the same
workspace without resetting an in-progress checklist. Shared IT queue jobs remain
in the crew's native assignment flow.

## Field View and Camera Health

Select a unit in Field View to inspect its Camera Health, then choose Service,
Pickup, Install / Delivery or Swap to open a reviewable ticket draft for that unit.
Customer and site are filled only when current records verify the association.
Opening or cancelling the draft does not create a job or assign equipment.

Provider-system status, individual camera/detector observations and service-port
reachability are separate. An online recorder does not prove its camera channels
are online. Older observations remain visible with their age; silence is not an
outage. Location-review groups remain visible without claiming field placement.

Current map pins require verified installation coordinates. Historical positions
are labeled separately and are excluded from nearby routing. Verified location
editing appears only when the backend supports its independent readback checks.

## PDF import and return visits

PDF import appears only when its protected backend is enabled. Review the printed
source ticket number, customer/site association and extracted instructions before
saving. An existing source ticket opens the existing job rather than creating a
duplicate. Original PDF copies remain recoverable through import history.

Eligible completed deliveries can request a separate required return visit when
that feature is enabled. The original completed visit and evidence are preserved.
Schedule the return normally; its own assigned technician must complete its Tech
Check before the job can proceed through closeout. Closing the dialog never saves
a return request.


## Camera access restoration checks

Sniper and CAM V cards show IP / PORT ONLINE or OFFLINE only from recent saved service evidence. Camera channel coverage remains separate. Resource details link to the existing authenticated Camera Health record by exact device ID, where saved IP addresses and configured ports remain available after a failed, stale, or missing check. Only known web ports receive HTTP(S) links; other ports, including Unity client/service ports, stay explicit IP:port values.

The default unit and browser suites use synthetic data. The three production auth/CORS smoke checks in `tests/backend-live.test.mjs` are visibly skipped unless `COS_RUN_LIVE_SMOKE=1` is explicitly set. Do not set this flag in normal CI or restoration testing. After separate authorization for production checks, the opt-in command is `COS_RUN_LIVE_SMOKE=1 node --test tests/backend-live.test.mjs`. It does not certify any camera or video stream. The default/opt-in gate itself is tested with mocked requests.
