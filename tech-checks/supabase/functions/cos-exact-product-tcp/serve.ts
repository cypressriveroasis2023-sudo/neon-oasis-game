import {createProductTcpHandler} from './index.ts';
declare const Deno:{serve:(handler:(request:Request)=>Promise<Response>)=>void};
// Deliberately disabled. No environment credential reads, new grants or jobs.
// Activation requires mounting the factory with the EXISTING protected context
// binder and the reviewed legacy receipt migration; an env flag alone cannot do it.
Deno.serve(createProductTcpHandler());
