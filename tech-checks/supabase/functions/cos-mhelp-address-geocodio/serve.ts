import {createMhelpAddressGeocodioHandler} from './index.ts';
const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(createMhelpAddressGeocodioHandler({apiKey:Deno.env.get('GEOCODIO_API_KEY'),rpc:async(name,args)=>{
 const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
  body:JSON.stringify(args),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('RPC unavailable');return await response.json();
}}));
