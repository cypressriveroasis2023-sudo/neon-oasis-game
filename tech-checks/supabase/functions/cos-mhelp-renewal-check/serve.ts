// Shared reviewed source is bundled with this unscheduled diagnostic.
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
import {createRenewalCheck} from './index.ts';
const env=(name:string)=>Deno.env.get(name);
const tokens=nativeMhelpTokens(env);
Deno.serve(createRenewalCheck({env,fetch,renewAccess:tokens.renewAccess}));
