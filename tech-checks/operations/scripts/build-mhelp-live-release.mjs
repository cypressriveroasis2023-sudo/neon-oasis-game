import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const releaseFunctions=['projectMhelpUploadPlacement','projectEffectiveFleetPlacement','projectCombinedFleetRoster','sourceEquipmentAddressCandidates','projectSourceEquipmentAddressEstimates'];
const hash=s=>createHash('sha256').update(s).digest('hex');
/** Add an isolated helper before the freshly retrieved bridge. Function
 * declarations are hoisted: assignment takes effect before Deno.serve builds
 * the handler. Every original byte, file and runtime setting is retained. */
export function extendLiveInventoryBridge(original,helper){
 if(!original||!Array.isArray(original.files)||typeof helper!=='string'||!helper.startsWith('var CosMhelpLiveInventoryRelease'))throw Error('Invalid bridge extension');
 const entry=original.files.find(f=>f.name==='cos-operations-pages/serve.ts');
 if(!entry||entry.content.includes('var CosMhelpLiveInventoryRelease'))throw Error('Fresh unextended bridge required');
 for(const name of releaseFunctions)if(!entry.content.includes('function '+name+'('))throw Error('Current bridge interface changed');
 const prefix=helper+'\n'+releaseFunctions.map(name=>name+'=CosMhelpLiveInventoryRelease.'+name+';').join('\n')+'\n';
 const content=prefix+entry.content;
 const files=original.files.map(f=>f===entry?{...f,content}:{...f});
 return {files,proof:{originalVersion:original.version,originalSha256:hash(entry.content),helperSha256:hash(helper),prefixSha256:hash(prefix),resultSha256:hash(content),originalBytesPreserved:content.slice(prefix.length)===entry.content}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [originalPath,helperPath,outputPath]=process.argv.slice(2);if(!outputPath)throw Error('Usage: build-mhelp-live-release.mjs ORIGINAL_JSON HELPER_JS OUTPUT_JSON');
 const result=extendLiveInventoryBridge(JSON.parse(await readFile(originalPath,'utf8')),await readFile(helperPath,'utf8'));
 await writeFile(outputPath,JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result.proof));
}
