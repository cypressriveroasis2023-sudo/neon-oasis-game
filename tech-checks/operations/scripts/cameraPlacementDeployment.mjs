import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
// Preparation only: no network, deployment, database or provider calls.
// Preserve every deployed byte outside the single reviewed v3 placement fallback.
const beforeScope="function cameraScope2(device,tracker=[]){let activation=normalized3(device.activation_state),org=normalized3(device.organization),unit=normalized3(device.unit_key);if(device.__ownerPlacement===\"FIELD\"||device.__ownerPlacement===\"SHOP\"||device.__ownerPlacement===\"UNKNOWN\")return device.__ownerPlacement.toLowerCase();if(/^STOLEN FROM RII?[-\\s]*\\d+ ON \\d{2}\\/\\d{2}\\/\\d{4}$/.test(unit)||/^STOLEN FROM RII?[-\\s]*\\d+ ON \\d{2}\\/\\d{2}\\/\\d{4}$/.test(org)||[\"RETIRED\",\"STOLEN\",\"NOT IN USE\"].includes(org)||/^RII?[-\\s]*\\d+\\s*-?\\s*(?:NOT IN USE|RETIRED|STOLEN)$/.test(unit))return\"inactive\";if([\"ROOT\",\"SHOP\",\"SHOP/ROOT\",\"ROOT/SHOP\",\"SHOP / ROOT\",\"ROOT / SHOP\",\"SHOP EQUIPMENT\"].includes(org)||unit===\"SHOP EQUIPMENT\"||/^RII?[-\\s]*\\d+\\s*-?\\s*SHOP$/.test(unit))return\"shop\";if(activation===\"DEACTIVATED\")return\"inactive\";if(activation!==\"ACTIVE\")return\"unknown\";let matches2=tracker.filter(row2=>normalized3(row2.source_label)===unit);return matches2.length>1||matches2.some(row2=>[\"shop\",\"retired\"].includes(row2.tracker_state))||device.__trackerOnly||!org||[\"TRACKER FIELD\",\"TRACKER \\xB7 SITE NOT LINKED\",\"UNKNOWN\",\"FIELD OR UNKNOWN\"].includes(org)?\"unknown\":\"field\"}";
const afterScope=beforeScope.replace('?"unknown":"field"}', '?"unknown":"unknown"}');
export function prepareCameraPlacementDeployment(deployed,expected){
 if(deployed?.name!=='cos-operations-pages'||!Number.isInteger(deployed.version)||typeof deployed.verify_jwt!=='boolean'||!Array.isArray(deployed.files))throw Error('Expected complete deployed Operations function.');
 if(!expected||expected.version!==deployed.version||expected.verifyJwt!==deployed.verify_jwt||expected.bundleSha256!==deployed.ezbr_sha256||!/^[a-f0-9]{64}$/.test(expected.serveSha256??''))throw Error('Current deployment does not match reviewed release identity.');
 if(deployed.files.length!==2||new Set(deployed.files.map(f=>f.name)).size!==2||!deployed.files.every(f=>['cos-operations-pages/serve.ts','cos-operations-pages/deno.json'].includes(f.name)&&typeof f.content==='string'))throw Error('Unexpected deployed source closure.');
 const file=deployed.files.find(f=>f.name==='cos-operations-pages/serve.ts');
 const config=deployed.files.find(f=>f.name==='cos-operations-pages/deno.json');
 if(deployed.import_map!==true||typeof deployed.entrypoint_path!=='string'||!deployed.entrypoint_path.endsWith('/source/'+file.name)||deployed.import_map_path!==deployed.entrypoint_path.slice(0,-file.name.length)+config.name)throw Error('Deployed entrypoint or import-map routing changed.');
 if(digest(config.content)!==expected.configSha256)throw Error('Deployed dependency configuration changed.');
 if(digest(file.content)!==expected.serveSha256||file.content.split(beforeScope).length!==2)throw Error('Deployed source drift; review the complete closure again.');
 const code=file.content.replace(beforeScope,afterScope);
 if(code===file.content||code.replace(afterScope,beforeScope)!==file.content)throw Error('Protected deployment bytes changed.');
 const files=deployed.files.map(f=>({name:f.name,content:f===file?code:f.content}));
 return {version:deployed.version,bundleSha256:deployed.ezbr_sha256,beforeSha256:digest(file.content),afterSha256:digest(code),changedFallbacks:1,
 manifest:files.map(f=>({name:f.name,sha256:digest(f.content)})),
 payload:{name:deployed.name,entrypoint_path:file.name,import_map_path:config.name,verify_jwt:deployed.verify_jwt,files}};
}
