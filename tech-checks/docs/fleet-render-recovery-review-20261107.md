# Fleet render recovery — November 7, 2026 (review only)

Observed iPhone evidence shows the Operations auth link connected but Fleet rendered its catch boundary: “Fleet couldn't display / RenderError” and, separately, the fallback displayed Nov 3 completed totals without the field unit detail view. An earlier Nov 7 screenshot showed a later saved aggregate and a failed detailed health read. Those are dated observations, not current fleet availability.

## Narrow source changes
- App's existing outer Fleet recovery boundary now offers read-only, searchable **Field or Shop Product-ID records from the last server-provided durable Fleet status**, when and only when its mHelp source envelope validates in full. It does not issue a network request, rescan, change an IP, or bind an identity.
- Preserve the original saved reading and timestamp in the existing fallback. Recover service/customer addresses from the validated mHelp source rather than requiring GPS.
- Guard four explicit source-accounting conflicts during Fleet Command Center projection. These now show an unavailable/diagnostic banner rather than crashing the whole Fleet view. Unknown errors still go to the existing error boundary; no validation rule is weakened.
- Exact Product IDs remain the only source identity. Shop remains separated; no inference of online/offline from raw mHelp records.

## Tests and release conditions
The new unit tests verify correct count/label/addresses, rejection of incomplete or duplicate source receipts, no invented camera health or IP fields, intentional accounting fail-closed behavior, and propagation of unexpected errors. The full build and existing regression suite must run on this exact commit with committed built assets matching the source before release.

This review does not prove the exact production RenderError cause; the runtime currently exposes only a generic error reference. The broader session-cache-loss candidate (PR #363) and database read-contention candidate (PR #365) remain separate and require integration testing against merged VISION main. No production data or backend was changed.
