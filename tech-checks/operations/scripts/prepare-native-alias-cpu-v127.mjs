// Offline one-function preparation. Never deploys, reads credentials or calls a service.
import fs from 'node:fs';import ts from 'typescript';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export const expected={version:127,archive:'c13e84a906521969b37e6503aec366cacc6bc81c50def72b4f79be70e518f34b',serve:'c846255ca8c0c7869d47b5755a9e4b1e4bed603ba44c20d0cc4e72b37c559774',config:'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be',helper:'653c1a87dbac4bf70297f8a6014da908318504a69e57e9a1399496fd417ef530'};
export function declaration(code){const tree=ts.createSourceFile('serve.ts',code,ts.ScriptTarget.Latest,true),matches=[];function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='nativePlacementAliases')matches.push(n);ts.forEachChild(n,walk);}walk(tree);if(matches.length!==1||matches[0].parent!==tree)throw Error('Expected one top-level native alias helper');const n=matches[0];return {start:n.getStart(tree),end:n.end,text:n.getText(tree)};}
export function prepare(d){
 if(d?.name!=='cos-operations-pages'||d.version!==expected.version||d.ezbr_sha256!==expected.archive||d.verify_jwt!==false||d.import_map!==true)throw Error('Deployment identity changed');
 const names=['cos-operations-pages/serve.ts','cos-operations-pages/deno.json'];if(!Array.isArray(d.files)||d.files.length!==2||names.some(name=>d.files.filter(f=>f.name===name&&typeof f.content==='string').length!==1))throw Error('Deployment closure changed');
 const [serve,config]=names.map(name=>d.files.find(f=>f.name===name));if(sha(serve.content)!==expected.serve||sha(config.content)!==expected.config)throw Error('Deployment bytes changed');
 if(!d.entrypoint_path?.endsWith('/source/'+serve.name)||d.import_map_path!==d.entrypoint_path.slice(0,-serve.name.length)+config.name)throw Error('Deployment routing changed');
 const original=declaration(serve.content);if(sha(original.text)!==expected.helper)throw Error('Native alias helper changed');
 const source=fs.readFileSync(new URL('../../supabase/functions/cos-operations-pages/placementProjection.ts',import.meta.url),'utf8');
 const replacement=ts.transpile(declaration(source).text,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}).trim();
 const code=serve.content.slice(0,original.start)+replacement+serve.content.slice(original.end);
 if(code.slice(0,original.start)!==serve.content.slice(0,original.start)||code.slice(original.start+replacement.length)!==serve.content.slice(original.end))throw Error('Unowned bytes changed');
 const files=d.files.map(f=>({...f,content:f.name===serve.name?code:f.content}));
 return {base:expected,changedFunction:'nativePlacementAliases',beforeFunctionSha256:sha(original.text),afterFunctionSha256:sha(replacement),originalRange:{start:original.start,end:original.end},prefixSha256:sha(serve.content.slice(0,original.start)),suffixSha256:sha(serve.content.slice(original.end)),manifest:files.map(f=>({name:f.name,sha256:sha(f.content)})),payload:{name:d.name,entrypoint_path:serve.name,import_map_path:config.name,verify_jwt:d.verify_jwt,files}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Supply captured v127 JSON and local packet output');const packet=prepare(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(output,JSON.stringify(packet));console.log(JSON.stringify({...packet,payload:undefined},null,2));}
