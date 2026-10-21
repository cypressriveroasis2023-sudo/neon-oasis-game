import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
export async function prepareOwnerAssignmentReviewRuntime(native){
 const f=native.files?.find(f=>f.name==='cos-operations-pages/serve.ts'),original=f?.content;
 if(native.slug!=='cos-operations-pages'||typeof original!=='string'||!original.includes('CosMhelpShopAddressRelease')||original.includes('CosOwnerAssignmentReviewRelease'))throw Error('Expected verified Shop runtime');
 const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Runtime anchors changed');return s.replace(a,b);};
 const replacements=[
  ['"/api/mhelpdesk/equipment/commit"].includes(envelope.path)','"/api/mhelpdesk/equipment/commit","/api/mhelpdesk/equipment/assignments"].includes(envelope.path)'],
  ['if(path==="/api/mhelpdesk/equipment/stage"||path==="/api/mhelpdesk/equipment/commit")','if(path==="/api/mhelpdesk/equipment/stage"||path==="/api/mhelpdesk/equipment/commit"||path==="/api/mhelpdesk/equipment/assignments")'],
  ['let allowed=path.endsWith("/stage")?','let allowed=path.endsWith("/assignments")?["bytesBase64","sourceFilename","expectedSha256","stageId","action","reviewDigest","confirmationText"]:path.endsWith("/stage")?'],
  ['return json(path.endsWith("/stage")?await stageOwnerEquipmentCsv({...common2,','return json(path.endsWith("/assignments")?await CosOwnerAssignmentReviewRelease.reviewOwnerEquipmentAssignments({...common2,stageId:body.stageId,action:body.action,reviewDigest:body.reviewDigest,confirmationText:body.confirmationText}):path.endsWith("/stage")?await stageOwnerEquipmentCsv({...common2,']
 ];
 const source=fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview.ts',import.meta.url));
 const built=await build({stdin:{contents:`export {reviewOwnerEquipmentAssignments} from ${JSON.stringify(source)};`,resolveDir:resolve('.')},bundle:true,write:false,format:'iife',globalName:'CosOwnerAssignmentReviewRelease',platform:'neutral',target:'es2022',minifyWhitespace:true,minifySyntax:true});
 const helper='\n'+built.outputFiles[0].text+'\n';let content=original;
 for(const [a,b]of replacements)content=once(content,a,b);
 content=once(content,'Deno.serve(',helper+'Deno.serve(');
 let restored=content.replace(helper,'');for(const [a,b]of [...replacements].reverse())restored=restored.replace(b,a);
 if(restored!==original)throw Error('Unowned runtime changed');
 return {...native,files:native.files.map(x=>x===f?{...x,content}:x)};
}
/** Successor for the installed PR263 review helper, preserving the fresh v113
 * renewal release and every byte outside this helper and its conflict handler. */
export async function prepareOwnerAssignmentContinuityRuntime(native){
 const f=native.files?.find(f=>f.name==='cos-operations-pages/serve.ts'),original=f?.content;
 const marker='// COS_OWNER_ASSIGNMENT_CONTINUITY_RUNTIME_V1\n',startAnchor='var CosOwnerAssignmentReviewRelease=',endAnchor='return __toCommonJS(stdin_exports);})();\n\nDeno.serve(';
 const conflictAnchor='e instanceof Error&&e.message.startsWith("Invalid mHelpDesk equipment CSV:")&&fail16(e.message,422),e instanceof Error&&e.message.startsWith("Protected COS equipment admission:")&&fail16(e.message,409),fail16("Current Owner equipment guards could not be verified. No source update was authorized.",503)';
 const conflict='e instanceof HttpError&&e.status===409&&fail16("The equipment source or assignment evidence changed. Refresh the Owner review before continuing.",409),';
 if(native.slug!=='cos-operations-pages'||native.version!==113||typeof original!=='string'||!original.includes('CosMhelpReliabilityRuntime')||!original.includes('CosMhelpShopAddressRelease')||original.includes(marker))throw Error('Expected fresh verified v113 assignment runtime');
 const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Continuity runtime anchors changed');return s.replace(a,b);};
 if(original.split(startAnchor).length!==2||original.split('Deno.serve(').length!==2||!original.includes('CosOwnerAssignmentReviewRelease.reviewOwnerEquipmentAssignments'))throw Error('Continuity runtime anchors changed');
 const start=original.indexOf(startAnchor),end=original.indexOf('Deno.serve(',start);
 if(end<start||!original.slice(start,end+'Deno.serve('.length).endsWith(endAnchor))throw Error('Continuity runtime helper boundary changed');
 const oldHelper=original.slice(start,end);
 const source=fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview.ts',import.meta.url));
 const built=await build({stdin:{contents:`export {reviewOwnerEquipmentAssignments} from ${JSON.stringify(source)};`,resolveDir:resolve('.')},bundle:true,write:false,format:'iife',globalName:'CosOwnerAssignmentReviewRelease',platform:'neutral',target:'es2022',minifyWhitespace:true,minifySyntax:true});
 const helper=marker+built.outputFiles[0].text+'\n';
 let content=once(original,oldHelper,helper);
 content=once(content,conflictAnchor,conflict+conflictAnchor);
 const restored=once(once(content,conflict+conflictAnchor,conflictAnchor),helper,oldHelper);
 if(restored!==original)throw Error('Unowned v113 runtime changed');
 return {...native,files:native.files.map(x=>x===f?{...x,content}:x)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [input,output]=process.argv.slice(2);await writeFile(output,JSON.stringify(await prepareOwnerAssignmentReviewRuntime(JSON.parse(await readFile(input,'utf8')))));}
