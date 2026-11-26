// Checks the camera-health-sweep "checker refused" hold.
//
// The recipe in docs/camera-health-sweep-checker-refused-20261126 is applied to
// the source the live function loads (v103, stored in this repository), and the
// real collector is run from the result. Only the platform edges are replaced:
// the database client, the TCP connect and the console.
//
// Addresses here are made up (next to the documentation range, which the
// collector itself rejects). They are not fleet addresses and nothing is dialled.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const at=path=>new URL('../../../'+path,import.meta.url);
const recipe=JSON.parse(readFileSync(new URL('../../docs/camera-health-sweep-checker-refused-20261126/recipe.json',import.meta.url),'utf8'));
const sha=text=>createHash('sha256').update(text).digest('hex');
const baseline=readFileSync(at(recipe.baselineFile),'utf8');
const result=readFileSync(at(recipe.resultFile),'utf8');
let patched=baseline;
for(const edit of recipe.edits){assert.equal(patched.split(edit.before).length-1,edit.occurrences,edit.name);patched=patched.split(edit.before).join(edit.after);}

const REFUSED='Connection refused (os error 111)';
const refused=()=>({online:false,latency_ms:null,error:REFUSED});
const timeout=()=>({online:false,latency_ms:null,error:'timeout'});
const open=()=>({online:true,latency_ms:80});
const PORTS=[80,443,8443,38880,38881];
/** A unit as it normally answers: three ports open, two refused by its router. */
const normal=port=>[80,443,38881].includes(port)?open():refused();

/** Run the real collector from a bundle over `units`: [{tag, host, answer(port), previous?}]. */
async function sweep(text,units,options={}){
 const program=text.replace(/^import [^\n]*\n/gm,'').replace(/^export \{[^}]*\};?\s*$/gm,'');
 const logs=[],writes=[];
 const master=units.map(u=>({canonical_family:'Sniper',unit_tag:u.tag,source_label:'Sniper '+u.tag,tracker_state:'field_or_unknown'}));
 const devices=units.map((u,i)=>({id:i+1,unit_key:'SNIPER '+u.tag,device_name:'SNIPER '+u.tag,source:'2026_unit_tracker',mhelp_product_id:String(2000+i),public_ip:u.host,expected_ports:PORTS,connection_revision:0,monitoring_profile:'sniper',monitoring_enabled:true,activation_state:'active',organization:'Example Site',last_health_checked_at:null}));
 const health=units.filter(u=>u.previous).map(u=>({camera_device_id:devices.find(d=>d.unit_key==='SNIPER '+u.tag).id,...u.previous}));
 const tables={equipment_master:master,camera_devices:devices,camera_health_current:health};
 const answer=value=>{const p=Promise.resolve(value);const chain=new Proxy(function(){},{get(_,k){if(k==='then')return p.then.bind(p);if(k==='catch')return p.catch.bind(p);if(k==='finally')return p.finally.bind(p);return ()=>chain;}});return chain;};
 const db={from:table=>answer({data:tables[table]||[],error:null}),rpc:(name,args)=>{if(name==='publish_camera_connection_v1'){writes.push(args);return answer({data:{ok:true},error:null});}return answer({data:null,error:null});}};
 const context=vm.createContext({console:{log(){},warn(){},error(){},info:line=>logs.push(String(line))},setTimeout,clearTimeout,setInterval,clearInterval,AbortController,AbortSignal,Response,Request,Headers,TextEncoder,TextDecoder,ReadableStream,crypto,URL,URLSearchParams,structuredClone,queueMicrotask,Promise,JSON,Math,Date,
  fetch:async()=>new Response('{}',{status:404}),createClient:()=>db,Deno:{env:{get:()=>'synthetic'},serve(){},connect:()=>Promise.reject(new Error('not used'))}});
 vm.runInContext(program+'\n;globalThis.__collect=collectScheduledDirect;',context,{filename:'camera-health-sweep.js'});
 const answers=new Map(units.map(u=>[u.host,u.answer]));
 const probe=async(host,port)=>answers.get(host)(port);
 const value=await context.__collect(db,probe,options);
 const byUnit=new Map(value.results.map(r=>[r.name||devices.find(d=>d.id===r.id).unit_key,r]));
 const wrote=new Map(writes.map(w=>[devices.find(d=>d.id===w.p_device_id).unit_key,w.p_health]));
 return {value,logs,byUnit,wrote};
}
const unit=(tag,host,answer,previous)=>({tag,host,answer,previous});
const down=(units,run)=>units.filter(u=>run.wrote.get('SNIPER '+u.tag)?.overall_status==='offline').map(u=>u.tag);

test('the recipe applies to exactly the source the live function loads and produces the recorded result',()=>{
 assert.equal(recipe.baselineVersion,103);
 assert.equal(sha(baseline),recipe.baselineSha256);
 assert.equal(sha(patched),recipe.resultSha256);
 assert.equal(sha(result),recipe.resultSha256,'source/index.ts is not the recipe result');
 for(const edit of recipe.edits)assert.ok(/refusedOnEveryPort|refusedEndpoints|CHECKER_REFUSED_ENDPOINTS/.test(edit.after),edit.name);
});

test('the live source writes Offline for every unit when the worker itself is refused (the fault)',async()=>{
 const units=[1,2,3,4,5,6,7,8].map(n=>unit('30'+n,'198.51.101.'+n,refused));
 const run=await sweep(baseline,units);
 assert.equal(down(units,run).length,8);
});

test('eight endpoints refused on every port in one run: nothing is written and each is held',async()=>{
 const units=[1,2,3,4,5,6,7,8].map(n=>unit('30'+n,'198.51.101.'+n,refused));
 const run=await sweep(patched,units);
 assert.equal(run.wrote.size,0);
 for(const u of units){const r=run.byUnit.get('SNIPER '+u.tag);assert.equal(r.published,false);assert.equal(r.reason,'checker_connection_refused');assert.equal(r.status,'unknown');}
 assert.ok(run.logs.some(l=>l.startsWith('direct_sweep_checker_refused ')&&JSON.parse(l.slice(l.indexOf('{'))).endpoints===8));
});

test('inside one shard of four the same hold applies and the log names the shard',async()=>{
 // 32 units; shard 3 of 4 owns the eight whose id leaves remainder 3.
 const units=Array.from({length:32},(_,n)=>unit(String(300+n+1),'198.51.101.'+(n+1),refused));
 const run=await sweep(patched,units,{shardIndex:3,shardCount:4});
 assert.equal(run.wrote.size,0);
 assert.equal(run.value.results.length,8);
 assert.ok(run.value.results.every(r=>r.reason==='checker_connection_refused'));
 const line=run.logs.find(l=>l.startsWith('direct_sweep_checker_refused '));
 assert.deepEqual(JSON.parse(line.slice(line.indexOf('{'))),{shardIndex:3,shardCount:4,endpoints:8});
});

test('a unit on another path that answers in the same run is written Online; the refused ones are held',async()=>{
 const units=[...[1,2,3,4,5,6,7].map(n=>unit('30'+n,'198.51.101.'+n,refused)),unit('311','198.51.102.9',normal)];
 const run=await sweep(patched,units);
 assert.equal(run.wrote.size,1);
 assert.equal(run.wrote.get('SNIPER 311').overall_status,'online');
 assert.equal(run.byUnit.get('SNIPER 301').reason,'checker_connection_refused');
});

test('a unit that is really down (its ports time out) is still written Offline, in the same run as a refused group',async()=>{
 const units=[...[1,2,3,4].map(n=>unit('30'+n,'198.51.101.'+n,refused)),unit('168','198.51.101.200',timeout),unit('320','198.51.101.201',normal)];
 const run=await sweep(patched,units);
 assert.deepEqual([...run.wrote.keys()].sort(),['SNIPER 168','SNIPER 320']);
 assert.equal(run.wrote.get('SNIPER 168').overall_status,'offline');
 assert.equal(run.wrote.get('SNIPER 168').consecutive_failures,1);
 assert.equal(run.wrote.get('SNIPER 320').overall_status,'online');
});

test('one or two endpoints refusing on their own are written Offline exactly as before',async()=>{
 for(const count of [1,2]){
  const units=[...Array.from({length:count},(_,n)=>unit('30'+(n+1),'198.51.101.'+(n+1),refused)),...[1,2,3,4].map(n=>unit('32'+n,'198.51.102.'+n,normal))];
  const [before,after]=[await sweep(baseline,units),await sweep(patched,units)];
  assert.equal(down(units,after).length,count);
  assert.deepEqual(JSON.parse(JSON.stringify([...after.wrote])).map(([k,h])=>[k,h.overall_status,h.consecutive_failures]),JSON.parse(JSON.stringify([...before.wrote])).map(([k,h])=>[k,h.overall_status,h.consecutive_failures]));
  assert.equal(after.logs.length,0);
 }
});

test('a mix of refused and timed-out ports on a unit is not the checker: it is written Offline',async()=>{
 const mixed=port=>port===80?timeout():refused();
 const units=[1,2,3,4,5].map(n=>unit('30'+n,'198.51.101.'+n,mixed));
 const run=await sweep(patched,units);
 assert.equal(down(units,run).length,5);
 assert.equal(run.logs.length,0);
});

test('a healthy run is written exactly as the live source writes it',async()=>{
 const units=[1,2,3,4,5,6].map(n=>unit('30'+n,'198.51.101.'+n,normal));
 const [before,after]=[await sweep(baseline,units),await sweep(patched,units)];
 assert.equal(after.wrote.size,6);
 const shape=run=>[...run.wrote].map(([k,h])=>[k,h.overall_status,h.ip_reachable,h.consecutive_failures,h.confirmed_outage,Object.keys(h.port_status).length]);
 assert.deepEqual(shape(after),shape(before));
});

test('the hold is latched across waves: a second wave in a refused run is held too',async()=>{
 // 14 units: the first wave is 12, the second 2. Both must be held.
 const units=Array.from({length:14},(_,n)=>unit(String(300+n+1),'198.51.101.'+(n+1),refused));
 const run=await sweep(patched,units);
 assert.equal(run.wrote.size,0);
 assert.equal(run.value.results.filter(r=>r.reason==='checker_connection_refused').length,14);
});
