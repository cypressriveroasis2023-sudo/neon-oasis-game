import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const docs=new URL('../docs/star4live-scheduled-ping-20261102/',import.meta.url);
export const sha256=v=>createHash('sha256').update(v).digest('hex');
export const edits=[
 ['function createCameraHealthSweep({ endpointRuntime, endpointSourceEnabled = false, completedSnapshotEnabled = false } = {}) {','function createCameraHealthSweep({ endpointRuntime, endpointSourceEnabled = false, completedSnapshotEnabled = false, star4LiveTcpEnabled = false } = {}) {'],
 ['      const cameraRun = collectScheduledDirect(',`      const star4liveRun = star4LiveTcpEnabled ? CosStar4LiveScheduledPing20261102.collectScheduledStar4Live(db, tcp, { startedAt: requestStarted, deadlineMs: completedSnapshotEnabled ? 95e3 : 48e3, signal: req.signal }).then(value => ({ value, error: null }), () => ({ value: null, error: "Star4Live saved TCP inventory unavailable" })) : Promise.resolve(null);\n      const cameraRun = collectScheduledDirect(`],
 ['      const camera = await cameraRun;',`      const camera = await cameraRun;\n      const star4live = await star4liveRun;\n      if (star4live) console.info("star4live_tcp_sweep", JSON.stringify(star4live.error ? { error: star4live.error } : { eligible: star4live.value.eligible, held: star4live.value.held, scanned: star4live.value.scanned, published: star4live.value.published, deferred: star4live.value.deferred, complete: star4live.value.complete }));`],
 ['Deno.serve(createCameraHealthSweep({ endpointSourceEnabled: true, completedSnapshotEnabled: true }));','Deno.serve(createCameraHealthSweep({ endpointSourceEnabled: true, completedSnapshotEnabled: true, star4LiveTcpEnabled: true }));']
];
const anchor='Deno.serve(';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Native sweep boundary changed');return s.replace(a,b);};
export async function buildStar4LiveSweepOverlay(){
 const entry=fileURLToPath(new URL('../../supabase/functions/_shared/scheduledStar4LiveService.ts',import.meta.url));
 const b=await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:[entry],bundle:true,write:false,format:'iife',globalName:'CosStar4LiveScheduledPing20261102',platform:'neutral',target:'es2022',legalComments:'none'});
 return '\n// COS_STAR4LIVE_SCHEDULED_PING_20261102 BEGIN\n'+b.outputFiles[0].text+'\n// COS_STAR4LIVE_SCHEDULED_PING_20261102 END\n';
}
export function patchStar4LiveSweep(source,overlay,manifest,rollback=false){
 if(sha256(source)!==(rollback?manifest.expectedAfter:manifest.expectedBefore)||sha256(overlay)!==manifest.overlaySha256)throw Error('Sweep source or overlay drift');
 let content=source;
 if(rollback){content=once(content,overlay,'');for(const [a,b]of [...edits].reverse())content=once(content,b,a);}
 else{for(const [a,b]of edits)content=once(content,a,b);content=once(content,anchor,overlay+anchor);}
 if(sha256(content)!==(rollback?manifest.expectedBefore:manifest.expectedAfter))throw Error('Sweep output byte proof failed');
 return content;
}
export async function prepareStar4LiveSweepRuntime(native,rollback=false){
 const m=JSON.parse(await readFile(new URL('native-manifest.json',docs),'utf8')),overlay=await readFile(new URL('collector-overlay.js',docs),'utf8');
 if(native.slug!=='camera-health-sweep'||native.status!=='ACTIVE'||!Array.isArray(native.files)||native.files.length!==1
  ||native.files[0].name!==m.fileName||native.verify_jwt!==m.verifyJwt
  ||(!rollback&&(native.version!==64||native.ezbr_sha256!==m.baseArchiveSha256))
  ||(rollback&&(!Number.isInteger(native.version)||native.version<=64)))throw Error('Fresh sweep revision/configuration changed');
 return {...native,files:[{...native.files[0],content:patchStar4LiveSweep(native.files[0].content,overlay,m,rollback)}]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output,mode]=process.argv.slice(2);if(!input||!output||mode&&mode!=='--rollback')throw Error('Expected input.json output.json [--rollback]');
 const prepared=await prepareStar4LiveSweepRuntime(JSON.parse(await readFile(input,'utf8')),mode==='--rollback');
 await writeFile(output,JSON.stringify(prepared)+'\n');console.log(JSON.stringify({prepared:true,files:prepared.files.map(f=>({name:f.name,sha256:sha256(f.content)}))}));
}
