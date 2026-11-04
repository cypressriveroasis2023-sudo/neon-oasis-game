# Durable Fleet board

The authenticated Fleet GET reads a shared, dated server record. Due reads start one background job after acquiring the database lease. Manual refresh uses the same lease, with a one-minute force limit; a force request during an active batch queues one follow-up instead of creating concurrent work. A bulk Verify now requests the shared update only after its whole selected batch has finished. These jobs read saved camera, inventory and exact Product-ID connection sources, not a new provider probe schedule.

All source reads must succeed. The existing frontend Product-ID classifier projects the batch on the server. Changed-source, invalid-census, and failed transport results cannot publish. A formerly definitive unit going Unverified with the same binding prevents a partial batch from replacing the completed board. Real completed negative results do replace positives. New or changed identities retain the existing review rules; no old proof is assigned to them.

The completed board and its count/unit log are committed together. Previous full map payloads are evicted after the replacement commits; their counts, unit states and original timestamps remain in the history. The private tables and invoker RPCs are service-only. The existing Owner and approved IT authorization gates protect all screen/history reads. No bearer token is stored.

The frontend restores the recorded evaluation time, uses the pair for both health and map, and polls only while a bounded background job is pending. The independent two-minute connection overlay poll is disabled in this mode. A deliberate Verify now still checks the selected equipment and requests a shared saved-board update afterward. Private-session invalidation clears screen state and fences late reads.

Run tests:

    node --import tsx --test tests/durable-fleet-board.test.mjs tests/durable-fleet-client.test.mjs

Rebuild the deployed pure projection/runtime module with the locked esbuild dependency:

    node node_modules/esbuild/bin/esbuild durable-board/index.ts --bundle --platform=neutral --format=esm --resolve-extensions=.ts,.mjs,.js,.tsx,.json --outfile=../supabase/functions/cos-operations-pages/savedFleetBoard.mjs

Matched deployed function source is archived in `tech-checks/docs/deployed-cos-operations-pages-v146/source`. The database install is `db/fleet-durable-board-install.sql`. Keep deployment source and canonical `index.ts` / `fleetAccess.ts` changes together. The earlier completed-snapshot log remains intact; 48 historical entries were copied as historical count/unit logs without activating an obsolete board as current.

Roll back the client capability flag to the previous source path if needed. Preserve the private history tables; do not delete recorded runs. The backend's new routes can remain unused during a frontend rollback.
