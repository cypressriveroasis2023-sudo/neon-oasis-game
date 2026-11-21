import fs from 'node:fs';import ts from 'typescript';import {build} from 'esbuild';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export function cpuHelper(code){const sf=ts.createSourceFile('serve.ts',code,ts.ScriptTarget.Latest,true),found=[];function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='nativePlacementAliases')found.push(n);ts.forEachChild(n,walk);}walk(sf);if(found.length!==1)throw Error('CPU helper drift');return found[0].getText(sf);}
export const runtimeImport='import * as CosProductTcpDisabledStage from "./productTcpRuntime.ts";\n';
export const expected={version:129,serve:'db93e6a0740d4eee86e56adfec5a5aeea5f784babc57643d12786c0e8747244a',runtime:'ee9bf202edee16b6347c96fa74dd82a0e05a34b5313aebec4d261411f267f4d8',config:'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be'};
export async function prepare(d,preview=false){
 if(d?.name!=='cos-operations-pages'||d.version!==129||d.verify_jwt!==false||d.import_map!==true||d.files?.length!==3)throw Error('Deployment identity drift');
 const file=(name,hash)=>{const matches=d.files.filter(f=>f.name==='cos-operations-pages/'+name);if(matches.length!==1||sha(matches[0].content)!==hash)throw Error('Deployment bytes drift: '+name);return matches[0];};
 const serve=file('serve.ts',expected.serve),oldRuntime=file('productTcpRuntime.ts',expected.runtime),config=file('deno.json',expected.config);
 if(!d.entrypoint_path.endsWith('/source/'+serve.name)||!d.import_map_path.endsWith('/source/'+config.name))throw Error('Route drift');
 const oldRoute=`if(path==='/api/product-tcp-proof'){
 if(!(context.legacyOwner&&context.actorId)&&!verifiedFleetIt)fail16('An active COS Owner or verified IT account is required.',403);
 const proofRequest=body===null?request:new Request(request.url,{method,headers:request.headers,body:JSON.stringify(body),signal:request.signal});
 return await CosProductTcpDisabledStage.createProductProofHandler({enabled:options.scopedProductTcpEnabled===true,bindExistingContext:async()=>cosProductSourceContext(context)})(proofRequest);
 }`;
 const newRoute=`if(path==='/api/product-tcp-proof'||path==='/api/product-tcp-preview'){
 if(!(context.legacyOwner&&context.actorId)&&!verifiedFleetIt)fail16('An active COS Owner or verified IT account is required.',403);
 const proofRequest=body===null?request:new Request(request.url,{method,headers:request.headers,body:JSON.stringify(body),signal:request.signal});
 const preview=path==='/api/product-tcp-preview';
 return await (preview?CosProductTcpDisabledStage.createProductPreviewHandler:CosProductTcpDisabledStage.createProductProofHandler)({enabled:preview?options.productTcpPreviewEnabled===true:options.productTcpProofEnabled===true,bindExistingContext:async()=>cosProductSourceContext(context)})(proofRequest);
 }`;
 const oldFlags='Deno.serve(createOperationsHandler({scopedProductTcpEnabled:false,',newFlags=`Deno.serve(createOperationsHandler({productTcpPreviewEnabled:${preview},productTcpProofEnabled:false,scopedProductTcpEnabled:false,`;
 const replacements=[{old:oldRoute,next:newRoute},{old:oldFlags,next:newFlags}];let patched=serve.content;
 for(const e of replacements){if(patched.split(e.old).length!==2)throw Error('Insertion boundary drift');patched=patched.replace(e.old,e.next);}
 let restored=patched;for(const e of [...replacements].reverse())restored=restored.replace(e.next,e.old);if(restored!==serve.content||cpuHelper(patched)!==cpuHelper(serve.content))throw Error('Unowned bytes changed');
 const root=fileURLToPath(new URL('../../supabase/functions/_shared/exact-product-producer/',import.meta.url));
 const entry=`export {createProductProofHandler,createProductPreviewHandler} from '${root}attestationTransport.ts';export {existingNativeProductSourceContext} from '${root}nativeContextAdapter.ts';export {createProtectedSourceReader} from '${root}sourceReader.ts';export {integrateScopedConnections} from '${root}statusIntegration.ts';`;
 const runtime=(await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false})).outputFiles[0].text;
 const iife=async code=>(await build({stdin:{contents:code,loader:'js'},bundle:true,format:'iife',globalName:'CosProductTcpDisabledStage',platform:'neutral',target:'es2022',write:false})).outputFiles[0].text;
 const files=[{...serve,content:patched},{...oldRuntime,content:runtime},config];
 return {base:expected,preview,replacements,originalRestoredSha256:sha(restored),manifest:files.map(f=>({name:f.name,sha256:sha(f.content)})),runtimeIife:await iife(runtime),oldRuntimeIife:await iife(oldRuntime.content),payload:{name:d.name,entrypoint_path:serve.name,import_map_path:config.name,verify_jwt:false,files}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [input,out]=process.argv.slice(2),d=JSON.parse(fs.readFileSync(input,'utf8'));for(const enabled of [false,true]){const packet=await prepare(d,enabled);fs.writeFileSync(out+(enabled?'-preview':'-disabled')+'.json',JSON.stringify(packet));console.log(JSON.stringify({preview:enabled,manifest:packet.manifest}));}
 const legacy=(await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/cos-exact-product-tcp/serve.ts',import.meta.url))],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false})).outputFiles[0].text;
 fs.writeFileSync(out+'-legacy.json',JSON.stringify({name:'cos-exact-product-tcp',entrypoint_path:'cos-exact-product-tcp/serve.ts',verify_jwt:true,files:[{name:'cos-exact-product-tcp/serve.ts',content:legacy}]}));console.log(JSON.stringify({legacySha:sha(legacy)}));
}
