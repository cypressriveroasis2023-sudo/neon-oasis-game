import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync(process.env.RECON_WEBHOOK_SOURCE || new URL('../../../../supabase/functions/reconeyez-webhook/index.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''),{mode:'strip'});
const entryTime='2026-10-14T15:00:00.000Z';
const receiverAttempt='f583824d-9e16-4789-984b-2764b85bcc0b';
const fingerprint='a'.repeat(64);
const clone=value=>JSON.parse(JSON.stringify(value));
const receiptResult=(id=99,time=entryTime,outcome='applied')=>({schema_version:2,event_id:id,receipt_started_at:time,outcome,applied:outcome==='applied'});
const ackResult=(id=99,overrides={})=>({schema_version:2,attempt_id:receiverAttempt,kind:'receiver_test',ordinal:1,observed_at:'2026-10-14T14:59:59Z',outcome:'applied',applied:true,terminal_outcome:'success',current:true,input_fingerprint:fingerprint,reason_code:null,result:{receiver_ready:true,ack_event_id:id,receiver_tested_at:entryTime},...overrides});
function setup(options={}) {
  const operations=[];
  let lookupIndex=0,projectionIndex=0,metadataIndex=0,eventId=98,clock=Date.parse(options.entryTime || entryTime),timerId=0;
  const timers=new Map();
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const runTimers=milliseconds=>{
    clock+=milliseconds;
    for(const [id,timer] of timers)if(timer.at<=clock){timers.delete(id);timer.fn();}
  };
  const metadataReplies=[];
  const db={rpc:async(name,args)=>{
    operations.push({rpc:name,args:args && clone(args),at:clock});
    if(name==='get_reconeyez_integration_secrets'){
      assert.equal(args,undefined);
      if(options.authMilliseconds)runTimers(options.authMilliseconds);
      return {data:[{webhook_secret:'synthetic-test-secret'}],error:null};
    }
    if(name==='recon_record_webhook_receipt_v2'||name==='recon_finish_receiver_ack_v2'){
      assert.deepEqual(Object.keys(args).sort(),name==='recon_record_webhook_receipt_v2'?['p_event_id']:['p_attempt_id','p_event_id']);
      assert.ok(Number.isSafeInteger(args.p_event_id)&&args.p_event_id>0);
      const audit=operations.find(operation=>operation.table==='camera_integration_events'&&operation.eventId===args.p_event_id)?.insert;
      assert.ok(audit,'metadata requires a committed audit');
      assert.equal(audit.recon_receipt_kind,name==='recon_record_webhook_receipt_v2'?'ordinary':'receiver_test');
      if(name==='recon_finish_receiver_ack_v2')assert.equal(args.p_attempt_id,audit.recon_receiver_attempt_id);
      const fixture=options.metadata?.[metadataIndex++] ?? options.metadataDefault;
      if(fixture==='pending')return new Promise(()=>{});
      if(fixture instanceof Error)throw fixture;
      const reply=typeof fixture==='function'?await fixture({name,args,audit,clock,operations}):fixture || {data:name==='recon_record_webhook_receipt_v2'?receiptResult(args.p_event_id,audit.recon_receipt_started_at):ackResult(args.p_event_id),error:null};
      metadataReplies.push(reply);
      return reply;
    }
    assert.equal(name,'cos_apply_recon_event_v1','unexpected RPC');
    assert.deepEqual(Object.keys(args).sort(),['p_event_id','p_event_key','p_metadata_patch']);
    if(options.projections){const reply=options.projections[projectionIndex++];if(reply instanceof Error)throw reply;return {data:reply,error:null};}
    return options.rpcError ? {data:null,error:{message:'synthetic failure'}} : {data:{applied:true,outcome:'applied',status:'online',health_changed:true},error:null};
  },from(table){
    assert.notEqual(table,'camera_integrations','consumer must not read or write integration snapshots');
    assert.ok(['camera_devices','camera_integration_events'].includes(table),'unexpected table');
    let inserted=null;
    const filters=[];
    const b={select(){return b},eq(column,value){filters.push([column,value]);return b},update(value){operations.push({table,update:value});return b},insert(value){inserted=value;operations.push({table,insert:value});return b},
      async maybeSingle(){
        if(table==='camera_devices'){
          operations.push({table,lookup:true,filters});
          if(options.lookups){
            const result=options.lookups[lookupIndex++];
            if(result instanceof Error)throw result;
            return result;
          }
          const devices=options.devices || [{id:1,device_name:'Synthetic',source:'reconeyez',external_device_id:'SYNTHETIC-1',source_metadata:{}}];
          return {data:devices.find(device=>filters.every(([column,value])=>device[column]===value)) || null,error:null};
        }
        if(table==='camera_integration_events'){
          if(options.insertError instanceof Error)throw options.insertError;
          if(options.insertError)return {data:null,error:{message:'synthetic insert failure'}};
          const id=options.eventId ?? ++eventId;
          operations.findLast(operation=>operation.table===table&&operation.insert).eventId=id;
          return {data:options.noEventId?null:{id},error:null};
        }
        throw Error(`Unexpected table ${table}`);
      },then(resolve){return Promise.resolve({data:null,error:null}).then(resolve)}};
    return b;
  }};
  let handler;
  const ctx=vm.createContext({crypto,TextEncoder,Uint8Array,Response,Request,URL,AbortSignal,AbortController,Date:ClockDate,performance:{now:()=>clock},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);},console:{error(){}},
    createClient:()=>{
      if(operations.some(operation=>operation.table==='camera_integration_events'&&operation.eventId)){
        if(options.metadataClientError)throw new Error('private metadata client initialization');
        if(options.metadataClientMilliseconds)runTimers(options.metadataClientMilliseconds);
      }
      return db;
    },archiveReconPayload:async(_db,b)=>({...structuredClone(b),cos_private_archive:{archivedAt:'synthetic-archive-time'}}),
    Deno:{env:{get:()=> 'synthetic-environment'},serve(fn){handler=fn}}});
  vm.runInContext(js+'\nglobalThis.helpers={parseObservedAt,reconEventKey,withOrderingKey,healthFromEvent};',ctx);
  return {operations,handler,helpers:ctx.helpers,runTimers,metadataReplies};
}
const body={event_type:'RP',event_guid:'synthetic-event',date_time:'2026-10-12T14:07:12Z',device_info:{guid:'SYNTHETIC-1',battery_percentage:80}};
const request=value=>new Request('https://synthetic.invalid/webhook',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer synthetic-test-secret'},body:JSON.stringify(value)});
const audits=x=>x.operations.filter(operation=>operation.table==='camera_integration_events'&&operation.insert).map(operation=>operation.insert);
const projections=x=>x.operations.filter(operation=>operation.rpc==='cos_apply_recon_event_v1');
const metadataCalls=x=>x.operations.filter(operation=>operation.rpc==='recon_record_webhook_receipt_v2'||operation.rpc==='recon_finish_receiver_ack_v2');
const receiverBody=(overrides={})=>({eventType:'IntegrationTest',deviceGuid:'__camera_health_receiver_test__',timestamp:'2026-10-14T15:00:00Z',source:'Camera Health self-test',cos_receiver_test_v2:{schema_version:2,attempt_id:receiverAttempt},...overrides});
const assertNoDirectHealthWrites=x=>assert.ok(!x.operations.some(operation=>['camera_devices','camera_health_current','camera_health_history'].includes(operation.table)&&operation.update));
async function assertNonDetectorEvent(original,{devices,eventType,eventCode}={}){
  const x=setup({devices}),response=await x.handler(request(original));
  assert.equal(response.status,202);
  const responseBody=await response.json();
  assert.equal(responseBody.health_changed,false);
  const [audit]=audits(x);
  assert.equal(audits(x).length,1);
  assert.equal(audit.event_type,eventType ?? original.event_type ?? null);
  assert.equal(audit.event_code,eventCode ?? original.event_code ?? null);
  assert.equal(audit.observed_at,'2026-10-12T14:07:12.000Z');
  assert.equal(audit.processed,false);
  assert.equal(responseBody.matched,Boolean(audit.camera_device_id));
  if(!devices&&audit.external_device_id==='SYNTHETIC-1')assert.equal(audit.camera_device_id,1);
  const retained=JSON.parse(JSON.stringify(audit.payload));
  delete retained.cos_private_archive;delete retained.cos_event_order_v1;
  assert.deepEqual(retained,JSON.parse(JSON.stringify(original)));
  assert.equal(audit.payload.cos_event_order_v1.key,await x.helpers.reconEventKey(JSON.parse(JSON.stringify(original))));
  assert.equal(projections(x).length,0);
  assertNoDirectHealthWrites(x);
  for(const lookup of x.operations.filter(operation=>operation.lookup)){
    assert.deepEqual(lookup.filters,[['source','reconeyez'],['external_device_id',audit.external_device_id]]);
  }
  return x;
}
let count=0,failed=0;
async function test(name,fn){
  try{await fn();count++;console.log('PASS '+name)}
  catch(error){failed++;console.error('FAIL '+name+': '+error.message)}
}
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
await test('unauthorized payload is rejected before lookup, audit or health processing',async()=>{
  const x=setup(),r=request(body);r.headers.set('authorization','Bearer invalid-synthetic-token');
  assert.equal((await x.handler(r)).status,401);
  assert.ok(!x.operations.some(operation=>operation.table));
  assert.equal(projections(x).length,0);
});
await test('returned database lookup errors retain original event and return retryable failure without health projection',async()=>{
  // Even an unusable response with both data and error must not trust the apparent match.
  const x=setup({lookups:[{data:{id:1},error:{message:'synthetic lookup failure'}}]});
  const r=await x.handler(request(body));
  assert.equal(r.status,503);
  const [audit]=audits(x);
  assert.equal(audit.camera_device_id,null);
  assert.equal(audit.external_device_id,'SYNTHETIC-1');
  assert.equal(audit.observed_at,'2026-10-12T14:07:12.000Z');
  assert.equal(audit.payload.cos_event_order_v1.key,'guid:synthetic-event');
  assert.equal(audit.payload.event_guid,body.event_guid);
  assert.equal(audit.payload.date_time,body.date_time);
  assert.equal(audit.processed,false);
  assert.match(audit.processing_note,/lookup.*fail|fail.*lookup/i);
  assert.doesNotMatch(audit.processing_note,/not mapped/i);
  assert.equal(projections(x).length,0);
  assertNoDirectHealthWrites(x);
});
await test('thrown database lookup failures are retained and retryable without projection',async()=>{
  const x=setup({lookups:[new Error('synthetic transport failure')]});
  assert.equal((await x.handler(request(body))).status,503);
  const [audit]=audits(x);
  assert.equal(audit.camera_device_id,null);
  assert.equal(audit.observed_at,'2026-10-12T14:07:12.000Z');
  assert.equal(audit.payload.cos_event_order_v1.key,'guid:synthetic-event');
  assert.match(audit.processing_note,/lookup.*fail|fail.*lookup/i);
  assert.equal(projections(x).length,0);
  assertNoDirectHealthWrites(x);
});
await test('lookup recovery retries original GUID and hash keys through SQL once, then preserves duplicate outcome',async()=>{
  for(const original of [body,{...body,event_guid:undefined}]){
    const x=setup({lookups:[{data:null,error:{message:'synthetic lookup failure'}},{data:{id:1},error:null},{data:{id:1},error:null}],projections:[
      {applied:true,outcome:'applied',status:'online',health_changed:true},
      {applied:false,outcome:'duplicate',status:'online',health_changed:false}
    ]});
    assert.equal((await x.handler(request(original))).status,503);
    assert.equal(projections(x).length,0);
    const retry=await x.handler(request(original));
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).health_changed,true);
    assert.equal(projections(x).length,1);
    const repeated=await x.handler(request(original));
    assert.equal(repeated.status,200);
    const repeatedBody=await repeated.json();
    assert.equal(repeatedBody.outcome,'duplicate');
    assert.equal(repeatedBody.applied,false);
    assert.equal(repeatedBody.health_changed,false);
    const records=audits(x),calls=projections(x),key=await x.helpers.reconEventKey(JSON.parse(JSON.stringify(original)));
    assert.equal(records.length,3);
    assert.equal(calls.length,2);
    assert.equal(records[0].camera_device_id,null);
    assert.deepEqual(records.map(record=>record.observed_at),Array(3).fill('2026-10-12T14:07:12.000Z'));
    assert.deepEqual(records.map(record=>record.payload.cos_event_order_v1.key),Array(3).fill(key));
    assert.deepEqual(calls.map(call=>call.args.p_event_key),[key,key]);
    assert.deepEqual(calls.map(call=>call.args.p_event_id),[100,101]);
    for(const record of records){
      const retained=JSON.parse(JSON.stringify(record.payload));
      delete retained.cos_private_archive;delete retained.cos_event_order_v1;
      assert.deepEqual(retained,JSON.parse(JSON.stringify(original)));
    }
    assertNoDirectHealthWrites(x);
  }
});
await test('ordered SQL no-change outcomes and original timestamps pass through unchanged',async()=>{
  for(const [outcome,time] of [['older','2026-10-12T14:06:22Z'],['equal_time','2026-10-12T14:07:12Z'],['unverified_timestamp','2027-01-01T00:00:00Z']]){
    const original={...body,date_time:time},x=setup({projections:[{applied:false,outcome,status:'offline',health_changed:false}]});
    const r=await x.handler(request(original));assert.equal(r.status,200);
    const response=await r.json();
    assert.equal(response.outcome,outcome);assert.equal(response.applied,false);assert.equal(response.health_changed,false);
    assert.equal(audits(x)[0].observed_at,new Date(time).toISOString());
    assert.equal(projections(x).length,1);
    assert.equal(projections(x)[0].args.p_event_key,'guid:synthetic-event');
    assertNoDirectHealthWrites(x);
  }
});
await test('nested event type or name exposes ConnectionLost without object stringification',async()=>{
  for(const event of [{type:'ConnectionLost',code:'YC'},{name:'ConnectionLost'},{type:{invalid:'ConnectionLost'},name:'ConnectionLost'}]){
    const original={...body,event_type:undefined,event},x=setup();
    assert.equal((await x.handler(request(original))).status,200);
    assert.equal(audits(x)[0].event_type,'ConnectionLost');
    assert.equal(audits(x)[0].event_code,event.code || null);
    assert.equal(audits(x)[0].observed_at,'2026-10-12T14:07:12.000Z');
    assert.equal(projections(x).length,1);
    assert.equal(x.helpers.healthFromEvent(audits(x)[0].event_type).health,'offline');
  }
});
await test('nested scalar YC code works without an event name',async()=>{
  const original={...body,event_type:undefined,event:{code:'YC'}},x=setup();
  assert.equal((await x.handler(request(original))).status,200);
  assert.equal(audits(x)[0].event_type,null);
  assert.equal(audits(x)[0].event_code,'YC');
  assert.equal(projections(x).length,1);
  assert.equal(x.helpers.healthFromEvent(audits(x)[0].event_code).health,'offline');
});
await test('scalar event names and scalar codes preserve ordered projection',async()=>{
  for(const fields of [{event:'ConnectionLost'},{event:'YC'},{code:'YC'}]){
    const original={...body,event_type:undefined,...fields},x=setup();
    assert.equal((await x.handler(request(original))).status,200);
    assert.equal(audits(x)[0].event_type,fields.event || null);
    assert.equal(audits(x)[0].event_code,fields.code || null);
    assert.equal(projections(x).length,1);
    assert.equal(x.helpers.healthFromEvent(audits(x)[0].event_type || audits(x)[0].event_code).health,'offline');
  }
});
await test('recognized scalar name keeps precedence over a contradictory code',async()=>{
  for(const original of [
    {...body,event_type:'RP',event_code:'YC'},
    {...body,event_type:undefined,event:'RoutineCheck',code:'YC'},
    {...body,event_type:undefined,event:{type:'RoutineCheck',code:'YC'}}
  ]){
    const x=setup();assert.equal((await x.handler(request(original))).status,200);
    const [audit]=audits(x);
    assert.equal(audit.event_type,original.event_type || original.event?.type || original.event);
    assert.equal(audit.event_code,'YC');
    assert.equal(x.helpers.healthFromEvent(audit.event_type).health,'online');
    assert.equal(projections(x).length,1);
  }
});
await test('unknown scalar name falls back to recognized code for SQL while raw payload and key stay original',async()=>{
  for(const event of ['UnknownProviderEvent',{type:'UnknownProviderEvent',code:'YC'}]){
    const original={...body,event_type:undefined,event_guid:undefined,event,code:typeof event==='string'?'YC':undefined},x=setup();
    assert.equal((await x.handler(request(original))).status,200);
    const [audit]=audits(x);
    assert.equal(audit.event_type,'YC');
    assert.equal(audit.event_code,'YC');
    assert.deepEqual(JSON.parse(JSON.stringify(audit.payload.event)),event);
    const key=await x.helpers.reconEventKey(JSON.parse(JSON.stringify(original)));
    assert.equal(audit.payload.cos_event_order_v1.key,key);
    assert.equal(projections(x)[0].args.p_event_key,key);
    assert.equal(x.helpers.healthFromEvent(audit.event_type).health,'offline');
  }
});
await test('explicit aliases precede nested names and nested names precede generic scalar names',async()=>{
  for(const [fields,expected] of [
    [{event_type:'RP',event:{type:'ConnectionLost'}},'RP'],
    [{eventName:'RoutineCheck',event:{type:'ConnectionLost'}},'RoutineCheck'],
    [{event:{type:'ConnectionLost'},type:'RoutineCheck'},'ConnectionLost'],
    [{event:{name:'ConnectionLost'},name:'RoutineCheck'},'ConnectionLost']
  ]){
    const x=setup();assert.equal((await x.handler(request({...body,event_type:undefined,...fields}))).status,200);
    assert.equal(audits(x)[0].event_type,expected);
    assert.equal(projections(x).length,1);
  }
});
await test('IntegrationTest remains receiver evidence only even with a health-looking code',async()=>{
  const x=setup();assert.equal((await x.handler(request({...body,event_type:'IntegrationTest',event_code:'YC'}))).status,202);
  assert.equal(audits(x)[0].event_type,'IntegrationTest');
  assert.equal(projections(x).length,0);
  assert.equal(audits(x)[0].recon_receipt_kind,'receiver_test');
  assert.equal(audits(x)[0].recon_receiver_attempt_id,null);
  assert.equal(metadataCalls(x).length,0,'uncorrelated test cannot claim receiver readiness');
  assertNoDirectHealthWrites(x);
});
await test('objects and arrays in event-name or code fields do not fabricate health events',async()=>{
  for(const event of [{unrecognized:'ConnectionLost'},['ConnectionLost'],{type:['ConnectionLost'],name:{value:'ConnectionLost'},code:['YC']}]){
    const x=setup();
    assert.equal((await x.handler(request({...body,event_type:undefined,event}))).status,202);
    assert.equal(audits(x)[0].event_type,null);
    assert.equal(audits(x)[0].event_code,null);
    assert.equal(projections(x).length,0);
    assertNoDirectHealthWrites(x);
  }
});
await test('genuinely unmapped detector is retained with 202 rather than lookup failure',async()=>{
  const x=setup({devices:[]}),r=await x.handler(request(body));
  assert.equal(r.status,202);
  assert.equal((await r.json()).matched,false);
  const [audit]=audits(x);
  assert.equal(audit.camera_device_id,null);
  assert.match(audit.processing_note,/not mapped/i);
  assert.equal(audit.payload.cos_event_order_v1.key,'guid:synthetic-event');
  assert.equal(projections(x).length,0);
  assertNoDirectHealthWrites(x);
});
await test('detector lookup remains exact by source and external GUID',async()=>{
  const x=setup();await x.handler(request(body));
  const [lookup]=x.operations.filter(operation=>operation.lookup);
  assert.deepEqual(lookup.filters,[['source','reconeyez'],['external_device_id','SYNTHETIC-1']]);
  for(const devices of [
    [{id:1,source:'other-provider',external_device_id:'SYNTHETIC-1'}],
    [{id:1,source:'reconeyez',external_device_id:'synthetic-1'}],
    [{id:1,source:'reconeyez',external_device_id:'SYNTHETIC-1-suffix'}]
  ]){
    const unmatched=setup({devices});
    assert.equal((await unmatched.handler(request(body))).status,202);
    assert.equal(audits(unmatched)[0].camera_device_id,null);
    assert.equal(projections(unmatched).length,0);
  }
});
await test('bridge GUID never falls back to an associated detector',async()=>{
  const x=setup({devices:[{id:1,source:'reconeyez',external_device_id:'SYNTHETIC-1',device_name:'SYNTHETIC-BRIDGE',source_metadata:{bridge_guid:'SYNTHETIC-BRIDGE'}}]});
  const original={...body,event_type:'ConnectionLost',device_info:{guid:'SYNTHETIC-BRIDGE'}};
  assert.equal((await x.handler(request(original))).status,202);
  assert.equal(audits(x)[0].external_device_id,'SYNTHETIC-BRIDGE');
  assert.equal(audits(x)[0].camera_device_id,null);
  assert.equal(projections(x).length,0);
  assertNoDirectHealthWrites(x);
});
await test('bridge-only identifiers and bridge activity do not infer detector health',async()=>{
  const bridgeOnly=setup();
  assert.equal((await bridgeOnly.handler(request({...body,device_info:undefined,bridge_info:{guid:'SYNTHETIC-1'}}))).status,202);
  assert.equal(audits(bridgeOnly)[0].external_device_id,null);
  assert.ok(!bridgeOnly.operations.some(operation=>operation.lookup));
  assert.equal(projections(bridgeOnly).length,0);
  for(const event_type of ['BridgeConnected','BridgeDisconnected','BridgeActivity']){
    const x=setup();assert.equal((await x.handler(request({...body,event_type}))).status,202);
    assert.equal(projections(x).length,0);
    assertNoDirectHealthWrites(x);
  }
});
await test('explicit bridge types never project detector health even when GUID matches a camera row',async()=>{
  for(const type of ['bridge_4g','bridge_lte','bridge_wifi']){
    const x=setup(),original={...body,event_type:'ConnectionLost',device_info:{guid:'SYNTHETIC-1',type}};
    const r=await x.handler(request(original));assert.equal(r.status,202);
    assert.equal(audits(x)[0].payload.device_info.type,type);
    assert.equal(projections(x).length,0);
    assertNoDirectHealthWrites(x);
  }
});
await test('siren_v1 RP does not project detector health through a stale exact camera mapping',async()=>{
  await assertNonDetectorEvent({...body,device_info:{...body.device_info,type:'siren_v1'}});
});
await test('siren_v1 ConnectionLost with YC does not project detector health through a stale exact camera mapping',async()=>{
  await assertNonDetectorEvent({...body,event_type:'ConnectionLost',event_code:'YC',device_info:{...body.device_info,type:'siren_v1'}});
});
await test('nested siren_v1 event remains non-detector before recognized-code fallback',async()=>{
  await assertNonDetectorEvent({...body,event_type:undefined,event_guid:undefined,event:{type:'UnknownProviderEvent',code:'YC'},device_info:{...body.device_info,type:'siren_v1'}},{eventType:'UnknownProviderEvent',eventCode:'YC'});
});
await test('siren device alias cannot be hidden by a detector device type alias',async()=>{
  await assertNonDetectorEvent({...body,device_info:{...body.device_info,type:'detector_v2'},deviceType:'siren_v1'});
});
await test('nested data siren type cannot project a nested ConnectionLost detector event',async()=>{
  await assertNonDetectorEvent({...body,event_type:undefined,event:{name:'ConnectionLost',code:'YC'},data:{device_info:{type:'siren_v1'}}},{eventType:'ConnectionLost',eventCode:'YC'});
});
for(const eventType of ['BridgeConnected','BridgeDisconnected','BridgeActivity']){
  await test(`${eventType} plus RP without device type stays non-detector through stale camera mapping`,async()=>{
    await assertNonDetectorEvent({...body,event_type:eventType,event_code:'RP'});
  });
  await test(`nested ${eventType} plus RP without device type keeps original event semantics`,async()=>{
    await assertNonDetectorEvent({...body,event_type:undefined,event_guid:undefined,event:{type:eventType,code:'RP'}},{eventType,eventCode:'RP'});
  });
  await test(`unmapped ${eventType} plus RP retains no-health event and original identity`,async()=>{
    const x=await assertNonDetectorEvent({...body,event_type:eventType,event_code:'RP',device_info:{guid:'UNMAPPED-BRIDGE'}},{devices:[]});
    assert.equal(audits(x)[0].external_device_id,'UNMAPPED-BRIDGE');
    assert.equal(audits(x)[0].camera_device_id,null);
  });
}
for(const [alias,fields,expectedType,expectedCode] of [
  ['eventType',{eventType:'BridgeConnected',event_code:'RP'},'BridgeConnected','RP'],
  ['event_name',{event_name:'BridgeDisconnected',code:'RP'},'BridgeDisconnected','RP'],
  ['eventName',{eventName:'BridgeActivity',sia_code:'RP'},'BridgeActivity','RP'],
  ['nested name',{event:{name:'BridgeConnected',code:'RP'}},'BridgeConnected','RP'],
  ['scalar event',{event:'BridgeDisconnected',eventCode:'RP'},'BridgeDisconnected','RP'],
  ['generic type',{type:'BridgeActivity',siaCode:'RP'},'BridgeActivity','RP'],
  ['generic name',{name:'BridgeConnected',event_code:'YC'},'BridgeConnected','YC'],
  ['nested data event type',{data:{event_type:'BridgeDisconnected',code:'RP'}},'BridgeDisconnected','RP']
]){
  await test(`known bridge ${alias} semantics prevent recognized-code fallback`,async()=>{
    await assertNonDetectorEvent({...body,event_type:undefined,...fields},{eventType:expectedType,eventCode:expectedCode});
  });
}
await test('explicit bridge event alias cannot be hidden by a recognized detector event alias',async()=>{
  await assertNonDetectorEvent({...body,eventType:'BridgeConnected',event_code:'RP'});
});
await test('nested bridge event cannot be hidden by a recognized scalar detector event',async()=>{
  await assertNonDetectorEvent({...body,event:{type:'BridgeDisconnected',code:'RP'}},{eventCode:'RP'});
});
await test('nested bridge event name cannot be hidden by a recognized nested detector event type',async()=>{
  await assertNonDetectorEvent({...body,event_type:undefined,event:{type:'RoutineCheck',name:'BridgeActivity',code:'RP'}},{eventType:'RoutineCheck',eventCode:'RP'});
});
await test('bridge semantics in a nested event-code alias cannot be hidden by detector RP',async()=>{
  await assertNonDetectorEvent({...body,event:{code:'BridgeActivity'}},{eventCode:'BridgeActivity'});
});
await test('bridge semantics in a secondary event-code alias cannot be hidden by primary RP',async()=>{
  await assertNonDetectorEvent({...body,event_code:'RP',code:'BridgeDisconnected'});
});
await test('IntegrationTest in a secondary event-name alias remains receiver-only before fallback',async()=>{
  await assertNonDetectorEvent({...body,event:{type:'IntegrationTest',code:'YC'}},{eventCode:'YC'});
});
await test('IntegrationTest event code remains receiver-only when unknown name could fall back',async()=>{
  await assertNonDetectorEvent({...body,event_type:'UnknownProviderEvent',event_code:'RP',event:{code:'IntegrationTest'}});
});
await test('bridge type alias cannot be hidden by a detector type alias',async()=>{
  await assertNonDetectorEvent({...body,device_info:{...body.device_info,type:'detector_v2'},device_type:'bridge_4g'});
});
await test('genuine unmapped siren remains retained no-health evidence',async()=>{
  const x=await assertNonDetectorEvent({...body,event_type:'ConnectionLost',event_code:'YC',device_info:{guid:'UNMAPPED-SIREN',type:'siren_v1'}},{devices:[]});
  assert.equal(audits(x)[0].external_device_id,'UNMAPPED-SIREN');
  assert.equal(audits(x)[0].camera_device_id,null);
});
await test('bridge-only fields never supply a detector binding even with detector-looking event code',async()=>{
  const x=await assertNonDetectorEvent({...body,event_type:'BridgeActivity',event_code:'RP',device_info:undefined,bridge_info:{guid:'SYNTHETIC-1'},bridge_guid:'SYNTHETIC-1'});
  assert.equal(audits(x)[0].external_device_id,null);
  assert.equal(audits(x)[0].camera_device_id,null);
  assert.ok(!x.operations.some(operation=>operation.lookup));
});
await test('repeat bridge payloads retain the same original key and time without ordered detector projection',async()=>{
  const original={...body,event_type:'BridgeDisconnected',event_code:'RP',event_guid:undefined},x=setup();
  for(let attempt=0;attempt<2;attempt++){
    const r=await x.handler(request(original));
    assert.equal(r.status,202);
    assert.equal((await r.json()).health_changed,false);
  }
  const records=audits(x),key=await x.helpers.reconEventKey(JSON.parse(JSON.stringify(original)));
  assert.equal(records.length,2);
  assert.deepEqual(records.map(record=>record.event_type),['BridgeDisconnected','BridgeDisconnected']);
  assert.deepEqual(records.map(record=>record.payload.cos_event_order_v1.key),[key,key]);
  assert.deepEqual(records.map(record=>record.observed_at),Array(2).fill('2026-10-12T14:07:12.000Z'));
  assert.equal(projections(x).length,0);
  assertNoDirectHealthWrites(x);
});
await test('explicit detector type keeps valid scalar RP and nested ConnectionLost events eligible for ordered projection',async()=>{
  for(const [fields,expectedType,expectedCode] of [
    [{event_type:'RP'},'RP',null],
    [{event_type:undefined,event:{type:'ConnectionLost',code:'YC'}},'ConnectionLost','YC'],
    [{event_type:'UnknownProviderEvent',event_code:'YC'},'YC','YC']
  ]){
    const original={...body,...fields,device_info:{...body.device_info,type:'detector_v2'}},x=setup();
    const response=await x.handler(request(original));
    assert.equal(response.status,200);
    assert.equal((await response.json()).health_changed,true);
    assert.equal(audits(x)[0].event_type,expectedType);
    assert.equal(audits(x)[0].event_code,expectedCode);
    assert.equal(projections(x).length,1);
    assert.equal(projections(x)[0].args.p_event_key,'guid:synthetic-event');
    assert.equal(audits(x)[0].observed_at,'2026-10-12T14:07:12.000Z');
    assertNoDirectHealthWrites(x);
  }
});
// These adapter fixtures exercise the actual consumer source against the shared
// closed v2 wire contract. SQL semantics/locks and HTTP transport remain mocked.
await test('ordinary delivery commits trusted typed receipt fields before metadata and health',async()=>{
  const x=setup();assert.equal((await x.handler(request(body))).status,200);
  const [audit]=audits(x);
  assert.equal(audit.recon_receipt_started_at,entryTime);
  assert.equal(audit.recon_receipt_kind,'ordinary');
  assert.equal(audit.recon_receiver_attempt_id,null);
  assert.ok(!Object.hasOwn(audit,'received_at'),'existing database receipt time must not be overwritten');
  assert.equal(audit.observed_at,'2026-10-12T14:07:12.000Z');
  const auditIndex=x.operations.findIndex(operation=>operation.insert),metadataIndex=x.operations.findIndex(operation=>operation.rpc==='recon_record_webhook_receipt_v2'),healthIndex=x.operations.findIndex(operation=>operation.rpc==='cos_apply_recon_event_v1');
  assert.ok(auditIndex<metadataIndex&&metadataIndex<healthIndex);
  assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_event_id:99}]);
});
await test('entry time is captured once before auth and is never replaced by provider/completion time',async()=>{
  const x=setup({authMilliseconds:1000,metadata:[({args,audit})=>{x.runTimers(1200);return {data:receiptResult(args.p_event_id,audit.recon_receipt_started_at),error:null};}]});
  assert.equal((await x.handler(request({...body,date_time:'2020-01-01T00:00:00Z'}))).status,200);
  assert.equal(audits(x)[0].recon_receipt_started_at,entryTime);
  assert.equal(audits(x)[0].observed_at,'2020-01-01T00:00:00.000Z');
  assert.deepEqual(metadataCalls(x)[0].args,{p_event_id:99});
});
await test('forged receipt evidence in provider payload does not replace service-owned audit fields or key',async()=>{
  const original={...body,recon_receipt_started_at:'2001-01-01T00:00:00Z',recon_receipt_kind:'receiver_test',recon_receiver_attempt_id:receiverAttempt};
  const x=setup();assert.equal((await x.handler(request(original))).status,200);
  const [audit]=audits(x);
  assert.equal(audit.recon_receipt_started_at,entryTime);assert.equal(audit.recon_receipt_kind,'ordinary');assert.equal(audit.recon_receiver_attempt_id,null);
  assert.equal(audit.payload.recon_receipt_started_at,original.recon_receipt_started_at);
  assert.equal(audit.payload.cos_event_order_v1.key,await x.helpers.reconEventKey(original));
});
await test('metadata succeeds for genuine unmapped and lookup failures only after audit; lookup error remains retryable',async()=>{
  for(const lookup of [{data:null,error:null},{data:null,error:{message:'synthetic database private text'}}]){
    const x=setup({lookups:[lookup]}),r=await x.handler(request(body)),response=await r.json();
    assert.equal(r.status,lookup.error?503:202);assert.equal(response.event_id,99);
    assert.equal(metadataCalls(x).length,1);assert.equal(projections(x).length,0);
    assert.ok(x.operations.findIndex(operation=>operation.insert)<x.operations.findIndex(operation=>operation.rpc==='recon_record_webhook_receipt_v2'));
    assert.doesNotMatch(JSON.stringify(response),/synthetic database private text/);
  }
});
await test('audit errors or unknown insert acknowledgement prohibit both metadata and health',async()=>{
  for(const options of [{insertError:true},{insertError:new Error('private insert error')},{noEventId:true},{eventId:9007199254740992},{eventId:'99'},{eventId:0}]){
    const x=setup(options),r=await x.handler(request(body));assert.equal(r.status,503);
    assert.equal(metadataCalls(x).length,0);assert.equal(projections(x).length,0);
    assert.doesNotMatch(await r.text(),/private insert error/);
  }
});
for(const outcome of ['applied','duplicate','superseded']){
  await test(`closed ordinary metadata ${outcome} acknowledgement permits detector projection`,async()=>{
    const x=setup({metadata:[{data:receiptResult(99,entryTime,outcome),error:null}]}),r=await x.handler(request(body));
    assert.equal(r.status,200);assert.equal((await r.json()).outcome,'applied');assert.equal(projections(x).length,1);
  });
}
await test('typed receipt UTC serialization preserves exact identity without lossy timestamp rounding',async()=>{
  for(const time of ['2026-10-14T15:00:00+00:00','2026-10-14T15:00:00.000000Z']){
    const x=setup({metadata:[{data:receiptResult(99,time),error:null}]});assert.equal((await x.handler(request(body))).status,200);
  }
  const x=setup({metadataDefault:{data:receiptResult(99,'2026-10-14T15:00:00.000001Z'),error:null}});
  assert.equal((await x.handler(request(body))).status,503);assert.equal(projections(x).length,1);
});
const invalidReceipts=[
  ['null',null],['array',[receiptResult()]],['extra key',{...receiptResult(),extra:true}],['missing field',(({applied,...rest})=>rest)(receiptResult())],
  ['wrong schema',{...receiptResult(),schema_version:1}],['unknown outcome',{...receiptResult(),outcome:'unknown'}],['applied inconsistency',{...receiptResult(),applied:false}],
  ['duplicate inconsistency',receiptResult(99,entryTime,'duplicate') && {...receiptResult(99,entryTime,'duplicate'),applied:true}],
  ['wrong event identity',{...receiptResult(),event_id:100}],['string ID',{...receiptResult(),event_id:'99'}],['unsafe ID',{...receiptResult(),event_id:9007199254740992}],
  ['zero ID',{...receiptResult(),event_id:0}],['wrong entry identity',{...receiptResult(),receipt_started_at:'2026-10-14T15:00:01.000Z'}],
  ['invalid UTC time',{...receiptResult(),receipt_started_at:'2026-10-14T15:00:00-05:00'}],['invalid finite time',{...receiptResult(),receipt_started_at:'2026-02-31T15:00:00Z'}]
];
for(const [label,data] of invalidReceipts){
  await test(`malformed ordinary ${label} response is retained-event failure despite applied health`,async()=>{
    const x=setup({metadataDefault:{data,error:null}}),r=await x.handler(request(body)),response=await r.json();
    assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.outcome,'applied');assert.equal(response.applied,true);assert.equal(response.health_changed,true);
    assert.equal(metadataCalls(x).length,2);assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_event_id:99},{p_event_id:99}]);assert.equal(projections(x).length,1);
  });
}
for(const [label,reply,code,calls] of [
  ['PT409',{data:null,error:{code:'PT409',message:'private database conflict'}},'PT409',1],
  ['40001',{data:null,error:{code:'40001',message:'private serialization error'}},'40001',2],
  ['returned missing integration',{data:null,error:{code:'P0002',message:'private row error'}},null,2],
  ['throw',new Error('private transport error'),null,2],
  ['data and error',{data:receiptResult(),error:{code:'40001',message:'private serialization error'}},'40001',2]
]){
  await test(`metadata ${label} cannot become successful no-op or suppress eligible health`,async()=>{
    const x=setup({metadataDefault:reply}),r=await x.handler(request(body)),response=await r.json();
    assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.outcome,'applied');assert.equal(response.health_changed,true);
    assert.equal(metadataCalls(x).length,calls);assert.equal(projections(x).length,1);
    if(code)assert.equal(response.metadata_error_code,code);
    assert.doesNotMatch(JSON.stringify(response),/private .*error|private .*conflict/);
  });
}
await test('same-ID metadata recovery after transport/malformed/40001 does not mint a new receipt',async()=>{
  for(const initial of [new Error('synthetic lost response'),{data:null,error:null},{data:null,error:{code:'40001'}}]){
    const x=setup({metadata:[initial,{data:receiptResult(),error:null}]}),r=await x.handler(request(body));
    assert.equal(r.status,200);assert.equal(metadataCalls(x).length,2);assert.equal(audits(x).length,1);assert.equal(projections(x).length,1);
    assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_event_id:99},{p_event_id:99}]);assert.equal(audits(x)[0].recon_receipt_started_at,entryTime);
  }
});
await test('metadata failure followed by provider redelivery repairs metadata even when health is duplicate',async()=>{
  const x=setup({metadata:[{data:null,error:{code:'PT409'}},({args,audit})=>({data:receiptResult(args.p_event_id,audit.recon_receipt_started_at),error:null})],projections:[{applied:true,outcome:'applied',status:'online',health_changed:true},{applied:false,outcome:'duplicate',status:'online',health_changed:false}]});
  const initial=await x.handler(request(body)),first=await initial.json();assert.equal(initial.status,503);assert.equal(first.event_id,99);assert.equal(first.health_changed,true);
  x.runTimers(1000);
  // The retry has a new audit identity and entry time, while preserving the provider key/time.
  const retry=await x.handler(request(body)),second=await retry.json();
  assert.equal(retry.status,200);
  assert.equal(second.event_id,100);assert.equal(second.outcome,'duplicate');assert.equal(second.health_changed,false);
  assert.deepEqual(audits(x).map(audit=>audit.payload.cos_event_order_v1.key),['guid:synthetic-event','guid:synthetic-event']);
  assert.deepEqual(audits(x).map(audit=>audit.observed_at),Array(2).fill('2026-10-12T14:07:12.000Z'));
  assert.equal(metadataCalls(x).length,2);assert.equal(projections(x).length,2);
});
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(predicate(),'synthetic handler did not reach expected boundary');}
function beginDelivery(x,original=body){const pending=x.handler(request(original));pending.catch(()=>{});return pending;}
await test('uncertain metadata timeout spends at most one total five-second budget then health still applies',async()=>{
  const x=setup({metadata:['pending']}),pending=beginDelivery(x);
  await until(()=>metadataCalls(x).length===1);
  x.runTimers(4999);await new Promise(resolve=>setImmediate(resolve));assert.equal(projections(x).length,0);
  x.runTimers(1);const r=await pending,response=await r.json();
  assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.metadata_outcome,'uncertain');assert.equal(response.outcome,'applied');assert.equal(response.health_changed,true);
  assert.equal(metadataCalls(x).length,1);assert.equal(projections(x).length,1);
});
await test('metadata retry shares original five-second budget and uses exact IDs',async()=>{
  const x=setup({metadata:[()=>{x.runTimers(3000);return {data:null,error:{code:'40001'}};},'pending']}),pending=beginDelivery(x);
  await until(()=>metadataCalls(x).length===2);
  x.runTimers(1999);await new Promise(resolve=>setImmediate(resolve));assert.equal(projections(x).length,0);
  x.runTimers(1);const r=await pending,response=await r.json();
  assert.equal(r.status,503);assert.equal(response.metadata_outcome,'uncertain');assert.equal(response.health_changed,true);
  assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_event_id:99},{p_event_id:99}]);assert.equal(audits(x)[0].recon_receipt_started_at,entryTime);
});
await test('timeout plus duplicate health remains truthful and late metadata completion cannot change response or reproject',async()=>{
  let resolveMetadata;
  const x=setup({metadata:[()=>new Promise(resolve=>{resolveMetadata=resolve;})],projections:[{applied:false,outcome:'duplicate',status:'online',health_changed:false}]}),pending=beginDelivery(x);
  await until(()=>Boolean(resolveMetadata));x.runTimers(5000);
  const r=await pending,response=await r.json();assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.outcome,'duplicate');assert.equal(response.health_changed,false);
  resolveMetadata({data:receiptResult(),error:null});await new Promise(resolve=>setImmediate(resolve));assert.equal(projections(x).length,1);assert.equal(audits(x).length,1);
});
await test('metadata and health failure response retains event identity without fabricating applied outcome',async()=>{
  const x=setup({metadataDefault:{data:null,error:{code:'PT409'}},rpcError:true}),r=await x.handler(request(body)),response=await r.json();
  assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.applied,null);assert.equal(response.health_changed,null);assert.equal(response.outcome,'unknown');assert.equal(projections(x).length,1);
});
await test('canonical correlated receiver test archives exact token then ACKs without detector projection',async()=>{
  const original=receiverBody(),x=setup(),r=await x.handler(request(original));assert.equal(r.status,202);
  const [audit]=audits(x);assert.equal(audit.event_type,'IntegrationTest');assert.equal(audit.recon_receipt_kind,'receiver_test');assert.equal(audit.recon_receiver_attempt_id,receiverAttempt);assert.equal(audit.recon_receipt_started_at,entryTime);
  assert.deepEqual(clone(audit.payload.cos_receiver_test_v2),original.cos_receiver_test_v2);assert.equal(audit.observed_at,'2026-10-14T15:00:00.000Z');assert.equal(audit.payload.cos_event_order_v1.key,await x.helpers.reconEventKey(original));
  assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_attempt_id:receiverAttempt,p_event_id:99}]);assert.equal(projections(x).length,0);
});
await test('receiver token redelivery accepts compact first-success replay without renewing original event or test timestamp',async()=>{
  const first=ackResult(),replay=ackResult(99,{outcome:'duplicate',applied:false,current:false}),x=setup({metadata:[{data:first,error:null},{data:replay,error:null}]}),original=receiverBody();
  assert.equal((await x.handler(request(original))).status,202);x.runTimers(1000);assert.equal((await x.handler(request(original))).status,202);
  assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_attempt_id:receiverAttempt,p_event_id:99},{p_attempt_id:receiverAttempt,p_event_id:100}]);
  assert.equal(x.metadataReplies[1].data.result.ack_event_id,99);assert.equal(x.metadataReplies[1].data.result.receiver_tested_at,entryTime);assert.equal(projections(x).length,0);
  assert.deepEqual(audits(x).map(audit=>audit.payload.cos_event_order_v1.key),Array(2).fill(await x.helpers.reconEventKey(original)));
});
for(const reason_code of ['superseded','configuration_changed']){
  await test(`closed receiver ${reason_code} no-op is acknowledged without fabricated readiness`,async()=>{
    const data=ackResult(99,{outcome:'superseded',applied:false,terminal_outcome:null,current:false,input_fingerprint:null,reason_code,result:null}),x=setup({metadata:[{data,error:null}]});
    assert.equal((await x.handler(request(receiverBody()))).status,202);assert.equal(metadataCalls(x).length,1);assert.equal(projections(x).length,0);
  });
}
const invalidAcks=[
  ['null',null],['array',[ackResult()]],['extra key',{...ackResult(),extra:true}],['missing key',(({reason_code,...rest})=>rest)(ackResult())],
  ['wrong attempt',{...ackResult(),attempt_id:'f583824d-9e16-4789-984b-2764b85bcc0c'}],['uppercase UUID',{...ackResult(),attempt_id:receiverAttempt.toUpperCase()}],
  ['wrong kind',{...ackResult(),kind:'inventory_sync'}],['unsafe ordinal',{...ackResult(),ordinal:9007199254740992}],['string ordinal',{...ackResult(),ordinal:'1'}],['zero ordinal',{...ackResult(),ordinal:0}],
  ['non-UTC observation',{...ackResult(),observed_at:'2026-10-14T15:00:00-05:00'}],['impossible observation',{...ackResult(),observed_at:'2026-02-31T15:00:00Z'}],['excess precision',{...ackResult(),observed_at:'2026-10-14T15:00:00.1234567Z'}],
  ['applied inconsistency',{...ackResult(),applied:false}],['current inconsistency',{...ackResult(),current:false}],['invalid fingerprint',{...ackResult(),input_fingerprint:'A'.repeat(64)}],
  ['success reason',{...ackResult(),reason_code:'receiver_timeout'}],['unknown reason',{...ackResult(),reason_code:'anything'}],['success null result',{...ackResult(),result:null}],
  ['receiver not ready',{...ackResult(),result:{...ackResult().result,receiver_ready:false}}],['result extra key',{...ackResult(),result:{...ackResult().result,extra:true}}],['result unsafe id',{...ackResult(),result:{...ackResult().result,ack_event_id:9007199254740992}}],
  ['result string id',{...ackResult(),result:{...ackResult().result,ack_event_id:'99'}}],['result wrong applied id',{...ackResult(),result:{...ackResult().result,ack_event_id:100}}],['result invalid time',{...ackResult(),result:{...ackResult().result,receiver_tested_at:'not a timestamp'}}],
  ['failure success result',{...ackResult(),terminal_outcome:'failure',reason_code:'receiver_timeout'}],['superseded terminal',{...ackResult(),outcome:'superseded',applied:false,current:false,reason_code:'superseded'}]
];
for(const [label,data] of invalidAcks){
  await test(`malformed receiver ${label} response is retained-event failure without readiness`,async()=>{
    const x=setup({metadataDefault:{data,error:null}}),r=await x.handler(request(receiverBody())),response=await r.json();
    assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.health_changed,false);assert.equal(metadataCalls(x).length,2);assert.equal(projections(x).length,0);
    assert.deepEqual(metadataCalls(x).map(call=>call.args),Array(2).fill({p_attempt_id:receiverAttempt,p_event_id:99}));
  });
}
const invalidReceiverBodies=[
  ['uncorrelated',receiverBody({cos_receiver_test_v2:undefined})],['null token',receiverBody({cos_receiver_test_v2:null})],['array token',receiverBody({cos_receiver_test_v2:[{schema_version:2,attempt_id:receiverAttempt}]})],
  ['token extra',receiverBody({cos_receiver_test_v2:{schema_version:2,attempt_id:receiverAttempt,extra:true}})],['wrong version',receiverBody({cos_receiver_test_v2:{schema_version:1,attempt_id:receiverAttempt}})],['uppercase token',receiverBody({cos_receiver_test_v2:{schema_version:2,attempt_id:receiverAttempt.toUpperCase()}})],
  ['invalid token',receiverBody({cos_receiver_test_v2:{schema_version:2,attempt_id:'invalid'}})],['alias label',receiverBody({eventType:undefined,event_type:'IntegrationTest'})],['alias guid',receiverBody({deviceGuid:undefined,device_guid:'__camera_health_receiver_test__'})],
  ['wrong guid',receiverBody({deviceGuid:'SYNTHETIC-1'})],['wrong source',receiverBody({source:'provider'})],['invalid time',receiverBody({timestamp:'not a timestamp'})],['local time',receiverBody({timestamp:'2026-10-14T15:00:00-05:00'})]
];
for(const [label,original] of invalidReceiverBodies){
  await test(`noncanonical receiver ${label} stays archived receiver-only without ACK or ordinary metadata`,async()=>{
    const x=setup(),r=await x.handler(request(original));assert.equal(r.status,202);
    assert.equal(audits(x)[0].recon_receipt_kind,'receiver_test');assert.equal(audits(x)[0].recon_receiver_attempt_id,null);assert.equal(metadataCalls(x).length,0);assert.equal(projections(x).length,0);
    assert.equal(audits(x)[0].payload.cos_event_order_v1.key,await x.helpers.reconEventKey(clone(original)));
  });
}
await test('bridge/siren conflict in canonical receiver body prevents ACK and health through stale detector mapping',async()=>{
  for(const fields of [{device_info:{type:'siren_v1'}},{event:{name:'BridgeActivity',code:'RP'}},{event_code:'BridgeDisconnected'},{deviceType:'bridge_4g'}]){
    const original=receiverBody(fields),x=setup(),r=await x.handler(request(original));assert.equal(r.status,202);
    assert.equal(audits(x)[0].recon_receiver_attempt_id,null);assert.equal(metadataCalls(x).length,0);assert.equal(projections(x).length,0);
  }
});
await test('receiver alias health exclusion is independent of primary receipt metadata classification',async()=>{
  const x=setup(),original={...body,event:{name:'IntegrationTest',code:'YC'}};assert.equal((await x.handler(request(original))).status,202);
  assert.equal(audits(x)[0].recon_receipt_kind,'ordinary');assert.equal(audits(x)[0].recon_receiver_attempt_id,null);assert.equal(metadataCalls(x)[0].rpc,'recon_record_webhook_receipt_v2');assert.equal(projections(x).length,0);
});
await test('uncorrelated receiver lookup failure retains receiver-only event and does not publish ordinary receipt',async()=>{
  const x=setup({lookups:[{data:null,error:{code:'40001'}}]}),r=await x.handler(request(receiverBody({cos_receiver_test_v2:undefined})));assert.equal(r.status,503);
  assert.equal(audits(x)[0].recon_receipt_kind,'receiver_test');assert.equal(metadataCalls(x).length,0);assert.equal(projections(x).length,0);
});
await test('receiver replay terminal failure is explicit and cannot claim readiness',async()=>{
  const data=ackResult(99,{outcome:'duplicate',applied:false,current:false,terminal_outcome:'failure',reason_code:'receiver_timeout',result:null}),x=setup({metadata:[{data,error:null}]});
  const r=await x.handler(request(receiverBody())),response=await r.json();assert.equal(r.status,202);
  assert.equal(response.metadata_outcome,'duplicate');assert.equal(response.metadata_terminal_outcome,'failure');assert.equal(response.health_changed,false);assert.equal(projections(x).length,0);
});
await test('first receiver ACK uses exact UTC instant across wire spellings and rejects microsecond identity change',async()=>{
  for(const receiver_tested_at of ['2026-10-14T15:00:00+00:00','2026-10-14T15:00:00.000000Z']){
    const data=ackResult(99,{result:{...ackResult().result,receiver_tested_at}}),x=setup({metadata:[{data,error:null}]});assert.equal((await x.handler(request(receiverBody()))).status,202);
  }
  const data=ackResult(99,{result:{...ackResult().result,receiver_tested_at:'2026-10-14T15:00:00.000001Z'}}),x=setup({metadataDefault:{data,error:null}});
  assert.equal((await x.handler(request(receiverBody()))).status,503);assert.equal(projections(x).length,0);
});
for(const [label,reply,code,calls] of [
  ['PT409',{data:null,error:{code:'PT409',message:'private receiver conflict'}},'PT409',1],
  ['40001',{data:null,error:{code:'40001',message:'private receiver serialization'}},'40001',2],
  ['missing integration',{data:null,error:{code:'P0002',message:'private receiver missing'}},null,2],
  ['throw',new Error('private receiver transport'),null,2]
]){
  await test(`receiver ACK ${label} returns retained-event503 without ordinary receipt or readiness`,async()=>{
    const x=setup({metadataDefault:reply}),r=await x.handler(request(receiverBody())),response=await r.json();
    assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.health_changed,false);assert.equal(metadataCalls(x).length,calls);assert.equal(projections(x).length,0);
    assert.ok(metadataCalls(x).every(call=>call.rpc==='recon_finish_receiver_ack_v2'));if(code)assert.equal(response.metadata_error_code,code);
    assert.doesNotMatch(JSON.stringify(response),/private receiver/);
  });
}
await test('receiver ACK uncertain response recovery preserves token and committed audit identity',async()=>{
  for(const initial of [new Error('synthetic response lost'),{data:null,error:null},{data:null,error:{code:'40001'}}]){
    const x=setup({metadata:[initial,{data:ackResult(),error:null}]}),r=await x.handler(request(receiverBody()));assert.equal(r.status,202);
    assert.deepEqual(metadataCalls(x).map(call=>call.args),Array(2).fill({p_attempt_id:receiverAttempt,p_event_id:99}));assert.equal(audits(x).length,1);assert.equal(projections(x).length,0);
  }
});
await test('receiver ACK timeout stays uncertain without readiness, new token or ordinary receipt',async()=>{
  const x=setup({metadata:['pending']}),pending=beginDelivery(x,receiverBody());await until(()=>metadataCalls(x).length===1);x.runTimers(5000);
  const r=await pending,response=await r.json();assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.metadata_outcome,'uncertain');assert.equal(response.health_changed,false);
  assert.deepEqual(metadataCalls(x).map(call=>call.args),[{p_attempt_id:receiverAttempt,p_event_id:99}]);assert.equal(projections(x).length,0);
});
await test('receipt clock at or before1970 fails metadata without clamping provider time or blocking eligible health',async()=>{
  for(const captured of ['1970-01-01T00:00:00.000Z','1969-12-31T23:59:59.000Z']){
    const x=setup({entryTime:captured}),r=await x.handler(request(body)),response=await r.json();assert.equal(r.status,503);
    assert.equal(response.event_id,99);assert.equal(response.metadata_error_code,'invalid_receipt_time');assert.equal(response.outcome,'applied');assert.equal(response.health_changed,true);
    assert.equal(audits(x)[0].recon_receipt_started_at,captured);assert.equal(audits(x)[0].observed_at,'2026-10-12T14:07:12.000Z');assert.equal(metadataCalls(x).length,0);assert.equal(projections(x).length,1);
    const receiver=setup({entryTime:captured}),receiverResponse=await receiver.handler(request(receiverBody({cos_receiver_test_v2:undefined}))),receiverResult=await receiverResponse.json();
    assert.equal(receiverResponse.status,503);assert.equal(receiverResult.event_id,99);assert.equal(receiverResult.metadata_error_code,'invalid_receipt_time');assert.equal(receiverResult.health_changed,false);
    assert.equal(metadataCalls(receiver).length,0);assert.equal(projections(receiver).length,0);
  }
});
await test('metadata client initialization exception retains audit and does not suppress eligible health',async()=>{
  const x=setup({metadataClientError:true}),r=await x.handler(request(body)),response=await r.json();
  assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.outcome,'applied');assert.equal(response.health_changed,true);
  assert.equal(metadataCalls(x).length,0);assert.equal(projections(x).length,1);assert.doesNotMatch(JSON.stringify(response),/private metadata client/);
});
await test('metadata five-second deadline includes client initialization and prevents work after budget exhaustion',async()=>{
  const x=setup({metadataClientMilliseconds:4000,metadata:['pending']}),pending=beginDelivery(x);await until(()=>metadataCalls(x).length===1);
  x.runTimers(999);await new Promise(resolve=>setImmediate(resolve));assert.equal(projections(x).length,0);x.runTimers(1);
  const r=await pending,response=await r.json();assert.equal(r.status,503);assert.equal(response.metadata_outcome,'uncertain');assert.equal(response.health_changed,true);
  const exhausted=setup({metadataClientMilliseconds:6000}),exhaustedResponse=await exhausted.handler(request(body)),result=await exhaustedResponse.json();
  assert.equal(exhaustedResponse.status,503);assert.equal(result.metadata_error_code,'metadata_timeout');assert.equal(metadataCalls(exhausted).length,0);assert.equal(projections(exhausted).length,1);
});
for(const [label,data] of [['empty object',{}],['array',[]],['null',null],['missing applied',{outcome:'applied',health_changed:true}],['applied without health result',{applied:true,outcome:'applied'}],['invalid health result',{applied:false,outcome:'duplicate',health_changed:'false'}],['throw',new Error('private health transport')]]){
  await test(`uncertain health ${label} response cannot fabricate successful200 or health unchanged`,async()=>{
    const x=setup({projections:[data]}),r=await x.handler(request(body)),response=await r.json();
    assert.equal(r.status,503);assert.equal(response.event_id,99);assert.equal(response.outcome,'unknown');assert.equal(response.applied,null);assert.equal(response.health_changed,null);
    assert.equal(projections(x).length,1);assert.equal(metadataCalls(x).length,1);assert.doesNotMatch(JSON.stringify(response),/private health transport/);
  });
}
await test('native ordered SQL duplicate no-op may omit health_changed without becoming uncertain',async()=>{
  const x=setup({projections:[{applied:false,outcome:'duplicate'}]}),r=await x.handler(request(body)),response=await r.json();
  assert.equal(r.status,200);assert.equal(response.event_id,99);assert.equal(response.applied,false);assert.equal(response.outcome,'duplicate');assert.equal(response.health_changed,false);
});
console.log(`${count} Edge-handler tests passed; ${failed} failed. Provider/auth/archive/metadata/health I/O is mocked; production was not called. PostgreSQL concurrency and actual Edge/HTTP transport were not run.`);
if(failed)process.exitCode=1;
