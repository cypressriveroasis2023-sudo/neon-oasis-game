import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareMappedIdentityDeployment,mappedPreviewAnchor} from '../scripts/mappedIdentityDeployment.mjs';
import {mappedFixture,unitKey,now} from './mapped-identity-fixture.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function bridge(){
 const content=`class OwnerIdentityError extends Error {constructor(message,status){super(message);this.status=status;}}
 function fail16(message,status){throw new OwnerIdentityError(message,status);}
 async function handle(context,path,method,body,read){const request={},actorPayload={},json=x=>x,requestBody=async()=>body,readIdentitySources=async()=>({sources:(await read()).sources}),readMhelpPlacements=async()=>({upload:(await read()).upload}),createOwnerIdentityReview=()=>()=>({existing:true}),ORGANIZATION_ID='synthetic',rpc=()=>{throw Error('mutation forbidden')};
 ${mappedPreviewAnchor}{actorId:context.actorId})(path,method,body));return {unrelated:true};}
 const untouched='indexed lookups, tracker scope, preflight, existing fallback';`;
 const deployed={name:'cos-operations-pages',version:7,verify_jwt:false,ezbr_sha256:'a'.repeat(64),import_map:true,entrypoint_path:'/tmp/source/cos-operations-pages/serve.ts',import_map_path:'/tmp/source/cos-operations-pages/deno.json',files:[{name:'cos-operations-pages/serve.ts',content},{name:'cos-operations-pages/deno.json',content:'{"imports":{}}'}]};
 return {deployed,expected:{version:7,verifyJwt:false,bundleSha256:deployed.ezbr_sha256,serveSha256:hash(content),configSha256:hash(deployed.files[1].content)}};
}
test('isolated additive artifact preserves complete original source, config and exact rollback',async t=>{
 const {deployed,expected}=bridge(),original=JSON.stringify(deployed),r=await prepareMappedIdentityDeployment(deployed,expected);
 assert.equal(r.proof.originalBytesPreserved,true);assert.equal(JSON.stringify(deployed),original);assert.deepEqual(r.rollback.files,deployed.files);assert.deepEqual(r.payload.files[1],deployed.files[1]);assert.equal(r.payload.verify_jwt,deployed.verify_jwt);assert.equal(r.payload.entrypoint_path,'cos-operations-pages/serve.ts');
 assert.equal(r.manifest[0].sha256,hash(r.payload.files[0].content));assert.ok(r.proof.dependencyInputs.some(p=>p.endsWith('mappedIdentityReview.ts')));
 t.diagnostic(JSON.stringify({mappedPreviewHelperSha256:r.proof.helperSha256}));
});
test('existing module imports are preserved without resolving or rebundling them',async()=>{
 const {deployed,expected}=bridge();deployed.files[0].content="import {existing} from 'existing-dependency';\n"+deployed.files[0].content;expected.serveSha256=hash(deployed.files[0].content);
 const r=await prepareMappedIdentityDeployment(deployed,expected);assert.equal(r.proof.originalBytesPreserved,true);assert.ok(r.payload.files[0].content.includes("import {existing} from 'existing-dependency';"));
 await assert.rejects(prepareMappedIdentityDeployment({...deployed,files:r.payload.files},{...expected,serveSha256:r.proof.candidateServeSha256}),/exact unextended Owner route/);
});
test('actual bundled helper respects Owner gate, error class, existing routes and no-confirmation boundary',async()=>{
 const {deployed,expected}=bridge(),r=await prepareMappedIdentityDeployment(deployed,expected);
 class Clock extends Date {static now(){return now;}}
 const handle=new Function('Date',r.payload.files[0].content+'\nreturn handle;')(Clock),f=mappedFixture(),saved=JSON.stringify(f);let reads=0;
 const read=async()=>{reads++;return f;};
 await assert.rejects(handle({legacyOwner:false},'/api/owner-identity/mapped-preview','POST',{productId:'101',unitKey},read),e=>e.status===403);assert.equal(reads,0);
 const result=await handle({legacyOwner:true},'/api/owner-identity/mapped-preview','POST',{productId:'101',unitKey},read);assert.equal(result.reviewOnly,true);assert.equal(result.commitSupported,false);assert.equal(reads,4);assert.equal(JSON.stringify(f),saved);
 await assert.rejects(handle({legacyOwner:true},'/api/owner-identity/mapped-preview','POST',{productId:'101',unitKey,proof:'forged'},read),e=>e.status===400&&e.constructor.name==='OwnerIdentityError');
 assert.deepEqual(await handle({legacyOwner:true},'/api/owner-identity/review','GET',null,read),{existing:true});assert.deepEqual(await handle({legacyOwner:true},'/api/unrelated','GET',null,read),{unrelated:true});
});
for(const [name,change] of [
 ['source drift',d=>d.files[0].content+=' '],['config drift',d=>d.files[1].content+=' '],['version drift',d=>d.version++],['security drift',d=>d.verify_jwt=true],['missing source',d=>d.files.pop()],['changed routing',d=>d.import_map=false],
])test('artifact refuses '+name,async()=>{const {deployed,expected}=bridge();change(deployed);await assert.rejects(prepareMappedIdentityDeployment(deployed,expected));});
