/** The map point for an address a person typed by hand (Owner or verified IT).
 *
 * The strict adapter in censusAddress.ts refuses any match whose spelling differs
 * from the input, because it runs unattended. A hand edit is different: the person
 * is the authority for the address, and it is saved exactly as typed. The address
 * service is asked only where that address is. One place found: that is the pin,
 * and the service's own spelling is kept beside it so the person can see where the
 * pin went. No place, or several: there is no single point to pin; the caller
 * still saves the address, without a pin. Only the address text leaves COS.
 */
export type HandPoint={status:'success'|'no_match'|'invalid_address'|'provider_error';reason:string;latitude?:number;longitude?:number;matchedAddress?:string;provider?:'census'|'geocodio'};

/** Metres between two points, near enough for deciding whether results are one place. */
export function metresApart(a:[number,number],b:[number,number]):number{
 const lat=(a[0]+b[0])/2*Math.PI/180;
 return Math.hypot((a[0]-b[0])*111320,(a[1]-b[1])*111320*Math.cos(lat));
}
/** One place, whatever spelling: several results all within a block are the same address. */
export const SAME_PLACE_METRES=120;
const MAX_BODY=262144;
const UNSAFE=/[\r\n<>@=]|https?:|password|passwd|pwd|token|secret|credential|gate[\s-]*code|access[\s-]*code|\bpin\b/i;
/**
 * Ask the free US Census service first; when it has nothing, ask Geocodio, which
 * covers many ordinary addresses the Census file does not. Geocodio is asked only
 * when a key is configured. Either way the address is saved exactly as typed.
 */
export async function handAddressPoint(value:unknown,requestFetch:typeof fetch=fetch,geocodioApiKey?:string|null):Promise<HandPoint>{
 if(typeof value!=='string'||!value.trim()||value.length>200||UNSAFE.test(value))
  return {status:'invalid_address',reason:'An address cannot contain a link, an email, or a gate or access code. Enter the street address only.'};
 const census=await censusPoint(value,requestFetch);
 if(census.status==='success'||!usableKey(geocodioApiKey))return census;
 const geocodio=await geocodioPoint(value,geocodioApiKey!,requestFetch);
 // The second service ran last and saw the most, so its answer is the one
 // reported - unless it could not be reached at all, where the first service's
 // reason is the one that tells the person what to check.
 if(geocodio.status==='provider_error'&&census.status==='no_match')return census;
 return geocodio;
}
const usableKey=(key:unknown):key is string=>typeof key==='string'&&Boolean(key.trim())&&key.length<=8192&&!/[\r\n]/.test(key);

/** Read a bounded JSON body. Nothing but the address text ever leaves COS. */
async function readBounded(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.length;if(size>MAX_BODY){await reader.cancel();throw Error('large');}chunks.push(chunk);}
 const joined=new Uint8Array(size);let offset=0;for(const b of chunks){joined.set(b,offset);offset+=b.length;}
 return JSON.parse(new TextDecoder().decode(joined));
}
const point=(latitude:unknown,longitude:unknown):[number,number]|null=>
 typeof latitude==='number'&&Number.isFinite(latitude)&&Math.abs(latitude)<=90
 &&typeof longitude==='number'&&Number.isFinite(longitude)&&Math.abs(longitude)<=180
 &&!(latitude===0&&longitude===0)?[latitude,longitude]:null;

async function censusPoint(value:string,requestFetch:typeof fetch):Promise<HandPoint>{
 const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
 url.searchParams.set('address',value.replace(/\s+/g,' ').trim());
 url.searchParams.set('benchmark','Public_AR_Current');url.searchParams.set('format','json');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await requestFetch(url.toString(),{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)return {status:'provider_error',reason:'The address service is unavailable right now, so there is no pin yet. Save the address again later to try for one.'};
  const matches=(await readBounded(response) as any)?.result?.addressMatches;
  if(!Array.isArray(matches))throw Error('shape');
  if(!matches.length)return {status:'no_match',reason:'The address service could not find that address, so there is no point to pin. Check the street number, city and ZIP.'};
  if(matches.length>1)return {status:'no_match',reason:'That address matches more than one place. Add the city and ZIP so the pin lands on the right one.'};
  const match=matches[0],found=point(match?.coordinates?.y,match?.coordinates?.x);
  if(!found)return {status:'no_match',reason:'The address service found the address but gave no usable location, so there is no pin.'};
  const matched=typeof match.matchedAddress==='string'?match.matchedAddress.trim().slice(0,200):'';
  return {status:'success',reason:'Pinned at the location the address service has for this address.',latitude:found[0],longitude:found[1],provider:'census',...(matched?{matchedAddress:matched}:{})};
 }catch{return {status:'provider_error',reason:'The address lookup could not complete, so there is no pin yet. Save the address again later to try for one.'};}
 finally{clearTimeout(timer);controller.abort();}
}

/**
 * The second address service. The person typed the address and is the authority
 * for it, so this asks only where that address is and takes the answer when the
 * service is confident and all its results sit at one place. The key is sent to
 * the service and never returned, stored or logged.
 */
export async function geocodioPoint(value:string,apiKey:string,requestFetch:typeof fetch=fetch):Promise<HandPoint>{
 const url=new URL('https://api.geocod.io/v2/geocode');
 url.searchParams.set('q',value.replace(/\s+/g,' ').trim());
 url.searchParams.set('country','US');
 url.searchParams.set('api_key',apiKey);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await requestFetch(url.toString(),{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)return {status:'provider_error',reason:'The second address service is unavailable right now, so there is no pin yet. Save the address again later to try for one.'};
  const results=(await readBounded(response) as any)?.results;
  if(!Array.isArray(results))throw Error('shape');
  if(!results.length)return {status:'no_match',reason:'Neither address service could find that address, so there is no point to pin. Check the street number, city and ZIP.'};
  const best=results[0],found=point(best?.location?.lat,best?.location?.lng);
  if(!found)return {status:'no_match',reason:'The second address service found the address but gave no usable location, so there is no pin.'};
  // A low score means the service guessed; a guessed pin is worse than none.
  if(typeof best.accuracy!=='number'||!Number.isFinite(best.accuracy)||best.accuracy<0.8)
   return {status:'no_match',reason:'The address services are not confident enough about where that address is to drop a pin. Check the street number, city and ZIP.'};
  // Several spellings of one place are fine; two real places are not.
  for(const other of results.slice(1,20)){
   const at=point(other?.location?.lat,other?.location?.lng);
   if(!at||metresApart(found,at)>SAME_PLACE_METRES)
    return {status:'no_match',reason:'That address matches more than one place. Add the city and ZIP so the pin lands on the right one.'};
  }
  const matched=typeof best.formatted_address==='string'?best.formatted_address.trim().slice(0,200):'';
  return {status:'success',reason:'Pinned at the location the second address service has for this address.',latitude:found[0],longitude:found[1],provider:'geocodio',...(matched?{matchedAddress:matched}:{})};
 }catch{return {status:'provider_error',reason:'The address lookup could not complete, so there is no pin yet. Save the address again later to try for one.'};}
 finally{clearTimeout(timer);controller.abort();}
}
