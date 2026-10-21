import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const reviewedAssignmentRuntime={version:114,serveSha256:'0811c03334092d7aff72695484471116d3976df7cbc542df9eba0fbd38371df7',configSha256:'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be'};
const sha256=s=>createHash('sha256').update(s).digest('hex');
const marker='// COS_OWNER_ASSIGNMENT_TIMESTAMP_RUNTIME_V1\n';
const startAnchor='var CosOwnerAssignmentReviewRelease=';
const endAnchor='return __toCommonJS(stdin_exports);})();\n\n';

// Pure text transformation, tested separately. Production callers use the
// guarded entry point below, which verifies the exact installed runtime first.
export function replaceAssignmentReviewHelper(original,helper){
 if(typeof original!=='string'||typeof helper!=='string'||original.includes(marker)
  ||original.split(startAnchor).length!==2||original.split('Deno.serve(').length!==2
  ||!helper.startsWith(startAnchor)||helper.split(startAnchor).length!==2
  ||!helper.endsWith(endAnchor)||helper.includes('Deno.serve('))throw Error('Assignment timestamp runtime anchors changed');
 const start=original.indexOf(startAnchor),end=original.indexOf('Deno.serve(',start);
 const oldHelper=original.slice(start,end);
 if(end<start||!oldHelper.endsWith(endAnchor))throw Error('Assignment timestamp helper boundary changed');
 const replacement=marker+helper;
 const content=original.slice(0,start)+replacement+original.slice(end);
 if(content.replace(replacement,oldHelper)!==original)throw Error('Unowned runtime changed');
 return content;
}

export async function prepareOwnerAssignmentTimestampRuntime(native){
 const serve=native?.files?.filter(f=>f.name==='cos-operations-pages/serve.ts')||[];
 const configs=native?.files?.filter(f=>f.name==='cos-operations-pages/deno.json')||[];
 if(native?.slug!=='cos-operations-pages'||native.version!==reviewedAssignmentRuntime.version
  ||native.verify_jwt!==false||native.import_map!==true||serve.length!==1||configs.length!==1||native.files.length!==2
  ||typeof serve[0].content!=='string'||typeof configs[0].content!=='string'
  ||sha256(serve[0].content)!==reviewedAssignmentRuntime.serveSha256||sha256(configs[0].content)!==reviewedAssignmentRuntime.configSha256)
  throw Error('Expected exact reviewed v114 runtime and configuration; fresh review required');
 const source=fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview.ts',import.meta.url));
 const built=await build({stdin:{contents:`export {reviewOwnerEquipmentAssignments} from ${JSON.stringify(source)};`,resolveDir:resolve('.')},bundle:true,write:false,format:'iife',globalName:'CosOwnerAssignmentReviewRelease',platform:'neutral',target:'es2022',minifyWhitespace:true,minifySyntax:true});
 const helper=built.outputFiles[0].text+'\n';
 const content=replaceAssignmentReviewHelper(serve[0].content,helper);
 return {...native,files:native.files.map(f=>f===serve[0]?{...f,content}:f)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Provide the saved installed runtime and candidate output paths');
 await writeFile(output,JSON.stringify(await prepareOwnerAssignmentTimestampRuntime(JSON.parse(await readFile(input,'utf8')))));
}
