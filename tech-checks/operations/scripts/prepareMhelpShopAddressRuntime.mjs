import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
/** Add the reviewed Shop comparison after v109, preserving all existing bytes. */
export async function prepareMhelpShopAddressRuntime(native){
 if(native.slug!=='cos-operations-pages'||!Array.isArray(native.files))throw Error('Expected current Operations function');
 const file=native.files.find(f=>f.name==='cos-operations-pages/serve.ts');
 const original=file?.content,anchor='Deno.serve(';
 if(typeof original!=='string'||!original.includes('CosMhelpCsvBaselineRelease')||original.includes('CosMhelpShopAddressRelease')
  ||original.split(anchor).length!==2||original.split('function compareMhelpEquipmentRows(').length!==2
  ||original.split('function prepareMhelpEquipmentAdmission(').length!==2)throw Error('Shop runtime changed; inspect before deployment');
 const folder=fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/',import.meta.url));
 const built=await build({stdin:{contents:`export {compareMhelpEquipmentRows} from ${JSON.stringify(folder+'mhelpEquipmentCsvPreview.ts')};export {prepareMhelpEquipmentAdmission} from ${JSON.stringify(folder+'mhelpEquipmentAdmissionPlan.ts')};`,resolveDir:resolve('.')},bundle:true,write:false,format:'iife',globalName:'CosMhelpShopAddressRelease',platform:'neutral',target:'es2022',minifyWhitespace:true,minifySyntax:true});
 const patch=`\n${built.outputFiles[0].text}\ncompareMhelpEquipmentRows=CosMhelpShopAddressRelease.compareMhelpEquipmentRows;\nprepareMhelpEquipmentAdmission=CosMhelpShopAddressRelease.prepareMhelpEquipmentAdmission;\n`;
 const at=original.indexOf(anchor),content=original.slice(0,at)+patch+original.slice(at);
 if(content.slice(0,at)+content.slice(at+patch.length)!==original)throw Error('Unowned Operations bytes changed');
 return {...native,files:native.files.map(f=>f===file?{...f,content}:f)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Expected current-function.json output-function.json');
 await writeFile(output,JSON.stringify(await prepareMhelpShopAddressRuntime(JSON.parse(await readFile(input,'utf8'))))+'\n');
}
