import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
/** Prepare the two reviewed scheduling edits against freshly fetched live code.
 * Preserve out-of-repository address, token, VRM, authorization and runtime fixes.
 * Reject a changed bridge shape rather than rebuilding it from an older checkout.
 */
export function prepareFleetLoadingDeployment(deployed){
 if(deployed?.name!=='cos-operations-pages'||!Number.isInteger(deployed.version)||typeof deployed.verify_jwt!=='boolean'||!Array.isArray(deployed.files))throw Error('Expected current deployed Operations function.');
 const file=deployed.files.find(f=>f.name==='cos-operations-pages/serve.ts');
 if(!file||typeof file.content!=='string')throw Error('Expected current protected Operations bundle.');
 const changes=[
  ['let[freshSnapshot,freshBundle]=await Promise.all([rpc(snapshots[path],actorPayload),readIdentitySources(context)])',
   'let[freshSnapshot,freshBundle,mhelpReceipt]=await Promise.all([rpc(snapshots[path],actorPayload),readIdentitySources(context),readMhelpPlacements(actorPayload)])'],
  [',mhelpReceipt=await readMhelpPlacements(actorPayload),ownerCensusEvidence=await readOwnerCensusEvidence(',
   ',ownerCensusEvidence=await readOwnerCensusEvidence('],
 ];
 let code=file.content;
 for(const [before,after] of changes){if(code.split(before).length!==2)throw Error('Deployed bridge changed; inspect scheduling context before release.');code=code.replace(before,after);}
 // Reversibility proves every other byte is unchanged, including protected wrappers.
 let restored=code;for(const [before,after] of changes.slice().reverse())restored=restored.replace(after,before);
 if(restored!==file.content)throw Error('Protected deployment bytes changed.');
 return {version:deployed.version,beforeSha256:digest(file.content),afterSha256:digest(code),payload:{name:deployed.name,entrypoint_path:file.name,verify_jwt:deployed.verify_jwt,files:deployed.files.map(f=>({name:f.name,content:f===file?code:f.content}))}};
}
