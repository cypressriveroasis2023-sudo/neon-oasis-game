import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import ts from 'typescript';import {transform} from 'esbuild';
const digest=value=>createHash('sha256').update(value).digest('hex');
const functions=code=>{const file=ts.createSourceFile('serve.ts',code,ts.ScriptTarget.Latest,true);return file.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name).map(n=>({name:n.name.text,start:n.getStart(file),end:n.end,code:n.getText(file)}));};
const renameIdentifiers=(code,names)=>{const file=ts.createSourceFile('helper.ts',code,ts.ScriptTarget.Latest,true),edits=[];const visit=node=>{if(ts.isIdentifier(node)&&names[node.text])edits.push({start:node.getStart(file),end:node.end,text:names[node.text]});ts.forEachChild(node,visit);};visit(file);for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.text+code.slice(edit.end);return code;};
const definitions=[
 {file:'cameraPlacementEvidence.ts',source:'cameraSummary',target:'cameraSummary2',names:{cameraSummary:'cameraSummary2',validateCameraSources:'validateCameraSources2',resourceId:'resourceId2',witnessUnits:'witnessUnits2',cameraEvidence:'cameraEvidence2',cameraScope:'cameraScope2',currentCameraStatus:'currentCameraStatus2',deviceTrackerKey:'deviceTrackerKey2',canonicalTrackerKey:'canonicalTrackerKey2',reconBatteryEvidence:'reconBatteryEvidence2',normalized:'normalized3',object:'object25'}},
 {file:'cameraTrackerShopScope.ts',source:'currentTrackerShopScope',target:'currentTrackerShopScope',names:{cameraTimestamp:'cameraTimestamp2'}},
];
/** Replace only two reviewed pure health helpers in the freshly fetched live
 * bundle. Preserve every other byte, including newer auth/transfer wrappers. */
export async function prepareHealthReadDeployment(deployed){
 if(deployed?.name!=='cos-operations-pages'||!Number.isInteger(deployed.version)||typeof deployed.verify_jwt!=='boolean'||!Array.isArray(deployed.files))throw Error('Expected current deployed Operations function.');
 const entry=deployed.files.find(f=>f.name==='cos-operations-pages/serve.ts');if(!entry||typeof entry.content!=='string')throw Error('Expected protected Operations entrypoint.');
 const baseline=JSON.parse(await readFile(new URL('../tests/fixtures/health-read-deployment-functions.json',import.meta.url),'utf8')),edits=[];
 for(const definition of definitions){
  const matches=functions(entry.content).filter(f=>f.name===definition.target);if(matches.length!==1||digest(matches[0].code)!==digest(baseline[definition.target]))throw Error('Live health helper changed; inspect before release: '+definition.target);
  const source=await readFile(new URL('../../supabase/functions/cos-operations-pages/'+definition.file,import.meta.url),'utf8'),compiled=(await transform(source,{loader:'ts',target:'es2022',minifySyntax:true,minifyWhitespace:true})).code;
  const replacement=functions(compiled).find(f=>f.name===definition.source);if(!replacement)throw Error('Reviewed source helper missing.');
  const rewritten=renameIdentifiers(replacement.code.replace(/^export\s+/,''),definition.names);
  edits.push({...matches[0],after:rewritten});
 }
 let code=entry.content;for(const edit of [...edits].sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.after+code.slice(edit.end);
 let restored=code;for(const edit of edits){if(restored.split(edit.after).length!==2)throw Error('Ambiguous prepared helper.');restored=restored.replace(edit.after,edit.code);}if(restored!==entry.content)throw Error('Protected live bytes changed.');
 return {version:deployed.version,beforeSha256:digest(entry.content),afterSha256:digest(code),helpers:edits.map(e=>({name:e.name,beforeSha256:digest(e.code),afterSha256:digest(e.after)})),payload:{name:deployed.name,entrypoint_path:entry.name,verify_jwt:deployed.verify_jwt,files:deployed.files.map(f=>({name:f.name,content:f===entry?code:f.content}))}};
}
