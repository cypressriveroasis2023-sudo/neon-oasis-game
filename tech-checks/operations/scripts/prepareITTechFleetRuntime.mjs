import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const legacyId='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';
const entryName='cos-operations-pages/serve.ts';
const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// These are the exact authenticated identity blocks read from the deployed
// Operations bundle. Every surrounding release and runtime setting stays intact.
const linksBefore='TECHNICIAN_LINKS=Object.freeze({"4f7044b5-86b6-411f-8898-39bb64b4ddbc":{actorId:"d0757b64-9623-4adc-afff-21cc7853e88a",name:"Teddy Hopper",department:"it",roleCode:"it_technician"},"b7cc3cbf-d11e-4d4a-9742-c07701857911":{actorId:"3caf7c00-627f-445f-bce4-ddeae574ee5c",name:"Victor Garcia",department:"it",roleCode:"it_technician"},"78e54fbd-c2db-4d18-8e3d-a9740adcf285":{actorId:"7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8",name:"Abel Cervantes",department:"service",roleCode:"service_technician"},"49dce28e-099a-40bb-a8d8-b39f9ffbabee":{actorId:"1a7d3523-8a3c-488a-9216-4e37f4f7ecb9",name:"Josh Mireles",department:"service",roleCode:"service_technician"}})';
const fleetBefore='function verifiedItFleet(context){return context?.department==="it"&&context?.legacyOwner===!1&&(context.legacyId==="4f7044b5-86b6-411f-8898-39bb64b4ddbc"&&context.actorId==="d0757b64-9623-4adc-afff-21cc7853e88a"||context.legacyId==="b7cc3cbf-d11e-4d4a-9742-c07701857911"&&context.actorId==="3caf7c00-627f-445f-bce4-ddeae574ee5c")}';

function once(source,before,after){
 if(source.split(before).length!==2)throw Error('ITTECH runtime anchors changed; inspect the current deployed identity gates.');
 return source.replace(before,after);
}

/** Prepare a local release only. actorId has no default: the release caller must
 * supply the independently verified native Test IT identity. This function does
 * not provision identities, grant roles, authenticate, or deploy anything. */
export function prepareITTechFleetRuntime(native,{expectedSha256,actorId}={}){
 if(native?.slug!=='cos-operations-pages'||native.name!=='cos-operations-pages'||!Number.isInteger(native.version)||native.version<1||native.verify_jwt!==false||!Array.isArray(native.files))throw Error('Expected the current custom-authenticated Operations deployment.');
 if(native.files.some(file=>typeof file?.name!=='string'||typeof file.content!=='string')||new Set(native.files.map(file=>file.name)).size!==native.files.length)throw Error('Operations deployment has invalid or duplicate files.');
 const file=native.files.find(item=>item.name===entryName),original=file?.content;
 if(typeof original!=='string'||typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha256)||digest(original)!==expectedSha256)throw Error('Production runtime changed; review its exact SHA-256 before preparing ITTECH access.');
 if(typeof actorId!=='string'||!uuid.test(actorId)||actorId===legacyId)throw Error('An independently verified native Test IT UUID is required.');
 // No existing employee/Owner identity may be borrowed for the test account.
 if(original.includes(actorId))throw Error('The proposed Test IT actor already appears in this runtime; review its identity instead of reusing it.');
 if(original.includes(legacyId))throw Error('ITTECH is already present in the runtime; inspect the existing linkage.');
 if(original.split('TECHNICIAN_LINKS=Object.freeze(').length!==2||original.split('function verifiedItFleet(').length!==2)throw Error('ITTECH runtime identity gates are missing or duplicated.');
 const addition=`"${legacyId}":{actorId:"${actorId}",name:"Test IT",department:"it",roleCode:"it_technician"}`;
 const linksAfter=linksBefore.slice(0,-2)+','+addition+'})';
 const fleetAfter=fleetBefore.slice(0,-2)+`||context.legacyId==="${legacyId}"&&context.actorId==="${actorId}")}`;
 const replacements=[[linksBefore,linksAfter],[fleetBefore,fleetAfter]];
 let content=original;
 for(const [before,after]of replacements)content=once(content,before,after);
 let restored=content;
 for(const [before,after]of [...replacements].reverse())restored=once(restored,after,before);
 if(restored!==original)throw Error('Unrelated production bytes changed.');
 const parsed=ts.createSourceFile('serve.ts',content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if(parsed.parseDiagnostics.length)throw Error('Invalid prepared ITTECH runtime.');
 return {
  bundle:{...native,files:native.files.map(item=>item===file?{...item,content}:item)},
  manifest:{contract:'COS_ITTECH_FLEET_RUNTIME_V1',baseVersion:native.version,baseSha256:digest(original),runtimeSha256:digest(content),legacyId,actorId,department:'it',roleCode:'it_technician',changedFiles:[entryName],changedGates:['TECHNICIAN_LINKS','verifiedItFleet'],unrelatedBytesPreserved:true},
 };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,expectedSha256,actorId,output]=process.argv.slice(2);
 if(!input||!expectedSha256||!actorId||!output)throw Error('Usage: prepareITTechFleetRuntime.mjs live-function.json expected-sha256 verified-native-test-it-uuid output-function.json');
 const result=prepareITTechFleetRuntime(JSON.parse(await readFile(input,'utf8')),{expectedSha256,actorId});
 await writeFile(output,JSON.stringify(result.bundle)+'\n');
 await writeFile(output+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n');
 console.log(JSON.stringify(result.manifest));
}
