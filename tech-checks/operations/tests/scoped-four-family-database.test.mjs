import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {fixture,org,hash,actor} from './fixtures/scoped-inventory-fixture.mjs';
async function setup(options){
 const f=await fixture(options),rows=[];
 const defs=[['Spotter 028','Spotter HDC4','SPOTTER:28.1','Spotter 028.1'],['Spotter 263','Spotter HDC4','SPOTTER:263'],['Solar Spotter 039','Solar Spotter','SOLAR SPOTTER:39'],['Ranger 024','RANGER 1 CAM.','RANGER:24'],['Ranger 007','RANGER 1 CAM.','RANGER:7'],['Helios 090 - DO NOT USE','Helios Solar Tower','HELIOS:90']];
 for(const [i,[label,category,key,nativeLabel=label]] of defs.entries()){
  const id=`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`;
  await f.db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,unit_key,family,placement,customer) values($1,$2,$3,$3,'SYNTHETIC','FIELD','Synthetic Client')",[id,org,nativeLabel]);
  const guard=(await f.db.query('select cos_mhelp_placement_private.upload_binding_guard($1,null) g',[id])).rows[0].g;
  rows.push({...f.records[0],productId:String(201+i),unitNumber:label,category,customerId:i===1?'11':'12',customer:i===1?'Cameras OnSite':'Synthetic Client',placement:i===1?'SHOP':'FIELD',lifecycle:i===5?'DO_NOT_USE':'UNFLAGGED',sourceRow:i+5,sourceAddress:{street:'1 Synthetic Street',city:'Example',state:'TX',zip:'00000'},binding:{...f.records[0].binding,productId:String(201+i),trackerId:id,trackerLabel:nativeLabel,fullLabel:label,canonicalKey:key,representedUnitIds:[id],expectedGuard:guard}});
 }
 await f.db.query("update cos_mhelp_placement_private.upload_batches set records=$1,receipt=jsonb_set(receipt,'{recordCount}',$2::jsonb)",[f.records.concat(rows),JSON.stringify(f.records.length+rows.length)]);
 const authority={kind:'service_item_export',libraryFileId:'libfile_syntheticExport',sha256:hash,receivedAt:f.evidence.receivedAt,authorizationSha256:hash};
 const assignment=(i,after={},extra={})=>({mode:'assignment',expectedRecord:rows[i],after:{...f.target(rows[i]),...after},authority:{...authority},...extra});
 const address=(i,customerId,kind='service_item_export')=>({sourceAddress:{street:'2 Synthetic Street',city:'Example',state:'TX',zip:'00001'},sourceAddressEvidence:{...authority,kind,sourceProductId:rows[i].productId,customerId}});
 return {...f,rows,authority,assignment,address};
}
test('five corrections extend revision one, retain identity/history/state and roll back exactly',async()=>{
 const originalSql=execFileSync('git',['show','916129fcc09049cffdd2c519f67b2ef95e5d3587:tech-checks/operations/db/scoped_inventory_overlay.sql'],{encoding:'utf8'});
 const f=await setup({overlaySql:originalSql});try{
 await f.call({apply:true});
 // Upgrade only the review function on an installed overlay; preserve ACL and head.
 const signature='cos_mhelp_placement_private.review_scoped_inventory(uuid,uuid,text,bigint,uuid,jsonb,jsonb,boolean)';
 const metadata=async()=>(await f.db.query('select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
 const originalMetadata=await metadata(),installed=await f.snapshot();
 const saved=async()=>(await f.db.query('select to_jsonb(b) v from cos_mhelp_placement_private.scoped_batches b order by id')).rows;
 const savedBefore=await saved();
 const readerMetadata=async()=>(await f.db.query("select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid='cos_mhelp_placement_private.upload_snapshot()'::regprocedure")).rows[0];
 const originalReaderMetadata=await readerMetadata();
 const sql=await readFile(new URL('../db/scoped_inventory_overlay.sql',import.meta.url),'utf8');
 await f.db.exec(sql.slice(sql.indexOf('create or replace function cos_mhelp_placement_private.review_scoped_inventory('),sql.indexOf('create function cos_mhelp_placement_private.rollback_scoped_inventory(')));
 await f.db.exec(sql.slice(sql.indexOf('create or replace function cos_mhelp_placement_private.upload_snapshot()'),sql.lastIndexOf('revoke all on function')));
 assert.deepEqual(await saved(),savedBefore);assert.deepEqual(await readerMetadata(),originalReaderMetadata);
 assert.deepEqual(await metadata(),originalMetadata);assert.deepEqual(await f.snapshot(),installed);
 const before=await f.snapshot(),preserved=await f.preserved();
 const operations=[f.assignment(0,{unitNumber:'Spotter 028.1'},{mode:'source_label_correction'}),f.assignment(1,{customer:'Synthetic School',customerId:'13',placement:'FIELD'},f.address(1,'13')),f.assignment(2,{customer:'Cameras OnSite',customerId:'11',placement:'SHOP'},f.address(2,'11')),f.assignment(3,{customer:'Synthetic Park',customerId:'14'},{...f.address(3,'14','user_confirmed_customer_address'),authority:{...f.authority,kind:'user_override'}}),f.assignment(4,{customer:'Cameras OnSite',customerId:'11',placement:'SHOP'},{authority:{...f.authority,kind:'user_override',effectiveAt:'2026-01-01T18:00:00-05:00'}})];
 const args={revision:1,requestId:'44444444-4444-4444-8444-444444444444',operations};
 await f.call(args);assert.deepEqual(await f.snapshot(),before);assert.equal((await f.call({...args,apply:true})).revision,2);assert.equal((await f.call({...args,apply:true})).idempotent,true);
 const after=await f.snapshot();assert.equal(after.records.length,before.records.length);assert.deepEqual(after.records.slice(0,3),before.records.slice(0,3));assert.deepEqual(after.records.at(-1),before.records.at(-1));
 for(let i=3;i<8;i++)assert.deepEqual(after.records[i].binding,i===3?{...before.records[i].binding,fullLabel:'Spotter 028.1'}:before.records[i].binding);
 assert.equal(after.records[3].unitNumber,'Spotter 028.1');assert.deepEqual(after.records[7].sourceAddress,{});assert.equal(after.records[7].customer,'Cameras OnSite');assert.equal(after.records[6].assignmentAuthority.effectiveAt,undefined);assert.equal(after.records[7].assignmentAuthority.effectiveAt,'2026-01-01T18:00:00-05:00');assert.deepEqual(await f.preserved(),preserved);
 const storedRow=(await f.db.query('select records from cos_mhelp_placement_private.scoped_batches where id=$1',[args.requestId])).rows[0].records[7];
 await assert.rejects(()=>f.call({revision:2,requestId:'55555555-5555-4555-8555-555555555555',operations:[{...f.assignment(4),expectedRecord:storedRow,after:f.target(storedRow)}]}),/override requires/);
 const stored=(await f.db.query('select request from cos_mhelp_placement_private.scoped_batches where id=$1',[args.requestId])).rows[0].request;assert.deepEqual(stored.operations[4].expectedRecord,f.rows[4]);
 await assert.rejects(()=>f.call({...args,requestId:'55555555-5555-4555-8555-555555555555',apply:true}),/revision changed/);
 await f.db.query('select cos_mhelp_placement_private.rollback_scoped_inventory($1,$2,$3,2,$4,$5)',[actor,org,hash,args.requestId,hash]);assert.deepEqual((await f.snapshot()).records,before.records);
 }finally{await f.db.close();}
});
test('invalid authority, label, address, time, lifecycle and placement fail atomically',async()=>{
 const f=await setup();try{
 const initial=await f.snapshot(),invalid=[
 f.assignment(1,{}, {authority:undefined}),f.assignment(1,{}, {authority:{...f.authority,kind:'guessed'}}),f.assignment(1,{}, {authority:{...f.authority,receivedAt:'2099-01-01T00:00:00Z'}}),f.assignment(1,{}, {authority:{...f.authority,kind:'user_override',effectiveAt:'2026-01-03T00:00:00Z'}}),f.assignment(1,{}, {authority:{...f.authority,effectiveAt:'2026-01-01T00:00:00Z'}}),
 f.assignment(4,{placement:'SHOP'}),f.assignment(4,{placement:'SHOP',customer:'Cameras Onsite Branch',customerId:'11'}),f.assignment(4,{customer:'Unknown'}),f.assignment(1,{productId:'999'},{mode:'replace_source_hold'}),
 f.assignment(0,{unitNumber:'Spotter 028'},{mode:'source_label_correction'}),f.assignment(0,{unitNumber:'Spotter 028.10'},{mode:'source_label_correction'}),f.assignment(0,{unitNumber:'Spotter 028.1',customer:'Other'},{mode:'source_label_correction'}),f.assignment(0,{unitNumber:'Spotter 028.1',public_ip:'203.0.113.1'},{mode:'source_label_correction'}),
 f.assignment(1,{}, {sourceAddress:f.address(1,'11').sourceAddress}),f.assignment(1,{},f.address(1,'12')),f.assignment(1,{}, {...f.address(1,'11'),sourceAddress:{...f.address(1,'11').sourceAddress,lat:1}}),f.assignment(1,{}, {...f.address(1,'11'),sourceAddressEvidence:{...f.address(1,'11').sourceAddressEvidence,sourceProductId:'999'}}),f.assignment(5,{lifecycle:'UNFLAGGED'}),f.assignment(5,{unitNumber:'Helios 090'},{mode:'source_label_correction'})];
 for(const op of invalid)await assert.rejects(()=>f.call({operations:[f.assignment(2),op],apply:true}),JSON.stringify(op));
 assert.deepEqual(await f.snapshot(),initial);assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.scoped_batches')).rows[0].n,0);
 const rows=f.records.concat(f.rows);rows.at(-1).binding.canonicalKey='SPOTTER:28.1';await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[rows]);await assert.rejects(()=>f.call({operations:[f.assignment(0,{unitNumber:'Spotter 028.1'},{mode:'source_label_correction'})]}),/collision/);
 rows.at(-1).binding=null;rows.at(-1).unitNumber='Spotter 28.1 HDC4';await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[rows]);
 await assert.rejects(()=>f.call({operations:[f.assignment(0,{unitNumber:'Spotter 028.1'},{mode:'source_label_correction'})]}),/collision/);
 rows.at(-1).unitNumber='Helios 090';await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[rows]);
 await f.db.query("update app_private.vision_tracker_locations set customer='Concurrent edit' where id=$1",[f.rows[0].binding.trackerId]);
 await assert.rejects(()=>f.call({operations:[f.assignment(0,{unitNumber:'Spotter 028.1'},{mode:'source_label_correction'})]}),/graph changed/);
 }finally{await f.db.close();}
});
test('Helios retains DO NOT USE; exact company aliases require reviewed company ID',async()=>{
 const f=await setup();try{
 for(const category of ['Spotter','Spotter HD','Spotter HDC2','Spotter HDC4']){
  f.rows[1].category=category;
  await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[f.records.concat(f.rows)]);
  assert.equal((await f.call({operations:[f.assignment(1)]})).applied,false);
 }
 for(const customer of ['Cameras Onsite LLC','Cameras Onsite','Cameras OnSite','Cameras On Site'])assert.equal((await f.call({operations:[f.assignment(5,{customer,customerId:'11',placement:'SHOP'})]})).applied,false);
 await f.call({operations:[f.assignment(5,{customer:'Cameras On Site',customerId:'11',placement:'SHOP'})],apply:true});assert.equal((await f.snapshot()).records.at(-1).lifecycle,'DO_NOT_USE');
 }finally{await f.db.close();}
});


test('assignment uses source time; intervening Owner corrections beat later batch preparation',async()=>{
 const f=await setup();try{
 const sourceAt='2026-01-02T00:00:00Z',ownerAt='2026-01-02T12:00:00Z',preparedAt='2026-01-03T00:00:00Z';
 const op=f.assignment(1,{customer:'Synthetic School',customerId:'13',placement:'FIELD'});
 await f.call({operations:[op],evidence:{...f.evidence,receivedAt:preparedAt},apply:true});
 const upload=await f.snapshot();assert.equal(upload.records[4].scopedAuthority.receivedAt,sourceAt);
 const unit={id:f.rows[1].binding.trackerId,unitNumber:'Spotter 263',placement:'SHOP',currentLocationType:'shop',placementSource:'owner',placementUpdatedAt:ownerAt,customer:'Owner correction'};
 const result=projectMhelpUploadPlacement({items:[],inventoryItems:[unit]},upload,[],undefined,Date.parse('2026-01-04T00:00:00Z'));
 assert.equal(result.snapshot.inventoryItems[0].placement,'SHOP');assert.equal(result.snapshot.inventoryItems[0].customer,'Owner correction');
 assert.equal(result.snapshot.uploadInventory.records.find(r=>r.productId===f.rows[1].productId).overlayApplied,false);
 }finally{await f.db.close();}
});

test('label-only evidence preserves base and existing scoped assignment authority; Owner wins',async()=>{
 for(const priorAssignment of [false,true]){
  const f=await setup();try{
   let old=f.rows[0],revision=0;
   if(priorAssignment){
    await f.call({operations:[f.assignment(0)],apply:true});revision=1;
    old=(await f.db.query('select records from cos_mhelp_placement_private.scoped_batches')).rows[0].records[3];
   }
   const before=structuredClone(old),preparedAt='2026-01-04T00:00:00Z';
   await f.call({revision,requestId:'66666666-6666-4666-8666-666666666666',evidence:{...f.evidence,receivedAt:preparedAt},operations:[{...f.assignment(0,{unitNumber:'Spotter 028.1'},{mode:'source_label_correction'}),expectedRecord:old,authority:{...f.authority,receivedAt:'2026-01-03T00:00:00Z'}}],apply:true});
   const upload=await f.snapshot(),changed=upload.records[3];
   assert.equal(changed.unitNumber,'Spotter 028.1');assert.deepEqual(changed.scopedAuthority,before.scopedAuthority);assert.deepEqual(changed.assignmentAuthority,before.assignmentAuthority);
   const unit={id:old.binding.trackerId,unitNumber:'Spotter 028.1',placement:'SHOP',currentLocationType:'shop',placementSource:'owner',placementUpdatedAt:'2026-01-02T12:00:00Z',customer:'Owner correction'};
   const result=projectMhelpUploadPlacement({items:[],inventoryItems:[unit]},upload,[],undefined,Date.parse('2026-01-05T00:00:00Z'));
   assert.equal(result.snapshot.inventoryItems[0].placement,'SHOP');assert.equal(result.snapshot.inventoryItems[0].customer,'Owner correction');
   assert.equal(result.snapshot.uploadInventory.records.find(r=>r.productId===old.productId).overlayApplied,false);
  }finally{await f.db.close();}
 }
});
