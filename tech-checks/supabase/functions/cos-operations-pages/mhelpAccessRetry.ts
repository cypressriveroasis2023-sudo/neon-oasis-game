/** A delayed 401 from an older pair must not rotate a newer stored pair. */
type Config={accessToken?:string;portalId?:string};
export async function currentMhelpConfigOrRenew(current:Config,getCurrent:()=>Config|Promise<Config>,renew:()=>Promise<Config>):Promise<Config>{
 const valid=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/\s/.test(v);
 const latest=await getCurrent();if(!valid(latest?.accessToken))throw Error('Current mHelpDesk access is unavailable');
 const candidate=latest.accessToken!==current.accessToken?latest:await renew();
 if(!valid(candidate?.accessToken)||current.portalId&&candidate.portalId&&candidate.portalId!==current.portalId)throw Error('Current mHelpDesk access is unavailable');
 return candidate;
}
