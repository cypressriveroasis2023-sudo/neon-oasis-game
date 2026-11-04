import {createScheduledPublisherRuntime} from './runtime.ts';
import {createScheduledNativeEndpointSourceRuntime} from './trackerEndpointNativeSource.mjs';
import {signSheetsAssertion} from '../../../supabase/functions/cos-operations-pages/googleSheetsRuntime.ts';
const options={getEnv:(name:string)=>Deno.env.get(name),fetch,signAssertion:signSheetsAssertion};
const publisher=createScheduledPublisherRuntime(options);
const endpointSource=createScheduledNativeEndpointSourceRuntime({...options,enabled:true});
const cameraSnapshotSource=createScheduledNativeEndpointSourceRuntime({...options,enabled:true,snapshotSource:true});
Deno.serve(request=>new URL(request.url).pathname.endsWith('/camera-snapshot-source')?cameraSnapshotSource(request):new URL(request.url).pathname.endsWith('/endpoint-source')?endpointSource(request):publisher(request));
