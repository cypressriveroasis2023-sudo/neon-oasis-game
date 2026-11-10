# Durable Fleet board

The authenticated Fleet GET reads a shared, dated server record. Due reads start one background job after acquiring the database lease. Manual refresh uses the same lease, with a one-minute force limit; a force request during an active batch queues one follow-up instead of creating concurrent work. A bulk Verify now requests the shared update only after its whole selected batch has finished. These jobs read saved camera, inventory and exact Product-ID connection sources, not a new provider probe schedule.

All source reads must succeed. The existing frontend Product-ID classifier projects the batch on the server. Changed-source, invalid-census, and failed transport results cannot publish. A formerly definitive unit going Unverified with the same binding prevents a partial batch from replacing the completed board. Real completed negative results do replace positives. New or changed identities retain the existing review rules; no old proof is assigned to them.

The completed board and its count/unit log are committed together. Previous full map payloads are evicted after the replacement commits; their counts, unit states and original timestamps remain in the history. The private tables and invoker RPCs are service-only. The existing Owner and approved IT authorization gates protect all screen/history reads. No bearer token is stored.

The frontend restores the recorded evaluation time, uses the pair for both health and map, and polls only while a bounded background job is pending. The independent two-minute connection overlay poll is disabled in this mode. A deliberate Verify now still checks the selected equipment and requests a shared saved-board update afterward. Private-session invalidation clears screen state and fences late reads.

Run tests:

    node --import tsx --test tests/durable-fleet-board.test.mjs tests/durable-fleet-client.test.mjs

Rebuild the deployed pure projection/runtime module with the locked esbuild dependency:

    node node_modules/esbuild/bin/esbuild durable-board/index.ts --bundle --platform=neutral --format=esm --resolve-extensions=.ts,.mjs,.js,.tsx,.json --outfile=../supabase/functions/cos-operations-pages/savedFleetBoard.mjs

Matched deployed function source is archived in `tech-checks/docs/deployed-cos-operations-pages-v152/source`. The database install is `db/fleet-durable-board-install.sql`. Keep deployment source and canonical `index.ts` / `fleetAccess.ts` changes together. The earlier completed-snapshot log remains intact; 48 historical entries were copied as historical count/unit logs without activating an obsolete board as current.

Roll back the client capability flag to the previous source path if needed. Preserve the private history tables; do not delete recorded runs. The backend's new routes can remain unused during a frontend rollback.

Production follow-up: the first real batch was stopped by the Edge CPU limit before committing. A bounded pure label parser cache and opt-in, deeply immutable identity-envelope validation remove repeated work without caching health/freshness decisions. The previous unit log is reused for comparison, and derived duplicate inventory is omitted from stored health (clients restore it). The scale test covers 925 equipment records and 739 resources with a 1500ms CPU ceiling, below the 2000ms Edge limit.

Apply `db/fleet-board-staging.sql` after the main install. Staged inputs are private, never returned by the board API, cleared on successful publication, and expired after one hour on subsequent runs. They support diagnosis/recovery of an interrupted worker. Source observations retain their original capture time.

The internal `/api/fleet-map-source` route reads the shared committed map projection for either approved role. It excludes Owner pending geocode previews. Completed publication requires the shared-view marker in SQL, preventing older workers from publishing a role-private map. Normal Owner map tools keep their existing projection and authorization.

## Reliability update, 2026-11-09

Production runs between November 3 and November 9 showed four causes of failed or interrupted batches:

- `/api/product-connections` had a 26-second request budget and needed 22 to 26 seconds, so it returned 503 under ordinary load. A saved-board batch read now sends `X-COS-Fleet-Batch: 1` and is given 40 seconds; browser requests keep 26. Each source is retried up to three times inside the batch budget.
- While a batch was pending, every open client re-read the whole stored board (about 9 MB) every few seconds through `cos_fleet_board_read`. `cos_fleet_board_status` now returns the same record without the payload, and `cos_fleet_board_payload` is read once per worker for each completed board, because a completed payload never changes.
- The batch shared one worker CPU allowance with its own map read and with polls, and was stopped by the platform. Refresh now hands the claimed lease to `/api/fleet-saved-board/produce` on the `cos-fleet-board-producer` function, which runs the same recorded handler. If that function is unavailable the batch runs in the refresh request as before.
- The lease was 120 seconds and a successful batch needed about 109, of which roughly 44 were the staging and commit uploads. The lease is 180 seconds, the batch stops itself at 165, and the full source bundle is no longer staged.

A refresh requested during a running batch was recorded as queued but never started. The batch now starts that one follow-up, as a new request, once the 60-second spacing has passed.

### One producer per run

A batch is owned by exactly one producer. Before reading any source a producer attaches a random token with `cos_fleet_board_claim`, a single conditional update that succeeds once per run and only while that run holds the active lease. Progress, publish and failure writes for a claimed run are accepted only with that token, so a duplicate or late producer stops before reading a source and can neither fail nor replace the claimant's result. An unclaimed run can still be failed, which releases a lease whose hand-off did not start.

A hand-off has three outcomes:

- `accepted` (HTTP 202): the worker claimed the run. The refresh request does no batch work.
- `rejected` (any 4xx): returned before a claim, so the worker did not start. The refresh request claims the run and runs it at once. A follow-up that cannot run in its spent worker is claimed and failed at once with `delivery_rejected`.
- `uncertain` (no response, timeout, 5xx): the request may have been delivered. The caller waits four seconds and then asks for the claim. If a worker started, the claim is refused and the caller touches nothing. If none did, the caller owns the run and runs it, or for a follow-up fails it with `delivery_uncertain`.

If ownership cannot be confirmed because the database is unreachable, the caller attempts a release that only takes effect for an unclaimed run (`dispatch_error`). No path leaves a lease unowned until expiry except a producer that is stopped mid-batch, which is reported as `worker_interrupted` with the last step it reached.

### Lost replies

A database call can take effect and still fail to answer. Two calls matter:

- **Claim.** The token is chosen before the claim is sent and kept. `cos_fleet_board_claim` confirms the same token again, so the caller asks up to four times. If it is never answered, the caller releases the run with that token, which frees it whether that token holds it or nobody does and is ignored if another producer does. On the worker entry, an unanswered claim returns 503 (never 202) while the worker reconciles in the background and runs the batch if its claim did commit.
- **Lease.** Every `cos_fleet_board_begin` carries a request token. Asking again with the same token returns the lease that request was already granted (`replayed: true`) and creates nothing, for forced and queued requests alike.

As a last resort, a token-requested lease that nobody claims within 60 seconds stops blocking the next refresh, is reported `worker_interrupted`, and can no longer be claimed. Leases requested without a token, as the previous handler does, keep the full 180 seconds.

### Deadlines

The lease runs from the moment the database grants it. The claim returns `leaseRemainingMs` by the database clock, and the producer measures everything from that: source reads end 35 seconds before the lease does, and the publish request is limited to 30 seconds or the remaining lease less 3 seconds, whichever is shorter. Time spent on hand-off, grace or claim retries is therefore not counted twice. A publish that is cut off is recorded as `commit_timeout`; the failure write that follows is refused by the database if the board was in fact published. `cos_fleet_board_fail` takes the same lock as `cos_fleet_board_finish` first, so the two cannot interleave.

### Queued refreshes

A refresh is queued in two cases: it arrives while a batch is running, or it arrives inside the 60-second spacing after one has ended. In the first case the producer starts the follow-up after its batch. In the second there is no producer, so the request that was queued waits out the spacing and starts it. Both use an unforced `cos_fleet_board_begin`, which grants the follow-up lease once however many requests ask. Opening or polling in the queued state starts nothing.

Each run stores bounded diagnostics in `runs.diagnostics`: step name, duration, attempt count, HTTP status and the source's own stage/code. No rows, addresses, IPs, identities, tokens or message text are stored. `refresh.diagnostics` and `history[].diagnostics` return them to the already authorized Owner/IT read.

A failed, interrupted or running batch never changes `latest.id`, `latest.completedAt` or the stored payload. Opening and polling claim no lease and read no live source.

Apply `db/fleet-board-reliability-20261109.sql` before deploying the handler. It is compatible with the previous handler, so the handler can be rolled back without reverting the database.

Rebuild the packaged module with:

    node -e "import('esbuild').then(({buildSync})=>buildSync({entryPoints:['durable-board/index.ts'],bundle:true,platform:'neutral',format:'esm',resolveExtensions:['.ts','.mjs','.js','.tsx','.json'],outfile:'../supabase/functions/cos-operations-pages/savedFleetBoard.mjs'}))"

then copy it to `docs/vision-native-preview-20261107/source/` and update both hashes in that manifest.
