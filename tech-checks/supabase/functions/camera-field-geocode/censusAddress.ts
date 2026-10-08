/** Strict address-only Census adapter. No unit/customer/token data leaves COS. */
export type Parts={street:string;city:string;state:string;zip:string};
export type GeoResult={status:'success'|'no_match'|'invalid_address'|'provider_error';reason:string;latitude?:number;longitude?:number;matchedAddress?:string;geocodedAt?:string};
const aliases:Record<string,string>={ROAD:'RD',STREET:'ST',AVENUE:'AVE',BOULEVARD:'BLVD',DRIVE:'DR',LANE:'LN',COURT:'CT',PLACE:'PL',PARKWAY:'PKWY',HIGHWAY:'HWY',COUNTY:'CO',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL'};
export const normalizeAddress=(v:string)=>v.replace(/\s+/g,' ').trim().toLowerCase();
export async function addressDigest(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeAddress(v)))),x=>x.toString(16).padStart(2,'0')).join('');}
const streetKey=(s:string)=>s.toUpperCase().replace(/\./g,'').replace(/\b[A-Z]+\b/g,w=>aliases[w]||w).replace(/\s+/g,' ').trim();
export function parseAddress(value:unknown):Parts|null{
 if(typeof value!=='string'||value.length>600||/[\r\n<>@=]|https?:|password|passwd|pwd|token|secret|credential|gate[\s-]*code|access[\s-]*code|\bpin\b/i.test(value))return null;
 const m=/^\s*(\d+[A-Z]?\s+[A-Za-z0-9 .'-]+),\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(?:-\d{4})?\s*$/i.exec(value);
 if(!m)return null;
 const states='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(' ');
 if(!states.includes(m[3].toUpperCase()))return null;
 return {street:m[1].trim(),city:m[2].trim(),state:m[3].toUpperCase(),zip:m[4]};
}
export function compareAddress(a:Parts,b:Parts){return streetKey(a.street)===streetKey(b.street)&&a.city.toUpperCase()===b.city.toUpperCase()&&a.state===b.state&&a.zip===b.zip;}
export async function censusAddress(value:string,requestFetch:typeof fetch=fetch,now=()=>new Date().toISOString()):Promise<GeoResult>{
 const parts=parseAddress(value);
 if(!parts)return {status:'invalid_address',reason:'Enter the installation street, city, state and ZIP, for example 123 Main St, Houston, TX 77002.'};
 const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/address');
 for(const [key,val] of Object.entries(parts))url.searchParams.set(key,val);
 url.searchParams.set('benchmark','Public_AR_Current');url.searchParams.set('format','json');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await requestFetch(url.toString(),{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)return {status:'provider_error',reason:response.status===429?'Address service is busy. Automatic retry is scheduled.':'Address service is unavailable. Automatic retry is scheduled.'};
  const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw Error('large');}chunks.push(value);}
  const joined=new Uint8Array(size);let offset=0;for(const b of chunks){joined.set(b,offset);offset+=b.length;}
  const payload=JSON.parse(new TextDecoder().decode(joined)),matches=payload?.result?.addressMatches;
  if(!Array.isArray(matches))throw Error('shape');
  if(matches.length!==1)return {status:'no_match',reason:matches.length?'Several addresses matched. Correct the street/city/ZIP or verify the installation pin.':'No exact address matched. Correct the street/city/ZIP or verify the installation pin.'};
  const match=matches[0],matched=parseAddress(match?.matchedAddress),latitude=match?.coordinates?.y,longitude=match?.coordinates?.x;
  if(!matched||!compareAddress(parts,matched)||typeof latitude!=='number'||!Number.isFinite(latitude)||Math.abs(latitude)>90||typeof longitude!=='number'||!Number.isFinite(longitude)||Math.abs(longitude)>180)return {status:'no_match',reason:'The address service returned a different address. Review the installation address before mapping it.'};
  return {status:'success',reason:'Approximate address-range location. Confirm the exact installation pin when available.',latitude,longitude,matchedAddress:match.matchedAddress,geocodedAt:now()};
 }catch{return {status:'provider_error',reason:'Address lookup could not complete. Automatic retry is scheduled.'};}
 finally{clearTimeout(timer);controller.abort();}
}
