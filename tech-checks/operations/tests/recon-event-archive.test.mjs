import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ARCHIVE_BUCKET, archiveReconPayload, restoreReconPayload} from '../../supabase/functions/_shared/reconEventArchive.ts';
import {createEventArchiveHandler} from '../../supabase/functions/camera-event-archive/index.ts';
const payload=()=>({event_type:'BA',event_guid:'synthetic-event',device_info:{guid:'SYNTHETIC',type:'bridge_4g',battery_percentage:72,area:'Synthetic location'},binary:[{type:'image',data:'synthetic-binary-'.repeat(4000)}],detections:[{type:'synthetic'}],url:'https://synthetic.invalid/event'});
function storageFixture(scenario='ok'){
 const objects=new Map();let uploads=0;
 const bucket={id:ARCHIVE_BUCKET,public:false,file_size_limit:8388608,allowed_mime_types:['application/gzip']};
 const db={storage:{getBucket:async()=>({data:scenario==='public'?{...bucket,public:true}:bucket,error:null}),createBucket:async()=>{throw Error('Unexpected bucket creation')},from(name){assert.equal(name,ARCHIVE_BUCKET);return {
 upload:async(path,blob,options)=>{uploads++;assert.equal(options.upsert,false);assert.equal(options.contentType,'application/gzip');if(scenario==='upload-failed')return{error:{statusCode:'503'}};if(objects.has(path))return{error:{statusCode:'409'}};objects.set(path,scenario==='corrupt'?new Blob(['corrupt']):blob);return{error:null}},
 download:async(path)=>({data:objects.get(path),error:scenario==='download-failed'?{statusCode:'503'}:null})
 };}}};return{db,objects,get uploads(){return uploads}};
}
test('large Recon payload round-trips through verified private gzip without changing event, battery or bridge metadata',async()=>{
 const f=storageFixture(),original=payload(),compact=await archiveReconPayload(f.db,original);
 assert.notEqual(compact,original);assert.equal(Object.hasOwn(compact,'binary'),false);assert.deepEqual(compact.device_info,original.device_info);assert.equal(compact.event_guid,original.event_guid);assert.equal(compact.url,original.url);
 assert.deepEqual(await restoreReconPayload(f.db,compact.cos_private_archive),original);assert(original.binary);assert(f.objects.size===1);assert(compact.cos_private_archive.storedBytes<compact.cos_private_archive.jsonBytes);
 assert.deepEqual(await archiveReconPayload(f.db,original),compact);assert.equal(f.objects.size,1);
});
test('archive failures retain the complete original payload, with no public bucket or overwrites',async()=>{
 for(const scenario of ['public','upload-failed','download-failed','corrupt']){const f=storageFixture(scenario),p=payload();assert.equal(await archiveReconPayload(f.db,p),p);if(scenario==='public')assert.equal(f.uploads,0);}
});
test('small payloads and reserved-marker collisions retain their original form',async()=>{
 const f=storageFixture();for(const p of [{event_type:'RP',binary:[]},{binary:['small']},{...payload(),cos_private_archive:{vendor:'reserved'}},null])assert.equal(await archiveReconPayload(f.db,p),p);assert.equal(f.uploads,0);
});
test('archive restoration rejects a changed hash, size or bucket',async()=>{
 const f=storageFixture(),compact=await archiveReconPayload(f.db,payload()),marker=compact.cos_private_archive;
 for(const changed of [{...marker,sha256:'a'.repeat(64)},{...marker,jsonBytes:marker.jsonBytes-1},{...marker,bucket:'handoff-evidence'},{...marker,path:'../another-object'}])await assert.rejects(()=>restoreReconPayload(f.db,changed));
});
test('maintenance authenticates the existing cron secret before reading event records',async()=>{
 let read=false;const handler=createEventArchiveHandler({url:'https://synthetic.invalid',serviceKey:'synthetic',createClient:()=>({rpc:async()=>({data:false,error:null}),from(){read=true;throw Error('Unexpected data read')}})});
 const result=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({ids:['1']})}));assert.equal(result.status,403);assert.equal(read,false);
});
test('maintenance accepts only bounded IDs and retains a source whose compare-and-set fails',async()=>{
 const f=storageFixture(),p=payload();let writes=0;
 const db={...f.db,rpc:async(name,args)=>{if(name==='verify_camera_health_cron_secret')return{data:true,error:null};assert.equal(name,'cos_archive_camera_event_v1');assert.deepEqual(args.p_expected,p);assert(!args.p_archived.binary);writes++;return{data:false,error:null}},from(name){assert.equal(name,'camera_integration_events');const q={select(){return q},eq(k,v){assert.equal(k,'provider');assert.equal(v,'reconeyez');return q},in(){return q},limit:async()=>({data:[{id:1,payload:p}],error:null})};return q}};
 const handler=createEventArchiveHandler({url:'https://synthetic.invalid',serviceKey:'synthetic',createClient:()=>db});
 for(const ids of [['1','1'],['0'],['9223372036854775808'],Array.from({length:101},(_,i)=>String(i+1))])assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({ids})}))).status,400);
 assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({ids:['1'],url:'https://attacker.invalid'})}))).status,400);
 const result=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({ids:['1']})}));assert.deepEqual(await result.json(),{ok:false,requested:1,found:1,archived:0,unchanged:0,deferred:0,failed:1});assert.equal(writes,1);assert(p.binary);
});
test('database replacement preserves every non-binary field, refuses concurrent edits, and exposes no user execute grant',async()=>{
 const sql=await readFile(new URL('../../database-maintenance/archive-recon-event-payloads.sql',import.meta.url),'utf8'),pg=new PGlite();
 try{
 await pg.exec("create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text, public boolean); create table storage.objects(bucket_id text,name text,metadata jsonb); create table public.camera_integration_events(id bigint,provider text,payload jsonb); ");
 await pg.exec(sql);
 const f=storageFixture(),p=payload(),compact=await archiveReconPayload(f.db,p),m=compact.cos_private_archive;
 await pg.query('insert into storage.buckets values ($1,false)',[ARCHIVE_BUCKET]);await pg.query('insert into storage.objects values ($1,$2,$3)',[ARCHIVE_BUCKET,m.path,{size:m.storedBytes}]);await pg.query('insert into camera_integration_events values (1,$1,$2)',['reconeyez',p]);
 const commit=async(expected,archived)=> (await pg.query('select cos_archive_camera_event_v1(1,$1,$2) as ok',[expected,archived])).rows[0].ok;
 assert.equal(await commit(p,{...compact,device_info:{...p.device_info,battery_percentage:0}}),false);
 const missing={...compact,cos_private_archive:{...m}};delete missing.cos_private_archive.version;assert.equal(await commit(p,missing),false);
 assert.equal(await commit({...p,event_type:'changed'},compact),false);assert.equal(await commit(p,compact),true);assert.equal(await commit(p,compact),false);
 assert.deepEqual((await pg.query('select payload from camera_integration_events')).rows[0].payload,compact);
 const grants=await pg.query("select has_function_privilege('anon','public.cos_archive_camera_event_v1(bigint,jsonb,jsonb)','execute') as anon,has_function_privilege('authenticated','public.cos_archive_camera_event_v1(bigint,jsonb,jsonb)','execute') as authenticated");assert.deepEqual(grants.rows[0],{anon:false,authenticated:false});
 }finally{await pg.close();}
});
