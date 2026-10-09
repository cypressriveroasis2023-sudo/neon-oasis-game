// Local release preparation only: writes no remote state and rewrites no code.
import {readFile,readdir,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const functions=resolve(root,'supabase/functions');
const output=process.argv[2];if(!output)throw Error('Provide a local output directory.');
const outputRoot=resolve(output),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const names=['cos-operations-pages','camera-field-geocode','cos-geocode-sources'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const summary=[];
for(const name of names){
 const relative=[...(await readdir(resolve(functions,name))).filter(f=>f.endsWith('.ts')||f==='package.json').map(f=>name+'/'+f),'_shared/sourcePrecedence.ts','_shared/trackerNativeSource.ts','_shared/package.json'];
 const files=new Map();for(const file of relative){if(file.startsWith('/')||file.split('/').includes('..'))throw Error('Unsafe upload path');files.set(file,await readFile(resolve(functions,file)));}
 const imports=[];
 for(const [file,bytes] of files){
  if(!file.endsWith('.ts'))continue;
  const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw Error('Non-UTF8 source: '+file);
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const check=node=>{
   let spec;
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))spec=node.moduleSpecifier.text;
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){if(!ts.isStringLiteralLike(node.arguments[0]))throw Error('Nonliteral dynamic import: '+file);spec=node.arguments[0].text;}
   if(spec){
    if(spec.startsWith('.')){const target=posix.normalize(posix.join(posix.dirname(file),spec));if(target.startsWith('../')||!files.has(target))throw Error('Missing local import '+file+' -> '+spec);imports.push({from:file,specifier:spec,resolved:target});}
    else imports.push({from:file,specifier:spec,external:true});
   }
   ts.forEachChild(node,check);
  };check(source);
 }
 const bundleRoot=resolve(outputRoot,name);await mkdir(bundleRoot,{recursive:true});
 for(const [file,bytes] of files){const destination=resolve(bundleRoot,file);await mkdir(dirname(destination),{recursive:true});await copyFile(resolve(functions,file),destination);if(digest(await readFile(destination))!==digest(bytes))throw Error('Copy changed source bytes');}
 const manifest={functionName:name,entrypoint:name+'/serve.ts',commit,files:[...files].map(([file,bytes])=>({name:file,sha256:digest(bytes),bytes:bytes.length})),localImportClosureVerified:true,sourceBytesUnchanged:true,imports};
 await writeFile(resolve(outputRoot,name+'.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(resolve(outputRoot,name+'.upload.json'),JSON.stringify({name,entrypoint_path:manifest.entrypoint,files:[...files].map(([name,bytes])=>({name,content:bytes.toString('utf8')}))},null,2)+'\n');
 summary.push({name,entrypoint:manifest.entrypoint,fileCount:files.size,localImports:imports.filter(i=>!i.external).length});
}
await writeFile(resolve(outputRoot,'bundle-verification.json'),JSON.stringify({commit,bundles:summary,sourceBytesUnchanged:true,localImportClosureVerified:true,containsTraversalFilenames:false},null,2)+'\n');
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
