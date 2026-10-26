// Offline preparation only. Preserve the full verified v123 closure except one function.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const expected={version:123,archive:'8ce24b10e02de6155abe96a52e5bb156375cd0242af523162e9c1873113edba8',serve:'a3ab6415391c9c2610ead206e40a59479ebe15ab08cdf8088feda18db1bc27cf',config:'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be'};
export function declaration(code){
 const tree=ts.createSourceFile('serve.ts',code,ts.ScriptTarget.Latest,true);
 const matches=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='currentOwnerPlacements');
 if(matches.length!==1)throw Error('Expected exactly one top-level placement validator');
 return {start:matches[0].getStart(tree),end:matches[0].end,text:matches[0].getText(tree)};
}
export function prepare(deployed){
 if(deployed?.name!=='cos-operations-pages'||deployed.version!==expected.version||deployed.ezbr_sha256!==expected.archive||deployed.verify_jwt!==false||deployed.import_map!==true)throw Error('Deployment identity changed');
 const names=['cos-operations-pages/serve.ts','cos-operations-pages/deno.json'];
 if(!Array.isArray(deployed.files)||deployed.files.length!==2||names.some(name=>deployed.files.filter(f=>f.name===name&&typeof f.content==='string').length!==1))throw Error('Deployment closure changed');
 const [serve,config]=names.map(name=>deployed.files.find(f=>f.name===name));
 if(hash(serve.content)!==expected.serve||hash(config.content)!==expected.config)throw Error('Deployment source drift');
 if(!deployed.entrypoint_path?.endsWith('/source/'+serve.name)||deployed.import_map_path!==deployed.entrypoint_path.slice(0,-serve.name.length)+config.name)throw Error('Entrypoint routing changed');
 const source=fs.readFileSync(new URL('../../supabase/functions/cos-operations-pages/placementProjection.ts',import.meta.url),'utf8');
 const replacement=ts.transpile(declaration(source).text.replace(/^export /,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}).trim();
 const before=declaration(serve.content),code=serve.content.slice(0,before.start)+replacement+serve.content.slice(before.end);
 if(code.slice(0,before.start)!==serve.content.slice(0,before.start)||code.slice(before.start+replacement.length)!==serve.content.slice(before.end))throw Error('Unrelated source changed');
 const files=deployed.files.map(f=>({...f,content:f.name===serve.name?code:f.content}));
 return {base:expected,changedFunction:'currentOwnerPlacements',beforeFunctionSha256:hash(before.text),afterFunctionSha256:hash(replacement),manifest:files.map(f=>({name:f.name,sha256:hash(f.content)})),payload:{name:deployed.name,entrypoint_path:serve.name,import_map_path:config.name,verify_jwt:deployed.verify_jwt,files}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/prepare-placement-cpu.mjs captured-v123.json output.json');
 const packet=prepare(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(output,JSON.stringify(packet));console.log(JSON.stringify({...packet,payload:undefined},null,2));
}
