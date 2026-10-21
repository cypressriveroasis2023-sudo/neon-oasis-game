import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
/** Add only saved coverage projection to a freshly fetched Operations bundle.
 * Does not replace auth, provider readers, session recovery or other releases. */
export async function prepareCameraSweepCoverageRuntime(native){
 if(native.slug!=='cos-operations-pages'||!Array.isArray(native.files))throw Error('Expected Operations runtime');
 const file=native.files.find(f=>f.name==='cos-operations-pages/serve.ts'),original=file?.content;
 const query='units:metadata->units&provider=in.(witness,vigilant)&order=provider.asc';
 const replacement='units:metadata->units,sweep_source:metadata->>source,sweep_complete:metadata->complete,sweep_counts_known:metadata->counts_known,sweep_eligible:metadata->eligible,sweep_scanned:metadata->scanned,sweep_published:metadata->published,sweep_held:metadata->held,sweep_reconciled_at:metadata->>reconciled_at,sweep_held_reasons:metadata->held_reasons&provider=in.(witness,vigilant,avigilon)&order=provider.asc';
 const calls=[...(original||'').matchAll(/\.\.\.fieldRecorderHealthGuards\(bundle.sources,([\w$]+),providerIntegrations\)/g)];
 if(typeof original!=='string'||original.includes('CosCameraSweepCoverageRelease')||original.split(query).length!==2||original.split('Deno.serve(').length!==2||calls.length!==1)throw Error('Operations runtime changed; inspect before patching');
 const source=fileURLToPath(new URL('../shared/cameraSweepCoverage.ts',import.meta.url));
 const built=await build({stdin:{contents:`export {projectCameraSweepCoverage} from ${JSON.stringify(source)};`,resolveDir:resolve('.')},bundle:true,write:false,format:'iife',globalName:'CosCameraSweepCoverageRelease',platform:'neutral',target:'es2022',minifyWhitespace:true,minifySyntax:true});
 const projection='sweepCoverage:CosCameraSweepCoverageRelease.projectCameraSweepCoverage(providerIntegrations),';
 let content=original.replace(query,replacement).replace(calls[0][0],projection+calls[0][0]);
 const helper='\n'+built.outputFiles[0].text+'\n';
 content=content.replace('Deno.serve(',helper+'Deno.serve(');
 if(content.replace(helper,'').replace(projection,'').replace(replacement,query)!==original)throw Error('Unowned runtime bytes changed');
 return {...native,files:native.files.map(f=>f===file?{...f,content}:f)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Expected current runtime and output paths');
 await writeFile(output,JSON.stringify(await prepareCameraSweepCoverageRuntime(JSON.parse(await readFile(input,'utf8'))))+'\n');
}
