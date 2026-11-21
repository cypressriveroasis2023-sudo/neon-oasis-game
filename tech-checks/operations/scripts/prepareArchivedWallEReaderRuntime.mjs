import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';

// Pure package preparation. This script has no deployment or network operation.
const folder=new URL('../docs/tracker-archive-reader-20261102/',import.meta.url);
const marker='// COS_ARCHIVED_WALL_E_READER_20261102';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export async function buildArchiveReaderOverlay(){
 const entry=fileURLToPath(new URL('../../supabase/functions/cos-operations-pages/mhelp2027ProductIpReader.ts',import.meta.url));
 const built=await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:[entry],bundle:true,write:false,format:'iife',
  globalName:'CosArchivedWallEConnectionReader20261102',platform:'neutral',target:'es2022',legalComments:'none'});
 return `\n${marker} BEGIN\n${built.outputFiles[0].text}\nread2027ProductIpsFromGoogle=CosArchivedWallEConnectionReader20261102.read2027ProductIpsFromGoogle;\n${marker} END\n`;
}
export function insertArchiveReaderOverlay(runtime,overlay,manifest){
 if(sha256(runtime)!==manifest.expectedBefore['productTcpRuntime.ts']||sha256(overlay)!==manifest.overlaySha256
  ||runtime.includes(marker)||runtime.includes('CosArchivedWallEConnectionReader20261102'))throw Error('Recorded native runtime or reviewed overlay changed');
 const anchor='export {\n',offset=runtime.indexOf(anchor);
 if(offset<0||runtime.indexOf(anchor,offset+1)!==-1
  ||runtime.split('async function read2027ProductIpsFromGoogle(').length!==2)throw Error('Native reader/export boundary changed');
 const patched=runtime.slice(0,offset)+overlay+runtime.slice(offset);
 if(patched.slice(0,offset)+patched.slice(offset+overlay.length)!==runtime
  ||sha256(patched)!==manifest.expectedAfter['productTcpRuntime.ts'])throw Error('Prepared runtime byte proof failed');
 return patched;
}
export function removeArchiveReaderOverlay(runtime,overlay,manifest){
 if(sha256(runtime)!==manifest.expectedAfter['productTcpRuntime.ts']||sha256(overlay)!==manifest.overlaySha256
  ||runtime.split(overlay).length!==2)throw Error('Rollback source changed');
 const restored=runtime.replace(overlay,'');
 if(sha256(restored)!==manifest.expectedBefore['productTcpRuntime.ts'])throw Error('Rollback byte proof failed');
 return restored;
}
export async function prepareArchivedWallEReaderRuntime(native){
 const manifest=JSON.parse(await readFile(new URL('native-manifest.json',folder),'utf8'));
 const overlay=await readFile(new URL('reader-overlay.js',folder),'utf8');
 if(native.slug!==manifest.slug||native.status!=='ACTIVE'||native.version!==manifest.baseVersion
  ||native.ezbr_sha256!==manifest.baseArchiveSha256||native.verify_jwt!==false
  ||!native.entrypoint_path?.endsWith('/source/serve.ts')||!native.import_map_path?.endsWith('/source/deno.json')
  ||!Array.isArray(native.files)||native.files.length!==Object.keys(manifest.expectedBefore).length)throw Error('Native function revision changed; capture and review again');
 const seen=new Set();
 const files=native.files.map(f=>{
  if(seen.has(f.name)||!Object.hasOwn(manifest.expectedBefore,f.name)||typeof f.content!=='string'
   ||sha256(f.content)!==manifest.expectedBefore[f.name])throw Error('Native file drift or duplicate: '+f.name);
  seen.add(f.name);
  const content=f.name==='productTcpRuntime.ts'?insertArchiveReaderOverlay(f.content,overlay,manifest):f.content;
  if(sha256(content)!==manifest.expectedAfter[f.name])throw Error('Prepared file hash mismatch: '+f.name);
  return {...f,content};
 });
 return {...native,files};
}
export async function prepareArchivedWallEReaderRollback(native){
 const manifest=JSON.parse(await readFile(new URL('native-manifest.json',folder),'utf8'));
 const overlay=await readFile(new URL('reader-overlay.js',folder),'utf8');
 if(native.slug!==manifest.slug||native.status!=='ACTIVE'||!Number.isInteger(native.version)||native.version<=manifest.baseVersion
  ||native.verify_jwt!==false||!native.entrypoint_path?.endsWith('/source/serve.ts')||!native.import_map_path?.endsWith('/source/deno.json')
  ||!Array.isArray(native.files)||native.files.length!==Object.keys(manifest.expectedAfter).length)throw Error('Rollback requires a fresh matching deployed candidate');
 const seen=new Set();
 const files=native.files.map(f=>{
  if(seen.has(f.name)||!Object.hasOwn(manifest.expectedAfter,f.name)||typeof f.content!=='string'
   ||sha256(f.content)!==manifest.expectedAfter[f.name])throw Error('Rollback file drift or duplicate: '+f.name);
  seen.add(f.name);
  const content=f.name==='productTcpRuntime.ts'?removeArchiveReaderOverlay(f.content,overlay,manifest):f.content;
  if(sha256(content)!==manifest.expectedBefore[f.name])throw Error('Rollback file hash mismatch: '+f.name);
  return {...f,content};
 });
 return {...native,files};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output,mode]=process.argv.slice(2);
 if(!input||!output||mode&&mode!=='--rollback')throw Error('Expected captured-native.json prepared-native.json [--rollback]');
 const prepare=mode==='--rollback'?prepareArchivedWallEReaderRollback:prepareArchivedWallEReaderRuntime;
 const prepared=await prepare(JSON.parse(await readFile(input,'utf8')));
 await writeFile(output,JSON.stringify(prepared)+'\n');
 console.log(JSON.stringify({prepared:true,baseVersion:prepared.version,files:prepared.files.map(f=>({name:f.name,sha256:sha256(f.content)}))}));
}
