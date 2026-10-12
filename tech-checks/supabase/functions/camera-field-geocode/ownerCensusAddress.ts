import {parseOwnerInstallationAddress} from '../_shared/ownerInstallationAddress.ts';
import {censusAddress,type GeoResult} from './censusAddress.ts';
import {fullMatchedParts,censusInstallation} from './importedAddress.ts';
/** Keep legacy no-suite behavior; only the explicitly parsed Owner suite uses the structured adapter. */
export async function censusOwnerAddress(value:string,requestFetch:typeof fetch=fetch,now=()=>new Date().toISOString()):Promise<GeoResult>{
 const parsed=parseOwnerInstallationAddress(value,fullMatchedParts);
 if(!parsed?.secondaryUnit){
  if(typeof value==='string'&&/\b(?:suite|ste)\b/i.test(value))return {status:'invalid_address',reason:'invalid_address'};
  return censusAddress(value,requestFetch,now);
 }
 const result=await censusInstallation(parsed.installation,requestFetch);
 return result.status==='success'?{...result,geocodedAt:now()}:result;
}
