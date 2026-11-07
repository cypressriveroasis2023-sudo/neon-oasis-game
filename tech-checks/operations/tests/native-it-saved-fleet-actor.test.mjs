// Execute the recorded production handler entirely with synthetic, in-memory
// transports. No live session, database, provider or deployment is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildSync} from 'esbuild';
import {preparePayload,liveMatchesPrecondition,sha256} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const patch=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-operations-pages/it-saved-fleet-actor-v154.json'),'utf8'));
const read=name=>readFileSync(join(root,patch.sourceDir,name));
const prepared=preparePayload(patch,read);
const original=read('serve.ts');
const candidate=prepared.find(file=>file.recordName==='serve.ts').content;

function boot(source){
 const {outputFiles}=buildSync({stdin:{contents:source.toString('utf8')+'\nglobalThis.__nativeFactory=createOperationsHandler;',resolveDir:join(root,patch.sourceDir),sourcefile:'serve.ts',loader:'ts'},bundle:true,platform:'node',format:'iife',target:'es2022',external:['jose'],write:false,logLevel:'silent'});
 const deny=()=>{throw Error('Network and signing are forbidden in this offline proof');};
 const context=vm.createContext({console,crypto:webcrypto,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:deny,require:name=>{assert.equal(name,'jose');return {importPKCS8:deny,SignJWT:class{constructor(){deny();}}};},Deno:{env:{get:()=>undefined},serve:()=>{}}});
 vm.runInContext(outputFiles[0].text,context);
 assert.equal(typeof context.__nativeFactory,'function');
 return context.__nativeFactory;
}
const factories={original:boot(original),candidate:boot(candidate)};
// IDs and required identity names come from the existing bridge configuration.
// All returned records and tokens are synthetic and never leave this process.
const ownerId='e4abc521-1ef3-45a6-9829-b87faff78210';
const ownerActor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const orgId='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const recordId='a2345678-1234-1234-1234-123456789abc';
const technicians={
 '4f7044b5-86b6-411f-8898-39bb64b4ddbc':{actor:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',role:'it_technician'},
 'b7cc3cbf-d11e-4d4a-9742-c07701857911':{actor:'3caf7c00-627f-445f-bce4-ddeae574ee5c',name:'Victor Garcia',department:'it',role:'it_technician'},
 '78e54fbd-c2db-4d18-8e3d-a9740adcf285':{actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',role:'service_technician'},
};
const itIds=Object.keys(technicians).filter(id=>technicians[id].department==='it');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
function transport(scenario,calls){
 const userId=scenario.userId||ownerId,tech=technicians[userId],actor=tech?.actor||ownerActor;
 return async(url,init={})=>{
  calls.push({url:String(url),method:init.method||'GET',body:init.body?JSON.parse(init.body):null});
  if(url.includes('/auth/v1/user'))return scenario.invalidToken?json({message:'Invalid JWT'},401):json({id:userId});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:userId,full_name:scenario.wrongLegacyName?'Changed name':tech?.name||'Synthetic Owner',role:scenario.legacyRole||tech?.department||'owner',active:!scenario.inactive,archived_at:scenario.archived?'2026-01-01':null}]);
  if(url.includes('/rest/v1/user_profiles?'))return json(scenario.actorMissing?[]:[{user_id:scenario.wrongActor?recordId:actor,display_name:scenario.wrongNativeName?'Changed name':tech?.name||'Synthetic Owner',active:!scenario.actorInactive,department:scenario.wrongDepartment?'service':tech?.department||'owner'}]);
  if(url.includes('/rest/v1/user_roles?'))return json(scenario.roleRevoked?[]:[{role_id:recordId,roles:{code:scenario.wrongRole?'owner':tech?.role||'owner',organization_id:scenario.wrongOrg?recordId:orgId}}]);
  throw Error('Unexpected synthetic transport route: '+url);
 };
}
async function session(factory,scenario={}){
 const calls=[];
 const handler=factory({platformUrl:'https://platform.example',serviceKey:'synthetic-service-key',fetch:transport(scenario,calls)});
 const response=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:scenario.noBearer?'':'Bearer synthetic-token','Content-Type':'application/json',Origin:scenario.foreignOrigin?'https://unapproved.example':'https://cos-vision-integration-preview.pages.dev'},body:JSON.stringify({path:scenario.path||'/api/session',method:'GET',body:scenario.forgedActor?{productionTechnicianUserId:ownerActor}:{}})}));
 return {status:response.status,body:await response.json(),calls};
}

test('recorded v154 patch changes only the verified IT response and is exactly reversible',()=>{
 assert.equal(patch.edits.length,1);assert.equal(patch.edits[0].occurrences,1);
 const {needle,replacement}=patch.edits[0];
 assert.equal(replacement.replace('productionTechnicianUserId:context.actorId,',''),needle);
 assert.equal(candidate.length-original.length,43);
 assert.deepEqual(Buffer.from(candidate.toString('utf8').replace(replacement,needle),'utf8'),original);
 assert.equal(prepared.length,8);
 for(const file of prepared)if(file.recordName!=='serve.ts')assert.deepEqual(file.content,read(file.recordName));
 const record=JSON.parse(readFileSync(join(root,patch.sourceRecord),'utf8'));
 assert.equal(patch.sourceCommit,record.sourceCommit);
 assert.equal(patch.requireLiveBeforeDeploy.version,record.version);
 assert.equal(patch.requireLiveBeforeDeploy.ezbr_sha256,record.archiveSha256);
 assert.equal(patch.verifyJwt,record.verifyJwt);
});
test('source drift, unexpected edit multiplicity and candidate hash drift stop preparation',()=>{
 assert.throws(()=>preparePayload(patch,name=>name==='serve.ts'?Buffer.concat([read(name),Buffer.from('\n')]):read(name)),/before hash mismatch/);
 const duplicate=structuredClone(patch);duplicate.edits[0].occurrences=2;
 assert.throws(()=>preparePayload(duplicate,read),/occurs 1 times, expected 2/);
 const changed=structuredClone(patch);changed.expectedAfter['serve.ts']=sha256(original);
 assert.throws(()=>preparePayload(changed,read),/after hash mismatch/);
});
test('a changed production version or archive fails the recorded deployment precondition',()=>{
 const live=patch.requireLiveBeforeDeploy;
 assert.deepEqual(liveMatchesPrecondition(live,live),[]);
 assert.ok(liveMatchesPrecondition({...live,version:155},live).length);
 assert.ok(liveMatchesPrecondition({...live,ezbr_sha256:'0'.repeat(64)},live).length);
 assert.ok(liveMatchesPrecondition({...live,status:'INACTIVE'},live).length);
});
for(const [index,userId] of itIds.entries())test('native verified IT account '+(index+1)+' receives only its own actor ID',async()=>{
 const before=await session(factories.original,{userId}),after=await session(factories.candidate,{userId});
 assert.equal(before.status,200);assert.equal(after.status,200);
 assert.equal(after.body.authorized,true);assert.equal(after.body.role,'IT');assert.equal(after.body.legacyOwner,false);
 assert.equal(after.body.productionOwnerUserId,null);
 assert.equal(after.body.productionTechnicianUserId,technicians[userId].actor);
 assert.notEqual(after.body.productionTechnicianUserId,ownerActor);
 const {productionTechnicianUserId,...unchanged}=after.body;
 assert.deepEqual(unchanged,before.body);
 assert.deepEqual(after.calls,before.calls);assert.ok(after.calls.every(call=>call.method==='GET'));
});
const unchangedCases=[
 ['Owner session',{},200],
 ['unmapped Owner session',{userId:recordId},200],
 ['IT technician session',{userId:itIds[0],path:'/api/tech/session'},200],
 ['missing bearer',{noBearer:true},401],
 ['invalid bearer',{invalidToken:true},401],
 ['foreign origin',{foreignOrigin:true},403],
 ['client-supplied actor ID',{userId:itIds[0],forgedActor:true},400],
 ['inactive legacy IT',{userId:itIds[0],inactive:true},403],
 ['archived legacy IT',{userId:itIds[0],archived:true},403],
 ['changed legacy identity',{userId:itIds[0],wrongLegacyName:true},403],
 ['changed native identity',{userId:itIds[0],wrongNativeName:true},403],
 ['missing native actor',{userId:itIds[0],actorMissing:true},403],
 ['inactive native actor',{userId:itIds[0],actorInactive:true},403],
 ['wrong native actor',{userId:itIds[0],wrongActor:true},403],
 ['wrong native department',{userId:itIds[0],wrongDepartment:true},403],
 ['revoked native role',{userId:itIds[0],roleRevoked:true},403],
 ['wrong native role',{userId:itIds[0],wrongRole:true},403],
 ['wrong organization',{userId:itIds[0],wrongOrg:true},403],
 ['unmapped legacy IT',{userId:recordId,legacyRole:'it'},403],
 ['service account',{userId:Object.keys(technicians)[2]},403],
];
for(const [name,scenario,status] of unchangedCases)test('native '+name+' response and access checks remain unchanged',async()=>{
 const before=await session(factories.original,scenario),after=await session(factories.candidate,scenario);
 assert.equal(before.status,status,JSON.stringify(before.body));assert.equal(after.status,status,JSON.stringify(after.body));
 assert.deepEqual(after,before);
 if(scenario.path!=='/api/tech/session')assert.equal(Object.hasOwn(after.body,'productionTechnicianUserId'),false);
 if(scenario.noBearer||scenario.foreignOrigin)assert.equal(after.calls.length,0);
 assert.ok(after.calls.every(call=>call.method==='GET'));
});
