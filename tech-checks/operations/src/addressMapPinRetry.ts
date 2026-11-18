import {censusAddress, type GeoResult} from '../../supabase/functions/camera-field-geocode/censusAddress';

/** Map pin only. The first lookup is Census. The second is the existing
 * fallback when the caller can reach it. Nothing is written to mHelp and
 * placement is not changed. */
export async function retryAddressMapPin(address: string, options?: {
  fetch?: typeof fetch;
  second?: (address: string) => Promise<GeoResult>;
}): Promise<{ pin: [number, number] | null; bothFailed: boolean }> {
  const first = await censusAddress(address, options?.fetch);
  if (first.status === 'success' && typeof first.latitude === 'number' && typeof first.longitude === 'number')
    return { pin: [first.latitude, first.longitude], bothFailed: false };
  if (!options?.second) return { pin: null, bothFailed: false };
  const second = await options.second(address);
  if (second.status === 'success' && typeof second.latitude === 'number' && typeof second.longitude === 'number')
    return { pin: [second.latitude, second.longitude], bothFailed: false };
  return { pin: null, bothFailed: true };
}
