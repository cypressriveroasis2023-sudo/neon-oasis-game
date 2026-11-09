/** A delayed 401 from an older pair must not rotate a newer stored pair. */
type Config={accessToken?:string;portalId?:string};
export class MhelpPortalChangedError extends Error{constructor(){super('The renewed mHelpDesk account does not match the saved portal.');}}
export async function currentMhelpConfigOrRenew(current:Config,getCurrent:()=>Config|Promise<Config>,renew:()=>Promise<Config>):Promise<Config>{
 const valid=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/\s/.test(v);
 const latest=await getCurrent();if(!valid(latest?.accessToken))throw Error('Current mHelpDesk access is unavailable');
 if(current.portalId&&latest.portalId&&latest.portalId!==current.portalId)throw new MhelpPortalChangedError();
 const candidate=latest.accessToken!==current.accessToken?latest:await renew();
 if(!valid(candidate?.accessToken))throw Error('Current mHelpDesk access is unavailable');
 if(current.portalId&&candidate.portalId&&candidate.portalId!==current.portalId)throw new MhelpPortalChangedError();
 return candidate;
}
