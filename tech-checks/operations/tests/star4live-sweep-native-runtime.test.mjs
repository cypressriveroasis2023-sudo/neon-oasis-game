import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildStar4LiveSweepOverlay,patchStar4LiveSweep,sha256,edits} from '../scripts/prepareStar4LiveSweepRuntime.mjs';
const folder=new URL('../docs/star4live-scheduled-ping-20261102/',import.meta.url);
const source=await readFile(new URL('captured-v64-factory.js',folder),'utf8'),overlay=await readFile(new URL('collector-overlay.js',folder),'utf8');
const manifest=JSON.parse(await readFile(new URL('native-manifest.json',folder),'utf8'));
let expected=source;for(const [a,b]of edits)expected=expected.replace(a,b);expected=expected.replace('Deno.serve(',overlay+'Deno.serve(');
const fixtureManifest={...manifest,expectedBefore:sha256(source),expectedAfter:sha256(expected)};
const patched=patchStar4LiveSweep(source,overlay,fixtureManifest);
test('collector overlay reproduces and exact reverse patch restores original factory/auth code',async()=>{
 assert.equal(await buildStar4LiveSweepOverlay(),overlay);assert.equal(patchStar4LiveSweep(patched,overlay,fixtureManifest,true),source);
 assert.throws(()=>patchStar4LiveSweep(source+' ',overlay,fixtureManifest));assert.throws(()=>patchStar4LiveSweep(patched,overlay,fixtureManifest));
 assert.throws(()=>patchStar4LiveSweep(source,overlay+' ',fixtureManifest));
 for(const preserved of ['if (req.method !== "POST")','verify_camera_health_cron_secret','if (valid !== true)','const cameraRun = collectScheduledDirect','endpointSourceEnabled: true, completedSnapshotEnabled: true'])assert.ok(patched.includes(preserved),preserved);
});
function setup(allowed=true){
 const state={handler:null,writes:[],sockets:0,inventoryReads:0,coverage:0,logs:[]};
 const device={id:42,source:'vigilant_control_center',unit_key:'Synthetic Ranger',device_name:'Synthetic recorder',organization:'Synthetic site',activation_state:'active',monitoring_enabled:true,public_ip:'8.8.8.8',expected_ports:[81],connection_revision:1,monitoring_profile:'ranger'};
 const db={rpc(name,args){const q={abortSignal(){return q},then(resolve,reject){
  if(name==='verify_camera_health_cron_secret')return Promise.resolve({data:allowed}).then(resolve,reject);
  if(name==='publish_camera_connection_v1'){state.writes.push(args);return Promise.resolve({data:{ok:true}}).then(resolve,reject);}
  throw Error('Unexpected RPC '+name);
 }};return q;},from(table){let update=false;const q={select(){return q},eq(){return q},order(){return q},range(){return q},in(){return q},or(){return q},abortSignal(){return q},update(){update=true;return q},then(resolve,reject){
  if(table==='camera_devices')state.inventoryReads++;
  const data=table==='camera_devices'?[device]:table==='camera_integrations'&&update?(state.coverage++,[{provider:'avigilon'}]):[];
  return Promise.resolve({data,error:null}).then(resolve,reject);
 }};return q;}};
 const context={Response,Request,Headers,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,Date,Map,Set,Promise,Error,
  createClient:()=>db,json:(v,status=200)=>Response.json(v,{status}),
  console:{info:(...args)=>state.logs.push(args)},
  Deno:{env:{get:()=> 'synthetic-not-a-key'},serve:handler=>{state.handler=handler;}},
  tcp:async()=>{state.sockets++;return {online:true,latency_ms:1};},
  boundedRequest:async fn=>fn(new AbortController().signal),
  scheduledEndpointFromExistingCron:()=>null,scheduledTrackerEndpointRuntime:()=>null,
  collectScheduledDirect:async()=>({results:[],eligible:0,held:[],deferred:0,deadlineReached:false}),
  runCompletedCameraCycle:async({collectExisting})=>(await collectExisting()).json()
 };
 vm.runInNewContext(patched,context);return state;
}
test('captured native handler denies bad cron secret and GET before inventory/sockets/publication',async()=>{
 const a=setup(false),forbidden=await a.handler(new Request('https://synthetic.example',{method:'POST',body:'{}'}));assert.equal(forbidden.status,403);assert.equal(a.sockets,0);assert.equal(a.inventoryReads,0);assert.equal(a.writes.length,0);
 const b=setup(true),method=await b.handler(new Request('https://synthetic.example'));assert.equal(method.status,405);assert.equal(b.inventoryReads,0);
});
test('captured native cron handler runs the real Star4Live collector and existing sweep in the same authenticated cycle',async()=>{
 const s=setup(),response=await s.handler(new Request('https://synthetic.example',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':'synthetic'},body:'{}'}));
 assert.equal(response.status,200);assert.equal(s.sockets,1);assert.equal(s.writes.length,1);assert.equal(s.writes[0].p_device_id,42);assert.equal(s.writes[0].p_monitoring_profile,'ranger');assert.equal(s.coverage,1);
 assert.ok(s.logs.some(args=>args[0]==='star4live_tcp_sweep'&&JSON.parse(args[1]).published===1));
});
