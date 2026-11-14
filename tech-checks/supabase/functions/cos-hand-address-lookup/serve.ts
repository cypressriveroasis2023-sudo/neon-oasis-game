import {createFleetVerifier} from '../camera-field-geocode/fleetAuthorization.ts';
import {createHandAddressLookup} from './index.ts';
const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const request = async (path: string, init: RequestInit) => {
  const response = await fetch(url + path, {...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw Error('lookup_http');
  return response.json();
};
Deno.serve(createHandAddressLookup({
  verifyFleetActor: createFleetVerifier(request, service),
  geocodioApiKey: Deno.env.get('GEOCODIO_API_KEY'),
}));
