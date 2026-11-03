import {createLegacyProductTcpHost} from './host.ts';
import {createProductTcpHandler} from './index.ts';
declare const Deno:{env:{get:(key:string)=>string|undefined};connect:import('../_shared/exact-product-producer/tcpProbe.ts').TcpConnect;serve:(handler:(request:Request)=>Promise<Response>)=>void};
// Reviewed source switch, NOT an environment opt-in. Disabled => no credential
// reads, auth calls, source calls, sockets or RPC calls.
const ENABLED:boolean=false;
Deno.serve(ENABLED?createLegacyProductTcpHost({enabled:true,
 legacyUrl:Deno.env.get('SUPABASE_URL')!,serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
 nativeProofUrl:Deno.env.get('COS_NATIVE_PRODUCT_PROOF_URL')!,nativeOrigin:Deno.env.get('COS_NATIVE_PRODUCT_PROOF_ORIGIN')!,
 fetch,connect:options=>Deno.connect(options),
}):createProductTcpHandler());
