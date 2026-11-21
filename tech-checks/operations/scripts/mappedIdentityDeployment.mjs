import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build,transform} from 'esbuild';
const hash=value=>createHash('sha256').update(value).digest('hex');
const runtime='CosMappedIdentityPreviewRuntime';
export const mappedPreviewAnchor='if(path.startsWith("/api/owner-identity/"))return context.legacyOwner||fail16("An active COS Owner account is required.",403),method==="POST"&&body===null&&(body=await requestBody(request)),json(await createOwnerIdentityReview(';
const insertion='if(path==="/api/owner-identity/mapped-preview"){context.legacyOwner||fail16("An active COS Owner account is required.",403);method==="POST"&&body===null&&(body=await requestBody(request));try{return json(await CosMappedIdentityPreviewRuntime.createMappedIdentityReview({now:()=>Date.now(),read:async key=>{const [result,receipt]=await Promise.all([readIdentitySources(context,key),readMhelpPlacements(actorPayload)]);return {sources:result.sources,upload:receipt?.upload};}})(method,body));}catch(cause){if(cause instanceof CosMappedIdentityPreviewRuntime.OwnerIdentityError)throw new OwnerIdentityError(cause.message,cause.status);throw cause;}}';

/** Local preparation only. No environment, provider, database or deployment IO.
 * The original runtime remains byte-for-byte recoverable, including every
 * existing scope fallback and authorization guard. */
export async function prepareMappedIdentityDeployment(deployed,expected){
 if(deployed?.name!=='cos-operations-pages'||deployed.version!==expected?.version||deployed.verify_jwt!==expected?.verifyJwt||deployed.ezbr_sha256!==expected?.bundleSha256)throw Error('Current deployment identity changed.');
 if(!Array.isArray(deployed.files)||deployed.files.length!==2||new Set(deployed.files.map(f=>f.name)).size!==2)throw Error('Complete deployed source closure required.');
 const entry=deployed.files.find(f=>f.name==='cos-operations-pages/serve.ts'),config=deployed.files.find(f=>f.name==='cos-operations-pages/deno.json');
 if(typeof entry?.content!=='string'||typeof config?.content!=='string'||hash(entry.content)!==expected.serveSha256||hash(config.content)!==expected.configSha256)throw Error('Deployed source or configuration drifted.');
 if(deployed.import_map!==true||typeof deployed.entrypoint_path!=='string'||!deployed.entrypoint_path.endsWith('/source/'+entry.name)||deployed.import_map_path!==deployed.entrypoint_path.slice(0,-entry.name.length)+config.name)throw Error('Deployed source routing changed.');
 if(entry.content.includes(runtime)||entry.content.split(mappedPreviewAnchor).length!==2)throw Error('The exact unextended Owner route is unavailable.');
 const result=await build({stdin:{contents:"export {createMappedIdentityReview} from './mappedIdentityReview.ts'; export {OwnerIdentityError} from './ownerIdentityCrosswalk.ts';",resolveDir:fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/',import.meta.url)),sourcefile:'mapped-preview-entry.ts',loader:'ts'},bundle:true,format:'iife',globalName:runtime,platform:'neutral',target:'es2022',minify:true,write:false,metafile:true,legalComments:'none'});
 if(result.outputFiles.length!==1||Object.values(result.metafile.outputs).some(o=>o.imports.length))throw Error('Helper must have one complete dependency-free output.');
 const helper=result.outputFiles[0].text,prefix=helper+'\n';
 if(!helper.startsWith('var '+runtime+'=')||helper.includes('Deno.serve('))throw Error('Unexpected helper initialization.');
 const offset=entry.content.indexOf(mappedPreviewAnchor),content=prefix+entry.content.slice(0,offset)+insertion+entry.content.slice(offset);
 const restored=content.slice(prefix.length,prefix.length+offset)+content.slice(prefix.length+offset+insertion.length);
 if(restored!==entry.content)throw Error('Existing deployed bytes were changed.');
 // Parse the complete JavaScript bridge without running its Deno entrypoint.
 await transform(content,{loader:'js',format:'esm',target:'es2022'});
 const files=deployed.files.map(f=>({name:f.name,content:f===entry?content:f.content}));
 return {proof:{originalVersion:deployed.version,originalArchiveSha256:deployed.ezbr_sha256,originalServeSha256:hash(entry.content),configSha256:hash(config.content),helperSha256:hash(helper),insertionSha256:hash(insertion),candidateServeSha256:hash(content),prefixBytes:Buffer.byteLength(prefix),insertionBytes:Buffer.byteLength(insertion),originalBytesPreserved:true,dependencyInputs:Object.keys(result.metafile.inputs).sort()},
  manifest:files.map(f=>({name:f.name,sha256:hash(f.content),bytes:Buffer.byteLength(f.content)})),
  payload:{name:deployed.name,entrypoint_path:entry.name,import_map_path:config.name,verify_jwt:deployed.verify_jwt,files},
  rollback:{name:deployed.name,entrypoint_path:entry.name,import_map_path:config.name,verify_jwt:deployed.verify_jwt,files:deployed.files.map(f=>({name:f.name,content:f.content}))}};
}
