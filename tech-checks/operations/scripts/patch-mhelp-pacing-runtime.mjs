import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),parser=require('@babel/parser');
const hash=s=>createHash('sha256').update(s).digest('hex');
const beforeHash='7f92ef2d04072aeca6d20774eb9d072755bb4266473985cd9633347f7ed0da42';
/** Patch only the reviewed admission factory inside an existing reliability
 * overlay. Never rebuild or replace the surrounding current application. */
export function patchMhelpPacingRuntime(original,slug){
 if(!['cos-operations-pages','cos-mhelp-placement-sync'].includes(slug)||!original||!Array.isArray(original.files))throw Error('Unsupported pacing runtime');
 const entry=original.files.find(f=>f.name===slug+'/serve.ts');
 if(!entry||!entry.content.includes('var CosMhelpReliabilityRuntime'))throw Error('Current reliability overlay required');
 const functions=[];
 const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&node.id?.name==='createMhelpRequestBudget')functions.push(node);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}};
 walk(parser.parse(entry.content,{sourceType:'module'}));
 if(functions.length!==1)throw Error('Ambiguous request allowance factory');
 const node=functions[0],before=entry.content.slice(node.start,node.end);
 if(hash(before)!==beforeHash)throw Error('Current request allowance changed; preserve and inspect newer work');
 const condition='gate.reason === "pacing" && delay > 0 && delay <= 1e3 && tries < 79',wait='await wait(delay, signal);';
 if(before.split(condition).length!==2||before.split(wait).length!==2)throw Error('Pacing predicate anchors changed');
 const after=before.replace(condition,'gate.reason === "pacing" && delay <= 1e3 && tries < 79').replace(wait,'await wait(Math.max(1, delay), signal);');
 const prefix=entry.content.slice(0,node.start),suffix=entry.content.slice(node.end),content=prefix+after+suffix;
 parser.parse(content,{sourceType:'module'});
 const files=original.files.map(f=>f===entry?{...f,content}:{...f});
 return {files,proof:{originalVersion:original.version,originalEntrySha256:hash(entry.content),resultEntrySha256:hash(content),beforeFactorySha256:beforeHash,afterFactorySha256:hash(after),unownedPrefixSha256:hash(prefix),unownedSuffixSha256:hash(suffix),unownedBytesPreserved:true}};
}
