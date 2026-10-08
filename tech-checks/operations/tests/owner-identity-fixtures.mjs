import {fixture as providerFixture} from './native-placement-alias-fixtures.mjs';
import {ownerIdentityDigest,ownerConfirmedPhysicalTuple,OWNER_IDENTITY_ORG} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
import {verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
export const key='SOLARSPOTTER 987654';
export async function fixture(){
 const f=await providerFixture();f.sources.units[0].status='available';f.sources.matches=[];f.sources.providers=[];f.sources.devices[0].unit_key=key;
 const claim={id:'88888888-8888-4888-8888-888888888888',organization_id:OWNER_IDENTITY_ORG,native_unit_id:f.sources.units[0].id,native_unit_label:f.sources.units[0].unit_number,legacy_unit_key:key,device_ids:['9101'],resource_epoch:'a'.repeat(64),physical_digest:await ownerIdentityDigest(ownerConfirmedPhysicalTuple(key,f.sources.devices)),provenance:'owner_confirmation',status:'active',revision:'1'};
 const review={native:{},owner:new Set(),nativeResources:{},ownerResources:{},ownerPhysical:{}};
 f.sources.ownerCrosswalk={revision:'b'.repeat(64),nativeEpochs:[{unitId:f.sources.units[0].id,epoch:'e'.repeat(64)}],claims:[claim]};f.sources.ownerEpochs=[{unitKey:key,epoch:'a'.repeat(64),deviceIds:['9101']}];
 return {...f,claim,review,identity:()=>verifiedHealthIdentities(f.sources,review)};
}
