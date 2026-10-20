import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),parser=require('@babel/parser');
const hash=s=>createHash('sha256').update(s).digest('hex');
/** Replace only the hoisted token factory before initialization, preserving
 * every byte of the current deployed bridge and all its concurrent extensions. */
export function extendMhelpReliabilityRuntime(original,helper){
 if(!original||!Array.isArray(original.files)||typeof helper!=='string'||!/^var CosMhelpReliabilityRuntime\s*=/.test(helper))throw Error('Invalid runtime extension');
 const entry=original.files.find(f=>f.name==='cos-operations-pages/serve.ts');
 if(!entry||entry.content.includes('var CosMhelpReliabilityRuntime'))throw Error('Fresh unextended bridge required');
 const parse=s=>parser.parse(s,{sourceType:'module'});
 const declarations=parse(entry.content).program.body.filter(n=>n.type==='FunctionDeclaration'&&n.id?.name==='nativeMhelpTokens');
 if(declarations.length!==1||!entry.content.includes('mhelpTokens=nativeMhelpTokens('))throw Error('Current native token factory interface changed');
 const prefix=helper+'\nnativeMhelpTokens=CosMhelpReliabilityRuntime.nativeMhelpTokens;\n';
 const content=prefix+entry.content;parse(content);
 const files=original.files.map(f=>f===entry?{...f,content}:{...f});
 return {files,proof:{originalVersion:original.version,originalSha256:hash(entry.content),helperSha256:hash(helper),prefixSha256:hash(prefix),resultSha256:hash(content),originalBytesPreserved:content.slice(prefix.length)===entry.content}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [originalPath,helperPath,out]=process.argv.slice(2);if(!out)throw Error('Usage: build-mhelp-reliability-runtime.mjs ORIGINAL_JSON HELPER_JS OUTPUT_JSON');
 const result=extendMhelpReliabilityRuntime(JSON.parse(await readFile(originalPath,'utf8')),await readFile(helperPath,'utf8'));
 await writeFile(out,JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result.proof));
}
