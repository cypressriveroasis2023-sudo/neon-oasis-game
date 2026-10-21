import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

/** Patch only the two baseline gates in the freshly fetched Operations bundle.
 * Preserve every original byte, all imports/config, routes and other releases. */
export async function prepareMhelpCsvBaselineRuntime(native){
 if(native.slug!=='cos-operations-pages'||!Array.isArray(native.files))throw Error('Expected current Operations function');
 const file=native.files.find(f=>f.name==='cos-operations-pages/serve.ts');
 if(!file||typeof file.content!=='string')throw Error('Missing Operations entry');
 const original=file.content,anchor='Deno.serve(';
 if(original.includes('CosMhelpCsvBaselineRelease')||original.split(anchor).length!==2
  ||original.split('function validPrior(').length!==2||original.split('function prepareMhelpEquipmentAdmission(').length!==2)throw Error('Baseline runtime changed; inspect before deployment');
 const source=fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts',import.meta.url));
 const built=await build({stdin:{contents:`export {validPrior} from ${JSON.stringify(source)};`,resolveDir:resolve('.')},bundle:true,write:false,format:'iife',globalName:'CosMhelpCsvBaselineRelease',platform:'neutral',target:'es2022',minifyWhitespace:true,minifySyntax:true});
 const helper=built.outputFiles[0].text;
 // Delegate to the exact deployed planner, preserving any newer identity/hold
 // checks. The contract alias is local to this call after strict API validation.
 const patch=`\n${helper}\nvalidPrior=CosMhelpCsvBaselineRelease.validPrior;\n{const originalAdmission=prepareMhelpEquipmentAdmission;prepareMhelpEquipmentAdmission=(rows,previous,guards)=>{if(previous?.contract==='COS_MHELP_API_V1'){validPrior(previous);return originalAdmission(rows,{...previous,contract:'COS_MHELP_UPLOAD_V1'},guards);}return originalAdmission(rows,previous,guards);};}\n`;
 const at=original.indexOf(anchor),content=original.slice(0,at)+patch+original.slice(at);
 if(content.slice(0,at)+content.slice(at+patch.length)!==original)throw Error('Unowned Operations bytes changed');
 return {...native,files:native.files.map(f=>f===file?{...f,content}:f)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Expected current-function.json output-function.json');
 await writeFile(output,JSON.stringify(await prepareMhelpCsvBaselineRuntime(JSON.parse(await readFile(input,'utf8'))))+'\n');
}
