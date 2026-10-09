import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {boundedRequest} from '../../supabase/functions/_shared/scheduledDirectService.ts';

const source=await readFile(new URL('../../supabase/functions/camera-health-sweep/index.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const makeRows=n=>Array.from({length:n},(_,i)=>({id:i+1,unit_key:'Synthetic '+(i+1),router_public_ip:'8.10.'+Math.floor(i/250)+'.'+(i%250+1),unit_ip:null,web_port:8080,current_status:'offline',last_checked_at:null,last_online_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}));
async function run(rows,{batch=25,authorized=true,onConnect,clock}={}){
 let handler,active=0,maxActive=0;const sockets=[],writes=[];
 const db={rpc:async()=>({data:authorized}),from(table){let patch;const filters=[];
  const q={select(){return q},or(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},update(v){patch=v;return q},abortSignal(){return q},then(resolve,reject){
   if(table==='camera_integrations')return Promise.resolve({data:[{provider:'avigilon'}]}).then(resolve,reject);
   if(!patch)return Promise.resolve({data:structuredClone(rows)}).then(resolve,reject);
   const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));for(const row of found){writes.push({id:row.id,patch:structuredClone(patch)});Object.assign(row,patch);}
   return Promise.resolve({data:found.map(r=>({id:r.id}))}).then(resolve,reject);
  }};return q;
 }};
 vm.runInNewContext(js,{createClient:()=>db,collectScheduledDirect:async()=>({results:[],eligible:0,held:[],deferred:0,deadlineReached:false}),boundedRequest,fetch,AbortSignal,AbortController,Request,Response,Date:clock||Date,setTimeout,clearTimeout,
  Deno:{env:{get:()=>''},serve:h=>handler=h,connect:async(options)=>{
   sockets.push({host:options.hostname,port:options.port});active++;maxActive=Math.max(maxActive,active);await onConnect?.(options,rows);
   await new Promise(resolve=>setTimeout(resolve,1));active--;return {close(){}};
  }}});
 const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({batch_size:batch})}));
 return {response,result:await response.json(),sockets,writes,maxActive};
}
test('one scheduled request covers all 188 due routers while limiting socket concurrency to 25',async()=>{
 const rows=makeRows(188),before=structuredClone(rows),r=await run(rows);
 assert.equal(r.response.status,200);assert.equal(r.result.routers_checked,188);assert.equal(r.sockets.length,188);assert.equal(r.writes.length,188);assert.ok(r.maxActive<=25);
 assert.equal(r.result.coverage.router_coverage.complete,true);assert.equal(r.result.coverage.router_coverage.deferred,0);assert.equal(r.result.coverage.router_coverage.published,188);
 assert.equal(r.sockets.every(x=>x.port===8080),true);
 for(let i=0;i<rows.length;i++){assert.equal(rows[i].router_public_ip,before[i].router_public_ip);assert.equal(rows[i].unit_key,before[i].unit_key);assert.equal(rows[i].last_online_at,rows[i].last_checked_at);}
});
test('smaller existing batch settings reduce concurrency without clipping the fleet',async()=>{
 const r=await run(makeRows(31),{batch:12});assert.equal(r.writes.length,31);assert.ok(r.maxActive<=12);
});
test('configuration and newer observation changes during sockets prevent stale publication',async()=>{
 for(const key of ['router_public_ip','web_port','updated_at']){
  const rows=makeRows(1),r=await run(rows,{onConnect:()=>{rows[0][key]=key==='web_port'?8443:key==='updated_at'?'2026-10-09T15:00:00Z':'8.11.0.1';}});
  assert.equal(r.writes.length,0);assert.equal(r.result.router_results[0].reason,'router_configuration_changed');assert.equal(rows[0].last_checked_at,null);
 }
});
test('deadline leaves unfinished routers due and rejects observations completed after the deadline',async()=>{
 let time=Date.now();class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const rows=makeRows(188),r=await run(rows,{clock:Clock,onConnect:()=>{time+=48_000;}});
 assert.equal(r.sockets.length,25);assert.equal(r.writes.length,0);assert.equal(r.result.coverage.router_coverage.deferred,163);assert.equal(r.result.coverage.router_coverage.complete,false);assert.equal(rows.every(x=>x.last_checked_at===null),true);
});
test('unsupported endpoint/port and a truncated inventory cannot create an outage',async()=>{
 const rows=makeRows(2);rows[0].router_public_ip='10.0.0.1';rows[1].web_port=65536;
 const r=await run(rows);assert.equal(r.sockets.length,0);assert.equal(r.writes.length,0);assert.equal(r.result.router_results.every(x=>x.status==='unknown'),true);
 const truncated=await run(makeRows(1000));assert.equal(truncated.sockets.length,0);assert.equal(truncated.result.coverage.router_coverage.counts_known,false);
});
test('existing cron authorization still gates all inventory, sockets and publications',async()=>{
 const r=await run(makeRows(188),{authorized:false});assert.equal(r.response.status,403);assert.equal(r.sockets.length,0);assert.equal(r.writes.length,0);
});
