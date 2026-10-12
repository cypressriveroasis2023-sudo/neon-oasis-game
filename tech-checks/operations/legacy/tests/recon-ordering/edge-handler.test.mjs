import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync(process.env.RECON_WEBHOOK_SOURCE || new URL('../../../../supabase/functions/reconeyez-webhook/index.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''),{mode:'strip'});
function setup(options={}) {
  const operations=[];
  const db={rpc:async(name,args)=>{
    operations.push({rpc:name,args});
    if(name==='get_reconeyez_integration_secrets')return {data:[{webhook_secret:'synthetic-test-secret'}],error:null};
    return options.rpcError ? {data:null,error:{message:'synthetic failure'}} : {data:{applied:true,outcome:'applied',status:'online',health_changed:true},error:null};
  },from(table){
    let inserted=null;
    const b={select(){return b},eq(){return b},update(value){operations.push({table,update:value});return b},insert(value){inserted=value;operations.push({table,insert:value});return b},
      async maybeSingle(){
        if(table==='camera_devices')return {data:{id:1,device_name:'Synthetic',source_metadata:{}},error:null};
        if(table==='camera_integrations')return {data:{metadata:{}},error:null};
        if(table==='camera_integration_events')return options.insertError?{data:null,error:{message:'synthetic insert failure'}}: {data:options.noEventId?null:{id:99},error:null};
        throw Error(`Unexpected table ${table}`);
      },then(resolve){return Promise.resolve({data:null,error:null}).then(resolve)}};
    return b;
  }};
  let handler;
  const ctx=vm.createContext({crypto,TextEncoder,Uint8Array,Response,Request,URL,AbortSignal,console:{error(){}},
    createClient:()=>db,archiveReconPayload:async(_db,b)=>({...structuredClone(b),cos_private_archive:{archivedAt:'synthetic-archive-time'}}),
    Deno:{env:{get:()=> 'synthetic-environment'},serve(fn){handler=fn}}});
  vm.runInContext(js+'\nglobalThis.helpers={parseObservedAt,reconEventKey,withOrderingKey,healthFromEvent};',ctx);
  return {operations,handler,helpers:ctx.helpers};
}
const body={event_type:'RP',event_guid:'synthetic-event',date_time:'2026-10-12T14:07:12Z',device_info:{guid:'SYNTHETIC-1',battery_percentage:80}};
const request=value=>new Request('https://synthetic.invalid/webhook',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer synthetic-test-secret'},body:JSON.stringify(value)});
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name)};
await test('original provider timestamp retained',async()=>{const x=setup();assert.equal(x.helpers.parseObservedAt(body),'2026-10-12T14:07:12.000Z')});
await test('missing/invalid time is null, never receipt time',async()=>{const x=setup();assert.equal(x.helpers.parseObservedAt({}),null);assert.equal(x.helpers.parseObservedAt({date_time:'invalid'}),null)});
await test('original-body key is stable across object-key order',async()=>{const x=setup();assert.equal(await x.helpers.reconEventKey({b:2,a:{d:4,c:3}}),await x.helpers.reconEventKey({a:{c:3,d:4},b:2}))});
await test('provider event GUID used as dedupe key',async()=>{assert.equal(await setup().helpers.reconEventKey(body),'guid:synthetic-event')});
await test('colliding reserved field remains recoverable',async()=>{const x=setup(),original={...body,cos_event_order_v1:{key:'original-provider-data',nested:[1,2]}}; const response=await x.handler(request(original));assert.equal(response.status,200);const logged=x.operations.find(x=>x.table==='camera_integration_events'&&x.insert).insert;assert.deepEqual(JSON.parse(JSON.stringify(logged.payload.cos_event_order_v1.original_payload_value)),original.cos_event_order_v1);assert.equal(logged.payload.cos_event_order_v1.key,'guid:synthetic-event')});
await test('audit insertion precedes the only projection RPC',async()=>{const x=setup();await x.handler(request(body));const a=x.operations.findIndex(x=>x.table==='camera_integration_events'&&x.insert),b=x.operations.findIndex(x=>x.rpc==='cos_apply_recon_event_v1');assert.ok(a>=0&&b>a);assert.equal(x.operations.filter(x=>x.rpc==='cos_apply_recon_event_v1').length,1);assert.ok(!x.operations.some(x=>['camera_devices','camera_health_current','camera_health_history'].includes(x.table)&&x.update));assert.equal(x.operations[a].insert.processed,false)});
await test('audit failure returns 503 and never projects',async()=>{const x=setup({insertError:true});assert.equal((await x.handler(request(body))).status,503);assert.ok(!x.operations.some(x=>x.rpc==='cos_apply_recon_event_v1'))});
await test('missing returned audit ID returns 503 and never projects',async()=>{const x=setup({noEventId:true});assert.equal((await x.handler(request(body))).status,503);assert.ok(!x.operations.some(x=>x.rpc==='cos_apply_recon_event_v1'))});
await test('RPC failure returns 503 with already retained audit row',async()=>{const x=setup({rpcError:true});assert.equal((await x.handler(request(body))).status,503);assert.ok(x.operations.some(x=>x.table==='camera_integration_events'&&x.insert))});
await test('metadata update does not carry stale camera snapshot',async()=>{const x=setup();await x.handler(request(body));const args=x.operations.find(x=>x.rpc==='cos_apply_recon_event_v1').args;assert.equal(args.p_event_id,99);assert.equal(args.p_metadata_patch.battery_percent,80);assert.ok(!Object.hasOwn(args.p_metadata_patch,'last_event_at'));assert.ok(!Object.hasOwn(args.p_metadata_patch,'area'))});
console.log(`${count} Edge-handler tests passed. Provider/auth/archive I/O is mocked; production was not called.`);
