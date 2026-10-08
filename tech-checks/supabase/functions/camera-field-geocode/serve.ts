import {createFleetVerifier} from './fleetAuthorization.ts';
import {createGeocodeHandler} from './index.ts';
const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const request=async(path:string,init:RequestInit)=>{
 const response=await fetch(url+path,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Backend unavailable');return response.json();
};
Deno.serve(createGeocodeHandler({
 rpc:(name,args)=>request('/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(args)}),
 verifyFleetActor:createFleetVerifier(request,service),
 geocodioApiKey:Deno.env.get('GEOCODIO_API_KEY'),
 sourceReadKey:Deno.env.get('COS_GEOCODE_SOURCE_READ_KEY'),
}));
