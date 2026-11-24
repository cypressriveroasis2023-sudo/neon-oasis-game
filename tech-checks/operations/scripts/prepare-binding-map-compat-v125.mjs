// Offline one-span amendment of the byte-verified v125 closure. Never deploys.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function prepareBindingCompatibility(input){
 const v=input?.payload||input;
 if(!v||v.name!=='cos-operations-pages'||v.verify_jwt!==false||v.entrypoint_path!=='cos-operations-pages/serve.ts'||v.import_map_path!=='cos-operations-pages/deno.json'||!Array.isArray(v.files)||v.files.length!==2)throw Error('Unexpected v125 payload configuration');
 const source=v.files.find(f=>f.name==='cos-operations-pages/serve.ts'),config=v.files.find(f=>f.name==='cos-operations-pages/deno.json');
 if(!source||!config||sha(source.content)!=='92af3c81c1e28c3091046be6295891a0d6bf325692d67db77c10bf6d156cd498'||sha(config.content)!=='c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be')throw Error('Verified v125 source/configuration drift');
 const tree=ts.createSourceFile('serve.ts',source.content,ts.ScriptTarget.Latest,true),found=[];
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='checkedImportedBinding2')found.push(n);ts.forEachChild(n,visit);}visit(tree);
 if(found.length!==1||found[0].parameters.map(p=>p.getText(tree)).join(',')!=='v,cosImportedDigest=addressDigest')throw Error('Imported validator signature drift');
 const position=found[0].body.getStart(tree)+1,text='if(typeof cosImportedDigest!=="function")cosImportedDigest=addressDigest;';
 const content=source.content.slice(0,position)+text+source.content.slice(position);
 if(content.slice(0,position)+content.slice(position+text.length)!==source.content)throw Error('Closure reversal failed');
 const payload={...v,files:v.files.map(f=>f===source?{...f,content}:f)};
 return {baseVersion:125,baseSourceSha256:sha(source.content),sourceSha256:sha(content),edit:{position,text},manifest:payload.files.map(f=>({name:f.name,sha256:sha(f.content)})),payload};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/prepare-binding-map-compat-v125.mjs verified-v125-packet.json output.json');
 const packet=prepareBindingCompatibility(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(output,JSON.stringify(packet));console.log(JSON.stringify({...packet,payload:undefined},null,2));
}
