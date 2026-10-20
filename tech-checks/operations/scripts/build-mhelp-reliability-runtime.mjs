import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),parser=require('@babel/parser');
const hash=s=>createHash('sha256').update(s).digest('hex');
/** Replace scoped hoisted mHelp factories, and their error constructors after
 * initialization, without changing a byte of the current deployed bridge. */
export function extendMhelpReliabilityRuntime(original,helper,functionSlug='cos-operations-pages'){
 if(!original||!Array.isArray(original.files)||typeof helper!=='string'||!/^var CosMhelpReliabilityRuntime\s*=/.test(helper))throw Error('Invalid runtime extension');
 if(!['cos-operations-pages','cos-mhelp-placement-sync'].includes(functionSlug))throw Error('Unsupported compiled runtime');
 const entry=original.files.find(f=>f.name===functionSlug+'/serve.ts');
 if(!entry||entry.content.includes('var CosMhelpReliabilityRuntime'))throw Error('Fresh unextended bridge required');
 const parse=s=>parser.parse(s,{sourceType:'module'}),program=parse(entry.content).program;
 const names=functionSlug==='cos-operations-pages'?['nativeMhelpTokens','createMhelpPartnerHandler','createMhelpTicketReader','createMhelpUnitLocationReader']:['nativeMhelpTokens','createMhelpPartnerHandler'];
 const classes=functionSlug==='cos-operations-pages'?['MhelpPartnerError','MhelpTicketError']:['MhelpPartnerError'];
 for(const name of names)if(program.body.filter(n=>n.type==='FunctionDeclaration'&&n.id?.name===name).length!==1)throw Error('Current mHelp factory interface changed');
 for(const name of classes){const declarations=program.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).filter(n=>n.id?.name===name&&n.init?.type==='ClassExpression');if(declarations.length!==1)throw Error('Current mHelp error binding changed');}
 const anchors=[...entry.content.matchAll(/var (?:mhelpTokens|tokens)=nativeMhelpTokens\(/g)];if(anchors.length!==1)throw Error('Current native token initialization changed');const at=anchors[0].index;
 const prefix=helper+'\n'+names.map(name=>name+'=CosMhelpReliabilityRuntime.'+name+';').join('\n')+'\n';
 const late='\n'+classes.map(name=>name+'=CosMhelpReliabilityRuntime.'+name+';').join('\n')+'\n';
 const content=prefix+entry.content.slice(0,at)+late+entry.content.slice(at);parse(content);
 const preserved=content.slice(prefix.length,prefix.length+at)+content.slice(prefix.length+at+late.length)===entry.content;
 if(!preserved)throw Error('Unowned bridge bytes changed');
 const files=original.files.map(f=>f===entry?{...f,content}:{...f});
 return {files,proof:{originalVersion:original.version,originalSha256:hash(entry.content),helperSha256:hash(helper),prefixSha256:hash(prefix),lateBindingsSha256:hash(late),resultSha256:hash(content),originalBytesPreserved:preserved,ownedBindings:[...names,...classes]}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [originalPath,helperPath,out,functionSlug]=process.argv.slice(2);if(!out)throw Error('Usage: build-mhelp-reliability-runtime.mjs ORIGINAL_JSON HELPER_JS OUTPUT_JSON [FUNCTION_SLUG]');
 const result=extendMhelpReliabilityRuntime(JSON.parse(await readFile(originalPath,'utf8')),await readFile(helperPath,'utf8'),functionSlug);
 await writeFile(out,JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result.proof));
}
