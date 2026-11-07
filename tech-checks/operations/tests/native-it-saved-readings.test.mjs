import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {build} from 'esbuild';
import {nativeSavedReadingsBaseline as baseline,prepareITSavedReadingsNative,sha256} from '../scripts/prepareITSavedReadingsNative.mjs';

const sourceDir=new URL('../../docs/fleet-provenance-repair-20261104/source/',import.meta.url);
const original=Object.fromEntries(Object.keys(baseline.sha256).map(name=>[name,readFileSync(new URL(name,sourceDir),'utf8')]));
const previews=(process.env.COS_NATIVE_PREVIEW_ORIGINS||'https://c2570a42.cos-vision-integration-preview.pages.dev').split(',');
const preview=previews[0];
const packet=prepareITSavedReadingsNative(original,previews);
const organization='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const identities={
 owner:{legacy:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',department:'owner',role:'owner',name:'Fixture Owner'},
 teddy:{legacy:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',department:'it',role:'it_technician',name:'Teddy Hopper'},
 victor:{legacy:'b7cc3cbf-d11e-4d4a-9742-c07701857911',actor:'3caf7c00-627f-445f-bce4-ddeae574ee5c',department:'it',role:'it_technician',name:'Victor Garcia'},
 service:{legacy:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',department:'service',role:'service_technician',name:'Abel Cervantes'},
};
async function compile(source){
 const result=await build({stdin:{contents:source+'\nexport {createOperationsHandler};',loader:'ts',resolveDir:fileURLToPath(sourceDir)},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent',plugins:[{name:'forbid-test-signing',setup(b){b.onResolve({filter:/^jose$/},()=>({path:'jose',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export function importPKCS8(){throw Error("Signing forbidden in native proof")} export class SignJWT{constructor(){throw Error("Signing forbidden in native proof")}}'}));}}]});
 return result.outputFiles[0].text;
}
const [baselineCode,candidateCode]=await Promise.all([compile(original['serve.ts']),compile(packet.files['serve.ts'])]);
function boot(code,stamp=Date.parse('2026-11-07T07:00:00Z')){
 let served=0;const module={exports:{}};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}}
 const context=vm.createContext({module,exports:module.exports,console,crypto:webcrypto,Date:FixedDate,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,fetch:()=>{throw Error('Network forbidden in native proof')},Deno:{env:{get:()=>undefined},serve:handler=>{assert.equal(typeof handler,'function');served++;}}});
 vm.runInContext(code,context,{timeout:5000});assert.equal(served,1);
 return module.exports.createOperationsHandler;
}
function fixture(createHandler,who=identities.teddy,{active=true,roleActive=true,origin=preview,authorization='Bearer synthetic-native-proof',authStatus=200}={}){
 const calls=[];
 const handler=createHandler({platformUrl:'https://native.example',serviceKey:'synthetic-key',fetch:async(url)=>{
  calls.push(String(url));const json=value=>Response.json(value);
  if(url.includes('/auth/v1/user'))return Response.json({id:who.legacy},{status:authStatus});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:who.legacy,full_name:who.name,role:who.department,active,archived_at:null}]);
  if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:who.actor,display_name:who.name,department:who.department,active}]);
  if(url.includes('/rest/v1/user_roles?'))return json(roleActive?[{role_id:'b0000000-0000-4000-8000-000000000001',roles:{code:who.role,organization_id:organization}}]:[]);
  throw Error('Unexpected operational transport: '+url);
 }});
 return {calls,request:(path='/api/session',method='GET')=>handler(new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...authorization?{Authorization:authorization}:{}},body:JSON.stringify({path,method,body:null})})),preflight:()=>handler(new Request('https://native.example/functions/v1/cos-operations-pages',{method:'OPTIONS',headers:{Origin:origin}}))};
}

test('native patch reverses to every original byte and preserves all seven dependencies',()=>{
 let source=packet.files['serve.ts'];
 for(const edit of [...packet.manifest.edits].reverse()){assert.equal(source.split(edit.after).length,2);source=source.replace(edit.after,edit.before);}
 assert.equal(source,original['serve.ts']);
 for(const [name,hash] of Object.entries(baseline.sha256))if(name!=='serve.ts')assert.equal(sha256(packet.files[name]),hash);
 assert.equal(packet.manifest.previewExpiresAt,'2026-11-09T23:59:59Z');
 for(const bad of ['https://evil.example','https://*.cos-vision-integration-preview.pages.dev','https://fix-it-saved-readings.cos-vision-integration-preview.pages.dev'])assert.throws(()=>prepareITSavedReadingsNative(original,[bad]));
 assert.throws(()=>prepareITSavedReadingsNative({...original,'serve.ts':original['serve.ts']+' '},[preview]));
});

test('actual native IT response adds only the already-verified actor identity',async()=>{
 const before=boot(baselineCode),after=boot(candidateCode);
 for(const who of [identities.teddy,identities.victor]){
  const old=fixture(before,who,{origin:'https://cos-vision-integration-preview.pages.dev'}),next=fixture(after,who);
  const oldResponse=await old.request(),response=await next.request();assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.productionTechnicianUserId,who.actor);
  const {productionTechnicianUserId,...rest}=body;assert.deepEqual(rest,await oldResponse.json());
  assert.deepEqual(next.calls,old.calls);assert.ok(next.calls.every(url=>!/\/rpc\//.test(url)));
 }
});

test('Owner session and all existing features remain byte-for-byte equivalent',async()=>{
 const origin='https://cos-vision-integration-preview.pages.dev';
 const a=await fixture(boot(baselineCode),identities.owner,{origin}).request();
 const b=await fixture(boot(candidateCode),identities.owner,{origin}).request();
 assert.equal(b.status,a.status);assert.equal(await b.text(),await a.text());
});

test('native authentication still denies invalid, inactive, Service and revoked-role identities',async()=>{
 const make=boot(candidateCode);
 for(const [who,options] of [[identities.teddy,{authorization:''}],[identities.teddy,{authStatus:401}],[identities.teddy,{active:false}],[identities.teddy,{roleActive:false}],[{...identities.teddy,name:'Wrong linked person'},{}],[identities.service,{}]]){
  const response=await fixture(make,who,options).request();assert.ok(response.status>=400);assert.equal((await response.json()).productionTechnicianUserId,undefined);
 }
});

test('temporary preview permits exact origins, rejects sibling origins and has no cached access',async()=>{
 const make=boot(candidateCode);
 for(const origin of packet.manifest.previewOrigins){
  const f=fixture(make,identities.teddy,{origin});const response=await f.request();assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(response.headers.get('Access-Control-Max-Age'),'0');assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
 const wrong=fixture(make,identities.teddy,{origin:'https://deadbeef.cos-vision-integration-preview.pages.dev'});const response=await wrong.request();assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(wrong.calls.length,0);
});

test('preview cannot issue mutations or read unlisted routes, and expiry remains enforced',async()=>{
 const make=boot(candidateCode);
 for(const [path,method] of [['/api/field-map','POST'],['/api/vrm-fleet/refresh','POST'],['/api/field-map/unlisted','GET']]){
  const f=fixture(make);const response=await f.request(path,method);assert.equal(response.status,405);assert.ok(f.calls.every(url=>!/\/rpc\//.test(url)));
 }
 const expired=fixture(boot(candidateCode,Date.parse('2026-11-10T00:00:00Z')));const response=await expired.request();assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(expired.calls.length,0);
});
