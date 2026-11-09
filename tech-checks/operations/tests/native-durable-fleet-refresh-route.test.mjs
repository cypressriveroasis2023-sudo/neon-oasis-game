// Actual immutable-production handler; all authentication, RPC and source reads
// are synthetic in-memory transports. No production state is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import ts from 'typescript';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const directory=new URL('../../docs/vision-native-preview-20261107/source/',import.meta.url);
const source=readFileSync(new URL('serve.ts',directory),'utf8');
const code=buildSync({stdin:{contents:source+'\nglobalThis.__nativeFactory=createOperationsHandler;',resolveDir:fileURLToPath(directory),sourcefile:'serve.ts',loader:'ts'},bundle:true,platform:'node',format:'iife',target:'es2022',external:['jose'],write:false,logLevel:'silent'}).outputFiles[0].text;
const owner={legacy:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',department:'owner',role:'owner',name:'Synthetic Owner'};
const it={legacy:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',department:'it',role:'it_technician',name:'Teddy Hopper'};
const secondIt={legacy:'b7cc3cbf-d11e-4d4a-9742-c07701857911',actor:'3caf7c00-627f-445f-bce4-ddeae574ee5c',department:'it',role:'it_technician',name:'Victor Garcia'};
const service={legacy:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',department:'service',role:'service_technician',name:'Abel Cervantes'};
const recordId='a2345678-1234-1234-1234-123456789abc';
const organization='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
function fixture(who=owner,options={}){
 const data=fieldProductFixture(),calls=[],sources=[],tasks=[];
 const saved={contract:'COS_DURABLE_FLEET_READ_V1',latest:null,runs:[]};
 const json=(body,status=200)=>Response.json(body,{status});
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[data.now]));}static now(){return data.now;}}
 const deny=()=>{throw Error('Unexpected network or signing in offline proof');};
 const context=vm.createContext({console,crypto:webcrypto,structuredClone,Date:FixedDate,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,
  fetch:async(url,init)=>{
   assert.equal(url,'https://platform.example/functions/v1/cos-operations-pages');assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer synthetic-token');
   const body=JSON.parse(init.body);assert.equal(body.method,'GET');assert.equal(body.body,null);sources.push(body.path);
   if(options.sourceFails)return json({error:'synthetic unavailable'},404);
   const values={'/api/fleet-map-source':data.field,'/api/product-connections':data.connections,'/api/camera-health/summary-v3':data.health};assert.ok(Object.hasOwn(values,body.path));return json(values[body.path]);
  },require:name=>{assert.equal(name,'jose');return {importPKCS8:deny,SignJWT:class{constructor(){deny();}}};},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://platform.example':undefined},serve:()=>{}},EdgeRuntime:{waitUntil:task=>tasks.push(task)}});
 vm.runInContext(code,context,{timeout:5000});
 const handler=context.__nativeFactory({platformUrl:'https://platform.example',serviceKey:'synthetic-key',fetch:async(url,init={})=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({path,method:init.method||'GET',body});
  if(path==='/auth/v1/user')return json({id:who.legacy},options.invalidToken?401:200);
  if(path==='/rest/v1/profiles')return json([{user_id:who.legacy,full_name:who.name,role:who.department,active:!options.inactive,archived_at:null}]);
  if(path==='/rest/v1/user_profiles')return json([{user_id:who.actor,display_name:who.name,department:who.department,active:true}]);
  if(path==='/rest/v1/user_roles')return json(options.revoked?[]:[{role_id:recordId,roles:{code:who.role,organization_id:organization}}]);
  if(path==='/rest/v1/rpc/cos_fleet_board_read')return json(saved);
  if(path==='/rest/v1/rpc/cos_fleet_board_history')return json({items:[]});
  if(path==='/rest/v1/rpc/cos_fleet_board_begin')return json(options.leaseBusy?null:{id:recordId});
  if(['/rest/v1/rpc/cos_fleet_board_stage','/rest/v1/rpc/cos_fleet_board_finish','/rest/v1/rpc/cos_fleet_board_fail'].includes(path))return json(true);
  throw Error('Unexpected synthetic route '+path);
 }});
 return {calls,sources,tasks,saved,request:async(path='/api/fleet-saved-board/refresh',method='POST',body={})=>{
  const response=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:options.noBearer?'':'Bearer synthetic-token','Content-Type':'application/json',Origin:options.origin||'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method,body})}));
  const value=await response.json();await Promise.all(tasks);return {status:response.status,body:value};
 }};
}
test('recorded refresh dispatch is outside GET-only routing and hash matches',()=>{
 const ast=ts.createSourceFile('serve.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0);let matches=0;
 function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast).includes('/api/fleet-saved-board/refresh')){matches++;for(let p=node.parent;p;p=p.parent)if(ts.isIfStatement(p))assert.doesNotMatch(p.expression.getText(ast),/^method\s*===\s*['"]GET['"]$/);}ts.forEachChild(node,visit);}visit(ast);assert.equal(matches,1);
 const manifest=JSON.parse(readFileSync(new URL('../manifest.json',directory),'utf8'));assert.equal(createHash('sha256').update(source).digest('hex'),manifest.sourceHashes['serve.ts']);
});
for(const [label,who] of [['Owner',owner],['IT one',it],['IT two',secondIt]])test(label+' POST refresh reaches lease and completes all three sources',async()=>{
 const f=fixture(who),r=await f.request();assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,f.saved);assert.equal(f.tasks.length,1);assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));assert.deepEqual(rpcs.map(c=>c.path.split('/').at(-1)),['cos_fleet_board_begin','cos_fleet_board_read','cos_fleet_board_read','cos_fleet_board_stage','cos_fleet_board_finish']);assert.deepEqual(rpcs[0].body,{p_force:true});assert.equal(rpcs.at(-1).body.p_run,recordId);assert.equal(rpcs.at(-1).body.p_payload.contract,'COS_SAVED_FLEET_BOARD_V1');
});
test('saved read starts no refresh lease or source work',async()=>{
 const f=fixture(),r=await f.request('/api/fleet-saved-board','GET');assert.equal(r.status,200);assert.deepEqual(r.body,f.saved);assert.deepEqual(f.sources,[]);assert.equal(f.tasks.length,0);assert.deepEqual(f.calls.filter(c=>c.path.includes('/rpc/')).map(c=>c.path),['/rest/v1/rpc/cos_fleet_board_read']);
});
test('busy shared lease returns saved board without duplicate work',async()=>{
 const f=fixture(owner,{leaseBusy:true}),r=await f.request();assert.equal(r.status,200);assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.deepEqual(f.calls.filter(c=>c.path.includes('/rpc/')).map(c=>c.path.split('/').at(-1)),['cos_fleet_board_begin','cos_fleet_board_read']);
});
test('failed supporting read records failure without replacing completed board',async()=>{
 const f=fixture(owner,{sourceFails:true}),r=await f.request();assert.equal(r.status,200);assert.deepEqual(r.body,f.saved);assert.deepEqual(f.sources,['/api/fleet-map-source']);const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));assert.equal(rpcs.at(-1).path,'/rest/v1/rpc/cos_fleet_board_fail');assert.equal(rpcs.at(-1).body.p_code,'source_read_failed');assert.ok(rpcs.every(c=>!c.path.endsWith('stage')&&!c.path.endsWith('finish')));
});
for(const [name,who,options,status] of [['missing bearer',owner,{noBearer:true},401],['invalid bearer',owner,{invalidToken:true},401],['inactive owner',owner,{inactive:true},403],['revoked IT',it,{revoked:true},403],['Service',service,{},403],['foreign origin',owner,{origin:'https://unapproved.example'},403],['read-only preview',owner,{origin:'https://9321842b.cos-vision-integration-preview.pages.dev'},405]])test(name+' still cannot refresh',async()=>{
 const f=fixture(who,options),r=await f.request();assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.ok(f.calls.every(c=>!c.path.includes('/rpc/')));
});
for(const [name,path,method,body,status] of [['GET refresh','/api/fleet-saved-board/refresh','GET',{},405],['POST saved read','/api/fleet-saved-board','POST',{},405],['nonempty refresh','/api/fleet-saved-board/refresh','POST',{force:true},400],['forged actor','/api/fleet-saved-board/refresh','POST',{actorId:recordId},400]])test(name+' cannot start source work',async()=>{
 const f=fixture(),r=await f.request(path,method,body);assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.ok(f.calls.every(c=>!c.path.includes('/rpc/')));
});

test('saved history remains an authorized read without refresh work',async()=>{
 const f=fixture(it),r=await f.request('/api/fleet-saved-board/history/'+recordId,'GET');assert.equal(r.status,200);assert.deepEqual(r.body,{items:[]});assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));assert.equal(rpcs.length,1);assert.equal(rpcs[0].path,'/rest/v1/rpc/cos_fleet_board_history');assert.deepEqual(rpcs[0].body,{p_run:recordId});
});
