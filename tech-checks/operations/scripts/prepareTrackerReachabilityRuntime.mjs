import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const folder=new URL('../docs/tracker-ip-reachability-20261102/',import.meta.url);
export const sha256=v=>createHash('sha256').update(v).digest('hex');
export const savedCall='CosProductTcpDisabledStage.buildExactProductConnections(source.census,tracker,endpoints,Date.now(),source.members)';
export const targetCall='CosProductTcpDisabledStage.buildTrackerIpReachability(source.census,tracker,endpoints,Date.now())';
export const configBefore='connectionRevision:device.connection_revision,monitoringEnabled:device.monitoring_enabled,\n          portStatus:';
export const configAfter='connectionRevision:device.connection_revision,monitoringEnabled:device.monitoring_enabled,activationState:device.activation_state,\n          portStatus:';
const exportBefore='export {\n',exportAfter='export {\n  buildTrackerIpReachability,\n';
export async function buildTrackerReachabilityOverlay(){
 const entry=fileURLToPath(new URL('../src/exactProductConnection.ts',import.meta.url));
 const built=await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),stdin:{contents:`export {buildTrackerIpReachability} from ${JSON.stringify(entry)};`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'iife',globalName:'CosTrackerIpReachability20261102',platform:'neutral',target:'es2022',legalComments:'none'});
 return `\n// COS_TRACKER_IP_REACHABILITY_20261102 BEGIN\n${built.outputFiles[0].text}\nvar buildTrackerIpReachability=CosTrackerIpReachability20261102.buildTrackerIpReachability;\n// COS_TRACKER_IP_REACHABILITY_20261102 END\n`;
}
function once(s,from,to){if(s.split(from).length!==2)throw Error('Native patch boundary changed');return s.replace(from,to);}
export function patchReachabilityFiles(files,overlay,manifest,rollback=false){
 if(sha256(overlay)!==manifest.overlaySha256||!Array.isArray(files)||files.length!==5)throw Error('Reviewed package changed');
 const from=rollback?manifest.expectedAfter:manifest.expectedBefore,to=rollback?manifest.expectedBefore:manifest.expectedAfter,seen=new Set();
 return files.map(f=>{
  if(seen.has(f.name)||!Object.hasOwn(from,f.name)||sha256(f.content)!==from[f.name])throw Error('Native file drift: '+f.name);
  seen.add(f.name);let content=f.content;
  if(f.name==='serve.ts')content=rollback?once(once(content,targetCall,savedCall),configAfter,configBefore):once(once(content,savedCall,targetCall),configBefore,configAfter);
  if(f.name==='productTcpRuntime.ts')content=rollback?once(once(content,exportAfter,exportBefore),overlay,''):once(content,exportBefore,overlay+exportAfter);
  if(sha256(content)!==to[f.name])throw Error('Native output proof failed: '+f.name);
  return {...f,content};
 });
}
export async function prepareTrackerReachabilityRuntime(native,rollback=false){
 const manifest=JSON.parse(await readFile(new URL('native-manifest.json',folder),'utf8')),overlay=await readFile(new URL('reader-overlay.js',folder),'utf8');
 if(native.slug!=='cos-operations-pages'||native.status!=='ACTIVE'||native.verify_jwt!==false
  ||!native.entrypoint_path?.endsWith('/source/serve.ts')||!native.import_map_path?.endsWith('/source/deno.json')
  ||(!rollback&&(native.version!==138||native.ezbr_sha256!==manifest.baseArchiveSha256))
  ||(rollback&&(!Number.isInteger(native.version)||native.version<=138)))throw Error('Native revision/configuration changed');
 return {...native,files:patchReachabilityFiles(native.files,overlay,manifest,rollback)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output,mode]=process.argv.slice(2);if(!input||!output||mode&&mode!=='--rollback')throw Error('Expected input.json output.json [--rollback]');
 const candidate=await prepareTrackerReachabilityRuntime(JSON.parse(await readFile(input,'utf8')),mode==='--rollback');
 await writeFile(output,JSON.stringify(candidate)+'\n');console.log(JSON.stringify({prepared:true,rollback:mode==='--rollback',files:candidate.files.map(f=>({name:f.name,sha256:sha256(f.content)}))}));
}
