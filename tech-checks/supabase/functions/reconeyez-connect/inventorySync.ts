import {projectReconProviderInventory} from '../_shared/reconProviderInventory.ts';
import {assertReconDeadline,createReconAttempt,knownReconAttempt,reconOwnedFingerprint,
 recoverReconMutation,ReconSourceFailure,ReconOwnedUnknown,type ReconBegin,type ReconDb,type ReconFinish} from '../_shared/reconOwnedMetadataV2.ts';

export type InventoryResult={imported:number;active:number;shop:number;skipped_non_detectors:number};
type ReconDevice=Record<string,unknown>;

/** Validate the complete provider response before any inventory or credential write. */
export async function prepareReconInventory(list:ReconDevice[],observedAt:string) {
 let identity;
 try {identity=await projectReconProviderInventory(list,observedAt);}
 catch {throw new ReconSourceFailure('invalid_inventory');}
 const detectors=list.filter(d=>String(d.type).startsWith('detector'));
 const devices=detectors.map(d=>{
  const guid=String(d.guid),area=String(d.area),shop=/(^|\b)(shop|shop equipment|warehouse|stock)(\b|$)/i.test(area);
  return {external_device_id:guid,device_name:String(d.name||`Reconeyez ${guid.slice(-4)}`).trim(),device_model:String(d.type),organization:area,
   activation_state:shop?'deactivated':'active',activation_source:shop?'reconeyez_shop_area':'reconeyez_area',unit_key:area,
   source_metadata:{guid,area,description:String(d.description||''),reconeyez_type:String(d.type)}};
 });
 return {p_devices:devices,p_identity_inventory:identity,p_observed_at:observedAt,p_inventory_count:list.length,p_skipped_non_detectors:list.length-detectors.length};
}

async function sourceBudget<T>(work:()=>Promise<T>,deadline:number):Promise<T> {
 if(Date.now()>=deadline)throw new ReconSourceFailure('provider_unavailable');
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const result=await Promise.race([new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ReconSourceFailure('provider_unavailable')),deadline-Date.now());}),work()]);
  if(Date.now()>=deadline)throw new ReconSourceFailure('provider_unavailable');
  return result;
 } finally {if(timer!==undefined)clearTimeout(timer);}
}
export async function syncReconInventory(db:ReconDb,list:ReconDevice[],attempt:ReconBegin,
 credentials?:{username:string;password:string},sourceDeadline=Date.parse(attempt.expires_at)-5000):Promise<ReconFinish> {
 if(!['inventory_connect','inventory_sync'].includes(attempt.kind)||attempt.kind==='inventory_connect'&&!credentials||attempt.kind==='inventory_sync'&&credentials)throw new ReconOwnedUnknown(attempt.kind);
 assertReconDeadline(attempt,5000);
 const prepared=await sourceBudget(()=>prepareReconInventory(list,attempt.observed_at),sourceDeadline);
 const owned={devices:prepared.p_devices,identity_inventory:prepared.p_identity_inventory,inventory_count:prepared.p_inventory_count,skipped_non_detectors:prepared.p_skipped_non_detectors};
 // The full canonical value is hashed; credentials and transport identifiers are excluded.
 const fingerprint=await sourceBudget(()=>reconOwnedFingerprint(owned),sourceDeadline);
 assertReconDeadline(attempt,5000);
 const args:Record<string,unknown>={p_devices:prepared.p_devices,p_identity_inventory:prepared.p_identity_inventory,
  p_inventory_count:prepared.p_inventory_count,p_skipped_non_detectors:prepared.p_skipped_non_detectors,
  p_username:credentials?.username??null,p_password:credentials?.password??null};
 const create=attempt.outcome==='absent',token=create?createReconAttempt(attempt):knownReconAttempt(attempt);
 if(create)Object.assign(args,{p_request_id:attempt.request_id,p_observed_at:attempt.observed_at,p_expires_at:attempt.expires_at,p_retain_until:attempt.retain_until});
 else args.p_attempt_id=token.attempt_id;
 return await recoverReconMutation(db,token,create?'recon_create_inventory_v2':'recon_finish_inventory_v2',args,{fingerprint,allowUnknownResult:create,
  validateResult:result=>{if(result.imported!==prepared.p_devices.length||result.skipped_non_detectors!==prepared.p_skipped_non_detectors)throw new ReconOwnedUnknown(attempt.kind);}});
}
