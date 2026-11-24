import fs from 'node:fs';import ts from 'typescript';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {sha,cpuHelper} from './prepare-product-tcp-preview-v129.mjs';
export const expected={serve:'324ac3c0b82a207b074dafec48fe5b55c88c39cf033179ac9889a2008954e158',runtime:'457d49f4296f67cf0123ff68b7f8270c60704db7612d2101559e3602029d04c5',config:'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be'};
const baseline='24e2dc78a8b8d08f72daf3fcd5aaa3861519482c';
function route(code){const tree=ts.createSourceFile('serve.ts',code,ts.ScriptTarget.Latest,true),found=[];function walk(n){if(ts.isIfStatement(n)&&/^path\s*===\s*['"]\/api\/product-connections['"]$/.test(n.expression.getText(tree)))found.push(n.getText(tree));ts.forEachChild(n,walk);}walk(tree);if(found.length!==1)throw Error('Route boundary drift');return found[0];}
export async function prepare(d){
 if(d.version!==133||d.name!=='cos-operations-pages'||d.verify_jwt!==false||d.import_map!==true||d.files.length!==3)throw Error('Deployment identity drift');
 const get=(name,hash)=>{const files=d.files.filter(f=>f.name==='cos-operations-pages/'+name);if(files.length!==1||sha(files[0].content)!==hash)throw Error('Deployment file drift');return files[0];};
 const serve=get('serve.ts',expected.serve),runtime=get('productTcpRuntime.ts',expected.runtime),config=get('deno.json',expected.config);
 if(!d.entrypoint_path.endsWith('/source/'+serve.name)||!d.import_map_path.endsWith('/source/'+config.name))throw Error('Entrypoint drift');
 const original=route(serve.content);let replacement=route(fs.readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts',import.meta.url),'utf8'));
 for(const name of ['createProtectedSourceReader','integrateScopedConnections','productResourceMembership','cancellableIo','buildExactProductConnections'])replacement=replacement.replaceAll(name,'CosProductTcpDisabledStage.'+name);
 replacement=replacement.replaceAll('productSourceContext(context)','cosProductSourceContext(context)').replaceAll('requestStartedAt+','cosProductRequestStartedAt+').replaceAll('requestStartedAt,','requestStartedAt:cosProductRequestStartedAt,').replaceAll('fail(','fail16(');
 const content=serve.content.replace(original,replacement);
 if(content.replace(replacement,original)!==serve.content||cpuHelper(content)!==cpuHelper(serve.content))throw Error('Unowned serve bytes changed');
 if(!content.includes('productTcpPreviewEnabled:true,productTcpProofEnabled:false,scopedProductTcpEnabled:false'))throw Error('Switch drift');
 const root=fileURLToPath(new URL('../../supabase/functions/_shared/exact-product-producer/',import.meta.url));
 const entry=`export {createProductProofHandler,createProductPreviewHandler} from '${root}attestationTransport.ts';export {existingNativeProductSourceContext} from '${root}nativeContextAdapter.ts';export {createProtectedSourceReader} from '${root}sourceReader.ts';export {integrateScopedConnections} from '${root}statusIntegration.ts';`;
 const options={bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false};
 const originalCompile=(await build({...options,stdin:{contents:entry,resolveDir:root,loader:'ts'},plugins:[{name:'pinned-original-source',setup(b){b.onLoad({filter:/exactProductConnection\.ts$/},args=>({contents:execFileSync('git',['show',baseline+':tech-checks/operations/src/exactProductConnection.ts'],{encoding:'utf8'}),loader:'ts'}));}}]})).outputFiles[0].text;
 if(originalCompile!==runtime.content)throw Error('Original runtime reconstruction differs from v133');
 const extra=`export {productResourceMembership} from '${root}../../cos-operations-pages/productResourceMembership.ts';export {cancellableIo} from '${root}cancellableIo.ts';export {buildExactProductConnections} from '${root}../../../../operations/src/exactProductConnection.ts';`;
 const compiled=(await build({...options,stdin:{contents:entry+extra,resolveDir:root,loader:'ts'}})).outputFiles[0].text;
 const iife=async code=>(await build({...options,stdin:{contents:code,loader:'js'},format:'iife',globalName:'CosProductTcpDisabledStage'})).outputFiles[0].text;
 const files=[{...serve,content},{...runtime,content:compiled},config];
 return {original,replacement,manifest:{baseline,version:133,old:expected,files:files.map(f=>({name:f.name,sha256:sha(f.content)})),outsideRouteUnchanged:true,cpuHelperUnchanged:true,originalRuntimeRebuildExact:true,configUnchanged:true,flagsUnchanged:true},runtimeIife:await iife(compiled),oldRuntimeIife:await iife(runtime.content),payload:{name:d.name,entrypoint_path:serve.name,import_map_path:config.name,verify_jwt:false,files},rollback:{name:d.name,entrypoint_path:serve.name,import_map_path:config.name,verify_jwt:false,files:d.files}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const [input,out]=process.argv.slice(2);const p=await prepare(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(out,JSON.stringify(p));console.log(JSON.stringify(p.manifest));}
