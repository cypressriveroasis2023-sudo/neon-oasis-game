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
export type HandPoint={status:'success'|'no_match'|'invalid_address'|'provider_error';reason:string;latitude?:number;longitude?:number;matchedAddress?:string};
const UNSAFE=/[\r\n<>@=]|https?:|password|passwd|pwd|token|secret|credential|gate[\s-]*code|access[\s-]*code|\bpin\b/i;
export async function handAddressPoint(value:unknown,requestFetch:typeof fetch=fetch):Promise<HandPoint>{
 if(typeof value!=='string'||!value.trim()||value.length>200||UNSAFE.test(value))
  return {status:'invalid_address',reason:'An address cannot contain a link, an email, or a gate or access code. Enter the street address only.'};
 const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
 url.searchParams.set('address',value.replace(/\s+/g,' ').trim());
 url.searchParams.set('benchmark','Public_AR_Current');url.searchParams.set('format','json');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await requestFetch(url.toString(),{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)return {status:'provider_error',reason:'The address service is unavailable right now, so there is no pin yet. Save the address again later to try for one.'};
  const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.length;if(size>262144){await reader.cancel();throw Error('large');}chunks.push(chunk);}
  const joined=new Uint8Array(size);let offset=0;for(const b of chunks){joined.set(b,offset);offset+=b.length;}
  const matches=JSON.parse(new TextDecoder().decode(joined))?.result?.addressMatches;
  if(!Array.isArray(matches))throw Error('shape');
  if(!matches.length)return {status:'no_match',reason:'The address service could not find that address, so there is no point to pin. Check the street number, city and ZIP.'};
  if(matches.length>1)return {status:'no_match',reason:'That address matches more than one place. Add the city and ZIP so the pin lands on the right one.'};
  const match=matches[0],latitude=match?.coordinates?.y,longitude=match?.coordinates?.x;
  if(typeof latitude!=='number'||!Number.isFinite(latitude)||Math.abs(latitude)>90||typeof longitude!=='number'||!Number.isFinite(longitude)||Math.abs(longitude)>180||(latitude===0&&longitude===0))
   return {status:'no_match',reason:'The address service found the address but gave no usable location, so there is no pin.'};
  const matched=typeof match.matchedAddress==='string'?match.matchedAddress.trim().slice(0,200):'';
  return {status:'success',reason:'Pinned at the location the address service has for this address.',latitude,longitude,...(matched?{matchedAddress:matched}:{})};
 }catch{return {status:'provider_error',reason:'The address lookup could not complete, so there is no pin yet. Save the address again later to try for one.'};}
 finally{clearTimeout(timer);controller.abort();}
}
