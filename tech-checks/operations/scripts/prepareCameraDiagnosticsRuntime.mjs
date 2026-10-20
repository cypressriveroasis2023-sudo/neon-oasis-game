import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import ts from 'typescript';
export async function prepareCameraDiagnosticsRuntime(live,expected){
 const hash=v=>createHash('sha256').update(v).digest('hex');
 if(hash(live)!==expected)throw Error('Production runtime changed; review it again.');
 if(live.includes('CosInlineCameraDiagnostics'))throw Error('Camera diagnostics patch already present.');
 const anchor='let verifiedFleetIt=verifiedItFleet(context);';
 if(live.split(anchor).length!==2)throw Error('Authenticated Fleet route boundary changed.');
 const built=await build({entryPoints:[resolve('../supabase/functions/cos-operations-pages/cameraDiagnostics.ts')],bundle:true,format:'iife',globalName:'CosInlineCameraDiagnostics',platform:'neutral',minifyWhitespace:true,minifySyntax:true,write:false});
 const header=built.outputFiles[0].text;
 const addition=`if(/^\\/api\\/camera-health\\/devices\\/[^/]+\\/check$/.test(path)){if(!(context.legacyOwner&&context.actorId)&&!verifiedFleetIt)fail16("An active COS Owner or verified IT account is required.",403);if(method!=="POST")fail16("Use POST for a connection check.",405);try{return json(await CosInlineCameraDiagnostics.checkSavedCamera({id:path.split("/")[4],body,headers:context.headers,fetcher:requestFetch,signal:request.signal}));}catch(error){if(error instanceof CosInlineCameraDiagnostics.CameraDiagnosticError)return json({error:error.message},error.status);throw error;}}`;
 const patched=header+live.replace(anchor,anchor+addition);
 if(patched.slice(header.length).replace(anchor+addition,anchor)!==live)throw Error('Unrelated production bytes changed.');
 const parsed=ts.createSourceFile('serve.ts',patched,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if(parsed.parseDiagnostics.length)throw Error('Invalid prepared runtime.');
 return {content:patched,baseSha256:hash(live),runtimeSha256:hash(patched),unrelatedBytesPreserved:true};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const [input,expected,output]=process.argv.slice(2);if(!input||!expected||!output)throw Error('Usage: runtime expected-sha output-directory');
 const result=await prepareCameraDiagnosticsRuntime(await readFile(input,'utf8'),expected);await mkdir(output,{recursive:true});await writeFile(resolve(output,'serve.ts'),result.content);const {content,...manifest}=result;await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}
