// cos-sheets-placement-publish: live v24 serve.ts (commit d962b03) with only the
// endpoint-source reader replaced by the 24-hour inventory grace version beside it.
import {createScheduledPublisherRuntime} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/d962b033234d11a81ada3585725fea9f63749d86/tech-checks/docs/fleet-scheduled-repair-20261104/source/runtime.ts';
import {createScheduledNativeEndpointSourceRuntime} from './trackerEndpointNativeSource.mjs';
import {signSheetsAssertion} from 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/d962b033234d11a81ada3585725fea9f63749d86/tech-checks/supabase/functions/cos-operations-pages/googleSheetsRuntime.ts';
const options={getEnv:(name:string)=>Deno.env.get(name),fetch,signAssertion:signSheetsAssertion};
const publisher=createScheduledPublisherRuntime(options);
const endpointSource=createScheduledNativeEndpointSourceRuntime({...options,enabled:true});
const cameraSnapshotSource=createScheduledNativeEndpointSourceRuntime({...options,enabled:true,snapshotSource:true});
Deno.serve(request=>new URL(request.url).pathname.endsWith('/camera-snapshot-source')?cameraSnapshotSource(request):new URL(request.url).pathname.endsWith('/endpoint-source')?endpointSource(request):publisher(request));
