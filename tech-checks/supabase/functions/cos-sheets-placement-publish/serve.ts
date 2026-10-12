import {createScheduledPublisherRuntime} from './runtime.ts';
import {signSheetsAssertion} from '../cos-operations-pages/googleSheetsRuntime.ts';
Deno.serve(createScheduledPublisherRuntime({getEnv:name=>Deno.env.get(name),fetch,signAssertion:signSheetsAssertion}));
