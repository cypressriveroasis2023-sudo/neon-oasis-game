/** Explicit native-app address authority. Origin file/row evidence stays separate.
 * Actor identities and edit history never cross the geocoder read bridge. */
export const APP_UNIT_ADDRESS_CONTRACT='COS_APP_UNIT_ADDRESS_V1' as const;
export type AppAddressProof={contract:typeof APP_UNIT_ADDRESS_CONTRACT;legacyUnitKey:string|null;legacyIdentitySha256:string;legacyPlacementSha256:string};
export type AppAddressAuthority=AppAddressProof&{revision:string};
type Row=Record<string,unknown>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const keys=['contract','legacyUnitKey','legacyIdentitySha256','legacyPlacementSha256'];
const validProof=(v:Row)=>v.contract===APP_UNIT_ADDRESS_CONTRACT
 &&(v.legacyUnitKey===null||typeof v.legacyUnitKey==='string'&&v.legacyUnitKey===v.legacyUnitKey.trim()&&v.legacyUnitKey.length>0&&v.legacyUnitKey.length<=160&&!/[\x00-\x1f\x7f<>]/.test(v.legacyUnitKey))
 &&sha(v.legacyIdentitySha256)&&sha(v.legacyPlacementSha256);
const proof=(v:Row):AppAddressProof=>({contract:APP_UNIT_ADDRESS_CONTRACT,legacyUnitKey:v.legacyUnitKey as string|null,legacyIdentitySha256:v.legacyIdentitySha256 as string,legacyPlacementSha256:v.legacyPlacementSha256 as string});
export function checkedAppAddressProof(value:unknown):AppAddressProof|null{
 return object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))&&validProof(value)?proof(value):null;
}
export function checkedAppAddressAuthority(value:unknown,sourceRevision?:unknown):AppAddressAuthority|null{
 return object(value)&&Object.keys(value).length===keys.length+1&&keys.every(k=>Object.hasOwn(value,k))&&validProof(value)&&uuid(value.revision)
  &&(sourceRevision===undefined||value.revision===sourceRevision)?{...proof(value),revision:value.revision}:null;
}
