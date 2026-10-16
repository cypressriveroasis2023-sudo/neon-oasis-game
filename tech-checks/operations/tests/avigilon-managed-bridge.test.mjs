import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../avigilon-managed-bridge.js',import.meta.url),'utf8');
function fixture(features={avigilonSourceWrites:true,freshAvigilonChecks:true}){
 const calls=[],legacy=[];let fail=false,receipt='73';const run={id:'run',state:'completed',rows:[{name:'Sniper 1',outcome:'online',publicationReceipt:receipt}]};
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only'}}})},rpc:async(...args)=>{legacy.push(args);return {data:{legacy:true},error:null};},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{monitoring_profile:'sniper'}})})})}),functions:{invoke:async(...args)=>{legacy.push(args);return {data:{legacy:true}};}}};
 const fetch=async(url,options)=>{calls.push(JSON.parse(options.body));const request=calls.at(-1);if(fail)throw Error('network unavailable');return Response.json(request.path==='/api/session'?{features}:request.path==='/api/avigilon-source-write'?{result:{ok:true},admission:{admitted:true}}:{run:{...run,rows:run.rows.map(r=>({...r,publicationReceipt:receipt}))}});};
 const context={fetch,crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},setTimeout,Date};vm.runInNewContext(source,context);return {bridge:context.AvigilonManagedBridge.create(db,fetch),calls,legacy,setFail:()=>fail=true,dropReceipt:()=>receipt=null};
}
test('manual connection RPC uses native actor boundary, preserves original arguments, and never falls back after failure',async()=>{const f=fixture();const args={p_device_id:10,p_public_ip:'8.8.8.8',p_expected_revision:2,p_expected_unit_etag:'etag',p_ports:[443]};assert.equal((await f.bridge.db.rpc('set_camera_unit_connection_v2',args)).data.ok,true);assert.equal(f.legacy.length,0);assert.deepEqual(f.calls[1].body.args,args);assert.equal(f.calls[1].body.name,'set_camera_unit_connection_v2');f.setFail();assert.match((await f.bridge.db.rpc('set_camera_unit_connection_v2',args)).error.message,/network/);assert.equal(f.legacy.length,0);});
test('disabled native capability preserves existing RPC; managed manual verification requires native receipts',async()=>{const off=fixture({});assert.equal((await off.bridge.db.rpc('owner_remove_camera_unit_v1',{})).data.legacy,true);const f=fixture();const result=await f.bridge.db.functions.invoke('camera-health-check',{body:{device_id:10}});assert.equal(result.data.nativePublication,true);assert.equal(result.data.publicationReceipts[0],'73');assert.equal(f.legacy.length,0);f.dropReceipt();assert.match((await f.bridge.db.functions.invoke('camera-health-check',{body:{device_id:10}})).error.message,/receipt missing/);assert.equal(f.legacy.length,0);});
test('standalone managed health reads fail closed because identity must be loaded in the same generation',async()=>{
 const query={select(){return this;},eq(){return this;},maybeSingle(){return this;},then(resolve){return Promise.resolve({data:{camera_device_id:10,overall_status:'online'},error:null}).then(resolve);}};
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})},from:()=>query};
 const fetch=async()=>Response.json({features:{freshAvigilonChecks:true}});
 const context={fetch,crypto:{randomUUID:()=>''},setTimeout,Date};vm.runInNewContext(source,context);const bridge=context.AvigilonManagedBridge.create(db,fetch);
 const result=await bridge.db.from('camera_health_current').select('*').eq('camera_device_id',10).maybeSingle();
 assert.equal(result.data,null);assert.match(result.error.message,/identity and health together/);
});

test('legacy invocation decorators cannot recurse through the guarded functions proxy',async()=>{
 const f=fixture({});let decorated=0;const invoke=f.bridge.db.functions.invoke;
 f.bridge.db.functions.invoke=async(...args)=>{decorated++;if(decorated>2)throw Error('Legacy decorator recursion');return invoke(...args);};
 const result=await f.bridge.db.functions.invoke('camera-health-check',{body:{device_id:10}});
 assert.equal(result.error,undefined);assert.equal(result.data.legacy,true);assert.equal(f.legacy.length,1);assert.equal(decorated,1);
});
test('disabled native checks preserve legacy calls without identity lookups; denied checks never fall back',async()=>{
 let reads=0,legacy=0,denied=false;
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only'}}})},from(){reads++;throw Error('Disabled native reader must not run');},functions:{invoke:async()=>{legacy++;return {data:{legacy:true},error:null};}}};
 const fetch=async()=>denied?Response.json({error:'Initiating actor revoked'},{status:403}):Response.json({features:{freshAvigilonChecks:false}});
 const context={fetch,setTimeout,Date};vm.runInNewContext(source,context);const bridge=context.AvigilonManagedBridge.create(db,fetch);
 assert.equal((await bridge.db.functions.invoke('camera-health-check',{body:{device_id:10}})).data.legacy,true);assert.equal(reads,0);assert.equal(legacy,1);
 denied=true;const result=await bridge.db.functions.invoke('camera-health-check',{body:{device_id:10}});assert.match(result.error.message,/actor revoked/);assert.equal(legacy,1);assert.equal(reads,0);
});
