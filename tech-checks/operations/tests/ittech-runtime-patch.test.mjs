import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {prepareITTechFleetRuntime} from '../scripts/prepareITTechFleetRuntime.mjs';

const actorId='00000000-0000-4000-8000-000000000951'; // Synthetic local fixture only.
const legacyId='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';
const hash=value=>createHash('sha256').update(value).digest('hex');
const originalLinks={
 '4f7044b5-86b6-411f-8898-39bb64b4ddbc':{actorId:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',roleCode:'it_technician'},
 'b7cc3cbf-d11e-4d4a-9742-c07701857911':{actorId:'3caf7c00-627f-445f-bce4-ddeae574ee5c',name:'Victor Garcia',department:'it',roleCode:'it_technician'},
 '78e54fbd-c2db-4d18-8e3d-a9740adcf285':{actorId:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',roleCode:'service_technician'},
 '49dce28e-099a-40bb-a8d8-b39f9ffbabee':{actorId:'1a7d3523-8a3c-488a-9216-4e37f4f7ecb9',name:'Josh Mireles',department:'service',roleCode:'service_technician'},
};
const linksCode='var TECHNICIAN_LINKS=Object.freeze({'+Object.entries(originalLinks).map(([id,link])=>JSON.stringify(id)+':{'+Object.entries(link).map(([key,value])=>key+':'+JSON.stringify(value)).join(',')+'}').join(',')+'});';
const fleetCode='function verifiedItFleet(context){return context?.department==="it"&&context?.legacyOwner===!1&&(context.legacyId==="4f7044b5-86b6-411f-8898-39bb64b4ddbc"&&context.actorId==="d0757b64-9623-4adc-afff-21cc7853e88a"||context.legacyId==="b7cc3cbf-d11e-4d4a-9742-c07701857911"&&context.actorId==="3caf7c00-627f-445f-bce4-ddeae574ee5c")}';
const preservedBefore='// Existing live health and renewal releases.\nconst nativeOwner="3f073784-96e7-43d8-b9e0-33ab31c3c8b1";\n';
const preservedBetween='\nfunction authenticate(token){return token;}\n';
const preservedAfter='\nfunction fleetRouteAllowed(method,path){return method==="GET"&&path==="/api/session";}\n// Existing assignment, inventory and session repairs.\n';
const deployment=()=>({name:'cos-operations-pages',slug:'cos-operations-pages',version:114,verify_jwt:false,entrypoint_path:'/current/source/cos-operations-pages/serve.ts',import_map:true,import_map_path:'/current/source/cos-operations-pages/deno.json',files:[{name:'cos-operations-pages/serve.ts',content:preservedBefore+linksCode+preservedBetween+fleetCode+preservedAfter},{name:'cos-operations-pages/deno.json',content:'{"imports":{"jose":"npm:jose@6.2.12"},"nodeModulesDir":"auto"}'},{name:'cos-operations-pages/retained-helper.ts',content:'export const currentRelease="keep-exactly";'}]});
const prepare=(live=deployment(),options={})=>prepareITTechFleetRuntime(live,{expectedSha256:hash(live.files[0].content),actorId,...options});
const inspect=bundle=>runInNewContext(bundle.files[0].content+'\n({links:TECHNICIAN_LINKS,allowed:verifiedItFleet,route:fleetRouteAllowed})');

test('ITTECH patch adds only its exact IT link and preserves existing identities and capability scope',()=>{
 const live=deployment(),copy=structuredClone(live),result=prepare(live),runtime=inspect(result.bundle);
 assert.deepEqual(live,copy);
 const links=JSON.parse(JSON.stringify(runtime.links));
 assert.deepEqual(links,{...originalLinks,[legacyId]:{actorId,name:'Test IT',department:'it',roleCode:'it_technician'}});
 assert.equal(Object.isFrozen(runtime.links),true);
 for(const [id,link]of Object.entries(originalLinks))assert.equal(runtime.allowed({legacyId:id,actorId:link.actorId,department:link.department,legacyOwner:false}),link.department==='it');
 assert.equal(runtime.allowed({legacyId,actorId,department:'it',legacyOwner:false}),true);
 for(const change of [{actorId:originalLinks['4f7044b5-86b6-411f-8898-39bb64b4ddbc'].actorId},{legacyId:'33333333-3333-4333-8333-333333333333'},{department:'owner'},{department:'service'},{legacyOwner:true},{legacyOwner:undefined}])assert.equal(runtime.allowed({legacyId,actorId,department:'it',legacyOwner:false,...change}),false);
 assert.equal(runtime.route('GET','/api/session'),true);
 assert.equal(runtime.route('POST','/api/session'),false);
 assert.equal(runtime.route('GET','/api/ar'),false);
});

test('runtime settings, every other file and all surrounding live release bytes remain exact',()=>{
 const live=deployment(),{bundle,manifest}=prepare(live),{files:originalFiles,...metadata}=live,{files:patchedFiles,...patchedMetadata}=bundle;
 assert.deepEqual(patchedMetadata,metadata);
 assert.deepEqual(patchedFiles.slice(1),originalFiles.slice(1));
 assert.deepEqual(patchedFiles.map(file=>file.name),originalFiles.map(file=>file.name));
 assert.ok(patchedFiles[0].content.startsWith(preservedBefore));
 assert.ok(patchedFiles[0].content.includes(preservedBetween));
 assert.ok(patchedFiles[0].content.endsWith(preservedAfter));
 assert.equal(manifest.baseSha256,hash(originalFiles[0].content));
 assert.equal(manifest.runtimeSha256,hash(patchedFiles[0].content));
 assert.notEqual(manifest.baseSha256,manifest.runtimeSha256);
 assert.equal(manifest.unrelatedBytesPreserved,true);
 assert.deepEqual(manifest.changedGates,['TECHNICIAN_LINKS','verifiedItFleet']);
});

test('patch requires a reviewed base hash and an explicitly supplied independent actor',()=>{
 const live=deployment();
 assert.throws(()=>prepareITTechFleetRuntime(live),/SHA-256/);
 assert.throws(()=>prepare(live,{expectedSha256:'0'.repeat(64)}),/SHA-256/);
 for(const id of [undefined,null,'',legacyId,'not-a-uuid','00000000-0000-4000-8000-000000000951";grantOwner()',...Object.values(originalLinks).map(link=>link.actorId),'3f073784-96e7-43d8-b9e0-33ab31c3c8b1'])assert.throws(()=>prepare(live,{actorId:id}));
});

for(const [label,change]of [
 ['different function',live=>live.name='other-function'],
 ['changed gateway authentication',live=>live.verify_jwt=true],
 ['invalid version',live=>live.version='114'],
 ['missing entrypoint',live=>live.files[0].name='other.ts'],
 ['duplicate entrypoint',live=>live.files.push({...live.files[0]})],
 ['duplicate mapping anchor',live=>live.files[0].content+='\n'+linksCode],
 ['duplicate fleet anchor',live=>live.files[0].content+='\n'+fleetCode],
 ['changed existing technician link',live=>live.files[0].content=live.files[0].content.replace('name:"Teddy Hopper"','name:"Different Person"')],
 ['changed role guard',live=>live.files[0].content=live.files[0].content.replace('context?.department==="it"','context?.department==="owner"')],
 ['already linked ITTECH',live=>live.files[0].content+='\nconst priorITTECH="'+legacyId+'";'],
 ['invalid surrounding runtime',live=>live.files[0].content+='\nconst incomplete=;'],
])test('refuses '+label+' without producing a release',()=>{const live=deployment();change(live);const copy=structuredClone(live);assert.throws(()=>prepare(live));assert.deepEqual(live,copy);});

test('a prepared bundle cannot be patched a second time',()=>{
 const {bundle}=prepare();
 assert.throws(()=>prepare(bundle),/already appears|already present/);
});
