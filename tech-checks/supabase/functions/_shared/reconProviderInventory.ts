/** Backend-only identity projection of the complete authenticated Reconeyez inventory.
 * The published cache contains opaque commitments, never GUIDs, names, areas or credentials.
 * Provider area membership is not a physical detector-to-bridge radio pairing. */
export type ReconProviderGroup={areaKey:string;proof:string;bridgeKeys:string[];detectorKeys:string[];bridgePrefixUnique:boolean;bridgeLastEventAt:string|null};
export type ReconProviderInventory={schemaVersion:1;observedAt:string;resourceCount:number;groups:ReconProviderGroup[]};
type Row=Record<string,unknown>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const guid=(v:unknown):v is string=>typeof v==='string'&&/^[A-F0-9]{16}$/.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v===v.trim()&&v.length<=1000;
export async function reconDigest(value:unknown):Promise<string>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
export const reconResourceKey=(id:string)=>reconDigest(['COS_RECON_RESOURCE_V1',id]);
export const reconAreaKey=(area:string)=>reconDigest(['COS_RECON_AREA_V1',area]);
export const reconAreaTuple=(area:string,rows:Row[])=>['COS_RECON_PROVIDER_AREA_V1',area,rows.map(r=>[r.guid,r.type]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))];
export async function projectReconProviderInventory(value:unknown,observedAt:string,events:Row[]=[]):Promise<ReconProviderInventory>{
 if(!Array.isArray(value)||!value.length||value.length>100000||value.some(r=>!object(r)||!guid(r.guid)||!text(r.type)||!text(r.area))||new Set(value.map(r=>r.guid)).size!==value.length||!Number.isFinite(Date.parse(observedAt)))throw Error('Reconeyez complete inventory identities are unavailable.');
 const list=value as Row[],bridges=list.filter(r=>String(r.type).startsWith('bridge'));
 const groups:ReconProviderGroup[]=[];
 for(const area of [...new Set(list.map(r=>r.area as string))].sort()){
  const members=list.filter(r=>r.area===area),bs=members.filter(r=>String(r.type).startsWith('bridge')),ds=members.filter(r=>String(r.type).startsWith('detector'));
  if(!bs.length&&!ds.length)continue;
  // A collision in the short hardware-prefix namespace denies assignment; it never creates one.
  const bridgePrefixUnique=bs.every(b=>bridges.filter(x=>(x.guid as string).slice(2,6)===(b.guid as string).slice(2,6)).length===1);
  const times=bs.length===1?events.filter(e=>e.external_device_id===bs[0].guid&&typeof e.observed_at==='string'&&Number.isFinite(Date.parse(e.observed_at))&&Date.parse(e.observed_at)>0&&Date.parse(e.observed_at)<=Date.parse(observedAt)).map(e=>new Date(e.observed_at as string).toISOString()).sort():[];
  groups.push({areaKey:await reconAreaKey(area),proof:await reconDigest(reconAreaTuple(area,members)),bridgeKeys:(await Promise.all(bs.map(b=>reconResourceKey(b.guid as string)))).sort(),detectorKeys:(await Promise.all(ds.map(d=>reconResourceKey(d.guid as string)))).sort(),bridgePrefixUnique,bridgeLastEventAt:times.at(-1)||null});
 }
 return {schemaVersion:1,observedAt,resourceCount:list.length,groups};
}
