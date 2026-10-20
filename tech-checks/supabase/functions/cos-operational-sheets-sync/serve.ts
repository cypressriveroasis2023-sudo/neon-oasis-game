import {createOperationalSheetSyncRuntime} from './runtime.ts';
import {signSheetsAssertion} from '../cos-operations-pages/googleSheetsRuntime.ts';

// Separate scheduled service endpoint. Installation does NOT schedule a job;
// the backend and worker feature flags default OFF pending guarded acceptance.
Deno.serve(createOperationalSheetSyncRuntime({
 getEnv:name=>Deno.env.get(name),
 fetch,
 signAssertion:signSheetsAssertion
}));
