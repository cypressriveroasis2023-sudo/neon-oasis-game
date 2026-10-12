import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {resolveStarResources} from '../../supabase/functions/vigilant-sync/star-resource-identity.js';

const historical='2026-10-10T12:00:00Z';
const local=(patch={})=>({id:901,device_name:'Helios901 synthetic camera 3+4',device_serial:'synthetic-physical-alpha',external_device_id:'synthetic-external-beta',monitoring_profile:'helios',organization:'Synthetic site',unit_key:'Helios901',last_online_at:historical,source_last_seen_at:historical,public_ip:'192.0.2.55',...patch});
const resource=(serial,status,patch={})=>({deviceSerial:serial,deviceName:'Helios901 synthetic camera 3+4',status,...patch});
const alpha=status=>resource(local().device_serial,status),beta=status=>resource(local().external_device_id,status);
async function handler(resources,locals=[local()],options={}){
 const rows=structuredClone(locals),writes=[],source=readFileSync(new URL('../../supabase/functions/vigilant-sync/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');let handle;
 const db={from(table){return {select(){return this},eq(){return this},in(){return this},maybeSingle(){return {data:{metadata:{existing:'preserved'}}}},then(resolve){resolve({data:rows})},update(patch){return {eq:async(column,id)=>{const clean=JSON.parse(JSON.stringify(patch));writes.push({table,id,patch:clean});Object.assign(rows.find(row=>row.id===id),clean);return {error:null}}}},upsert:async(patch)=>{writes.push({table,patch});return {error:null}},insert:async(patch)=>{writes.push({table,patch});return {error:null}}}}};
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(js,{
  Deno:{env:{get:()=> 'synthetic-only'},serve:callback=>{handle=callback}},createClient:()=>db,crypto:{subtle:{digest:async()=>new Uint8Array(16).buffer}},TextEncoder,navigator:{userAgent:'synthetic-test',platform:'synthetic-test'},Response,Request,Error,resolveStarResources,console:{error:()=>{}},
  fetch:async(url,request)=>{
   if(options.failAuth)return new Response(JSON.stringify({message:'Synthetic authentication failure'}),{status:401});
   let data;if(url.endsWith('getbyloginname'))data={serverHost:'example.invalid'};else if(url.endsWith('/get'))data={token:'synthetic-only'};
   else{if(options.failInventory)return new Response('{}',{status:503});const body=JSON.parse(request.body);if(options.failQuery===body.deviceName)return new Response('{}',{status:503});data=options.malformed?{}:{resourceList:options.inventory?options.inventory(body):resources};}
   return new Response(JSON.stringify({data}),{status:200});
  }
 });
 const response=await handle(new Request('https://synthetic.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options.target||{})}));return {rows,writes,status:response.status,result:await response.json()};
}
const healthWrites=r=>r.writes.filter(row=>['camera_health_current','camera_health_history'].includes(row.table));

test('alternate refresh quarantines both alias orders once without health/history, identity or manual-IP changes',async()=>{
 for(const list of [[alpha(1),beta(0)],[beta(0),alpha(1)]]){
  const r=await handler(list);assert.equal(r.status,200);assert.equal(r.result.unknown,1);assert.equal(r.result.updated,1);assert.equal(r.result.identity_conflicts.length,1);assert.equal(r.rows[0].source_status,'unknown');assert.equal(r.rows[0].last_online_at,historical);
  for(const key of ['device_serial','external_device_id','public_ip'])assert.equal(r.rows[0][key],local()[key]);assert.equal(healthWrites(r).length,0);assert.equal(r.writes.filter(row=>row.table==='camera_devices').length,1);
 }
});
test('single-resource explicit statuses retain legacy health/history without external-ID reassignment',async()=>{
 for(const status of [0,1]){const r=await handler([alpha(status)]);assert.equal(r.status,200);assert.equal(r.result.updated,1);assert.equal(r.rows[0].external_device_id,local().external_device_id);assert.equal(r.rows[0].source_status,status?'online':'offline');assert.equal(healthWrites(r).length,2);if(!status)assert.equal(r.rows[0].last_online_at,historical);}
});
test('targeted one-alias refresh holds a prior durable collision until saved IDs agree',async()=>{
 const first=await handler([alpha(1),beta(0)]);assert.equal(first.rows[0].source_status,'unknown');
 const second=await handler([alpha(1)],first.rows,{target:{device_id:901}});assert.equal(second.status,200);assert.equal(second.rows[0].source_status,'unknown');assert.equal(second.rows[0].last_online_at,historical);assert.equal(second.rows[0].source_metadata.conflictingResources.length,2);assert.equal(healthWrites(second).length,0);
 const third=await handler([alpha(1)],[{...second.rows[0],external_device_id:local().device_serial}],{target:{device_id:901}});assert.equal(third.status,200);assert.equal(third.rows[0].source_status,'online');assert.equal(third.result.identity_conflicts.length,0);
});
test('same-resource status conflict recovers without an identity rewrite',async()=>{
 const first=await handler([alpha(1),alpha(0)]);assert.equal(first.rows[0].source_status,'unknown');const second=await handler([alpha(1)],first.rows);assert.equal(second.status,200);assert.equal(second.rows[0].source_status,'online');assert.equal(second.result.identity_conflicts.length,0);
});
test('malformed status never manufactures historical offline or current-health evidence',async()=>{
 for(const status of [undefined,null,'',true,false,NaN,2]){const r=await handler([alpha(status)]);assert.equal(r.status,200);assert.equal(r.rows[0].source_status,'unknown');assert.equal(r.rows[0].last_online_at,historical);assert.equal(r.result.offline,0);assert.equal(healthWrites(r).length,0);}
});
test('targeted refresh checks all loaded owners while writes stay limited to the selected unit',async()=>{
 const second=local({id:902,unit_key:'Helios902',device_name:'Helios902 synthetic camera',device_serial:'synthetic-other',external_device_id:local().device_serial});
 const r=await handler([alpha(1)],[local(),second],{target:{device_id:901}});assert.equal(r.status,200);assert.equal(r.rows[0].source_status,'unknown');assert.equal(r.rows[1].source_status,undefined);assert.equal(r.rows[1].source_last_seen_at,historical);assert.deepEqual(r.writes.filter(row=>row.table==='camera_devices').map(row=>row.id),[901]);
});
test('name-only vendor rows cannot update another durable identity despite duplicate local names',async()=>{
 const r=await handler([resource('synthetic-unrelated',0)],[local(),local({id:902,device_serial:'synthetic-other',external_device_id:'synthetic-other'})]);assert.equal(r.status,200);assert.equal(r.result.updated,0);assert.equal(r.writes.filter(row=>row.table==='camera_devices').length,0);
});
test('all selected queries finish before writes and any fetch/schema failure preserves observations',async()=>{
 for(const options of [{failAuth:true},{failInventory:true},{malformed:true},{failQuery:'902'}]){
  const second=local({id:902,unit_key:'Helios902',device_name:'Helios902 synthetic camera',device_serial:'synthetic-other',external_device_id:'synthetic-other'});const r=await handler([alpha(1)],[local(),second],options);assert.equal(r.status,500);assert.equal(r.writes.length,0);assert.deepEqual(r.rows,[local(),second]);
 }
});
