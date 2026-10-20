import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../package.json',import.meta.url));
const esbuild=require('esbuild'),parser=require('@babel/parser');
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const serve='tech-checks/supabase/functions/cos-mhelp-placement-sync/serve.ts';
const handler='tech-checks/supabase/functions/cos-mhelp-placement-sync/index.ts';
const [nativePath,outPath,sourceBase]=process.argv.slice(2);
if(!nativePath||!outPath||!sourceBase||!/^[a-f0-9]{40}$/.test(sourceBase))throw Error('Usage: build-mhelp-placement-single-reader.mjs native-bundle output-bundle exact-base-source-sha');
const native=await readFile(nativePath,'utf8');
function walk(n,fn,parent=null,key=null){if(!n||typeof n!=='object')return;fn(n,parent,key);for(const[k,v]of Object.entries(n)){if(Array.isArray(v))v.forEach(x=>walk(x,fn,n,k));else if(v&&typeof v==='object')walk(v,fn,n,k);}}
const ast=code=>parser.parse(code,{sourceType:'module'});
function owned(code){const nodes=[];walk(ast(code),n=>{if(n.type==='FunctionDeclaration'&&n.id?.name==='createPlacementSyncHandler')nodes.push(n);});if(nodes.length!==1)throw Error('Expected one placement handler');return nodes[0];}
const buildOptions={bundle:true,write:false,format:'esm',target:'es2022',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,logLevel:'silent'};
const oldServe=execFileSync('git',['show',sourceBase+':'+serve],{cwd:repo,encoding:'utf8'}),oldHandler=execFileSync('git',['show',sourceBase+':'+handler],{cwd:repo,encoding:'utf8'});
const baseline=(await esbuild.build({...buildOptions,stdin:{contents:oldServe,sourcefile:serve,resolveDir:path.dirname(path.join(repo,serve)),loader:'ts'},plugins:[{name:'original-owned-handler',setup(build){build.onLoad({filter:/cos-mhelp-placement-sync\/index\.ts$/},()=>({contents:oldHandler,loader:'ts'}));}}]})).outputFiles[0].text;
const candidate=(await esbuild.build({...buildOptions,entryPoints:[path.join(repo,serve)]})).outputFiles[0].text;
const originalNode=owned(native),baseNode=owned(baseline),nextNode=owned(candidate);
function canonical(code){const normalized=esbuild.transformSync('('+code+')',{target:'es2022',minifySyntax:true,treeShaking:false}).code;function clean(n,parent=null,key=null){if(Array.isArray(n))return n.map(x=>clean(x,parent,key));if(!n||typeof n!=='object')return n;const out={};for(const[k,v]of Object.entries(n)){if(['start','end','loc','extra','comments','leadingComments','trailingComments','innerComments'].includes(k))continue;if(n.type==='Identifier'&&k==='name'){const prop=(parent?.type==='MemberExpression'||parent?.type==='OptionalMemberExpression')&&key==='property'&&!parent.computed||['ObjectProperty','ObjectMethod'].includes(parent?.type)&&key==='key'&&!parent.computed;out[k]=prop?v:v.replace(/\d+$/,'');}else out[k]=clean(v,n,k);}return out;}return JSON.stringify(clean(ast(normalized)));}
const originalCode=native.slice(originalNode.start,originalNode.end),baseCode=baseline.slice(baseNode.start,baseNode.end);
if(canonical(originalCode)!==canonical(baseCode))throw Error('Live placement handler changed; refresh source before replacing it');
const identifiers=code=>{const out=[];walk(ast(code), (n,p,k)=>{if(n.type==='Identifier'&&!((p?.type==='MemberExpression'||p?.type==='OptionalMemberExpression')&&k==='property'&&!p.computed||['ObjectProperty','ObjectMethod'].includes(p?.type)&&k==='key'&&!p.computed))out.push(n);});return out;};
const baseIds=identifiers(baseCode),nativeIds=identifiers(originalCode),renames=new Map();
if(baseIds.length!==nativeIds.length)throw Error('Native alias shape changed');
for(let i=0;i<baseIds.length;i++){const a=baseIds[i].name,b=nativeIds[i].name;if(a!==b){if(a.replace(/\d+$/,'')!==b.replace(/\d+$/,'')||renames.has(a)&&renames.get(a)!==b)throw Error('Ambiguous native helper alias');renames.set(a,b);}}
let nextCode=candidate.slice(nextNode.start,nextNode.end);
for(const id of identifiers(nextCode).filter(n=>renames.has(n.name)).sort((a,b)=>b.start-a.start))nextCode=nextCode.slice(0,id.start)+renames.get(id.name)+nextCode.slice(id.end);
const calls=[];walk(ast(native),n=>{if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='createPlacementSyncHandler'&&n.arguments[0]?.type==='ObjectExpression')calls.push(n.arguments[0]);});
if(calls.length!==1)throw Error('Expected one native placement factory call');
const opts=calls[0];if(opts.properties.some(p=>p.key?.name==='completeSource'))throw Error('Native bundle already has the single-reader extension');
const rpc=opts.properties.find(p=>p.key?.name==='rpc');if(rpc?.value?.type!=='Identifier')throw Error('Native RPC binding changed');
const edits=[{start:originalNode.start,end:originalNode.end,text:nextCode},{start:opts.start+1,end:opts.start+1,text:`completeSource:()=>${rpc.value.name}('cos_mhelp_placement_from_inventory',{}),`}].sort((a,b)=>b.start-a.start);
let output=native;for(const e of edits)output=output.slice(0,e.start)+e.text+output.slice(e.end);
ast(output);await writeFile(outPath,output);
const sha=s=>createHash('sha256').update(s).digest('hex');
process.stdout.write(JSON.stringify({nativeSha256:sha(native),candidateSha256:sha(output),ownedRegionsChanged:2,otherNativeBytesPreserved:true,helperAliases:Object.fromEntries(renames)})+'\n');
