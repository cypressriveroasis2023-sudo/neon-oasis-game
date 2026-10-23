import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {fixture} from './fixtures/publisher-review-fixture.mjs';
const cell=s=>({entered:{stringValue:s},validation:null,rich:false}),sha='a'.repeat(64),auth='c'.repeat(64);
async function setup(){
 const db=await fixture();await db.exec(`create schema cos_operational_private;create table cos_operational_private.current_placements(product_id text primary key);create table cos_mhelp_placement_private.live_inventory_control(singleton boolean,enabled boolean,error_code text,active_source_sha256 text);create table cos_mhelp_placement_private.live_inventory_candidates(source_sha256 text primary key,records jsonb);`);
 const observation={equipmentId:'123',state:'confirmed',customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'Synthetic Job'};
 await db.query('update cos_mhelp_placement_private.links set observation=$1,observed_at=clock_timestamp()',[observation]);
 await db.query('insert into cos_mhelp_placement_private.live_inventory_control values(true,true,null,$1)',[sha]);await db.query('insert into cos_mhelp_placement_private.live_inventory_candidates values($1,$2)',[sha,[{productId:'123',holdReason:null}]]);
 await db.exec(await readFile(new URL('../db/mhelp-publisher-reviewed-bindings.sql',import.meta.url),'utf8'));
 const before={sheetId:2017346590,row:2,label:'Spotter 023.1',cells:['Spotter 023.1','FIELD','Synthetic Builder','Synthetic Job'].map(cell),customerStyle:'plain'};
 const after={...before,row:3,customerStyle:'combined',cells:['Spotter 023.1','FIELD','Synthetic Builder: Synthetic Job','Synthetic Job'].map(cell)};
 return {db,item:{equipmentId:'123',before,after,observation}};
}
const repair=async(db,items,id=auth)=>(await db.query('select cos_sheets_placement_private.repair_bindings($1,$2,clock_timestamp(),$3) n',[Array.isArray(items)?items:[items],sha,id])).rows[0].n;
test('reviewed repair is atomic, audited, guarded against replay and preserves native data; stage accepts exact combined customer',async()=>{
 const {db,item}=await setup();try{
 const native=(await db.query('select to_jsonb(t) v from app_private.vision_tracker_locations t')).rows;
 assert.equal(await repair(db,item),1);assert.equal((await db.query('select count(*) n from cos_sheets_placement_private.binding_reviews')).rows[0].n,1);
 assert.deepEqual((await db.query('select to_jsonb(t) v from app_private.vision_tracker_locations t')).rows,native);await assert.rejects(()=>repair(db,item),/changed/);
 await db.exec('update cos_sheets_placement_private.control set enabled=true');const start=(await db.query('select public.cos_sheets_placement_begin() v')).rows[0].v;assert.equal(start.bindings[0].customerStyle,'combined');
 const intent={equipmentId:'123',observation:item.observation,cells:item.after.cells};assert.equal((await db.query('select public.cos_sheets_placement_stage($1,$2) v',[start.leaseId,[intent]])).rows[0].v.committed,true);
 intent.cells=structuredClone(intent.cells);intent.cells[2]=cell('Wrong Builder: Synthetic Job');await assert.rejects(()=>db.query('select public.cos_sheets_placement_stage($1,$2)',[start.leaseId,[intent]]));
 }finally{await db.close();}
});
test('stale evidence, source holds, native edits, pending writes, changed metadata and unprivileged callers reject without partial update',async()=>{
 const {db,item}=await setup();try{
 for(const [setup,undo] of [
 ["update cos_mhelp_placement_private.links set observed_at=clock_timestamp()-interval '21 minutes'","update cos_mhelp_placement_private.links set observed_at=clock_timestamp()"],
 ["update cos_mhelp_placement_private.live_inventory_candidates set records='[{\"productId\":\"123\",\"holdReason\":\"Owner review\"}]'","update cos_mhelp_placement_private.live_inventory_candidates set records='[{\"productId\":\"123\",\"holdReason\":null}]'"],
 ["update app_private.vision_tracker_locations set site='Manual job'","update app_private.vision_tracker_locations set site='Synthetic Job'"],
 ["update cos_sheets_placement_private.bindings set pending_cells=baseline_cells","update cos_sheets_placement_private.bindings set pending_cells=null"],
 ["update cos_sheets_placement_private.control set lease_until=clock_timestamp()+interval '1 minute'","update cos_sheets_placement_private.control set lease_until=null"]]){await db.exec(setup);await assert.rejects(()=>repair(db,item));await db.exec(undo);}
 const changed=structuredClone(item);changed.after.cells[1].validation={condition:{type:'BOOLEAN'}};await assert.rejects(()=>repair(db,changed),/metadata/);
 await assert.rejects(()=>db.query("select cos_sheets_placement_private.repair_bindings($1,$2,clock_timestamp()-interval '3 minutes',$3)",[[item],sha,auth]),/expired/);
 assert.equal((await db.query('select row_number from cos_sheets_placement_private.bindings')).rows[0].row_number,2);assert.equal((await db.query('select count(*) n from cos_sheets_placement_private.binding_reviews')).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>repair(db,item));await db.exec('reset role');}
 }finally{await db.close();}
});
test('occupied destination fails closed and rolls back audit',async()=>{
 const {db,item}=await setup();try{
 await db.exec(`insert into cos_mhelp_placement_private.links select (jsonb_populate_record(null::cos_mhelp_placement_private.links,to_jsonb(l)||'{"equipment_id":"456","tracker_id":"44444444-4444-4444-8444-444444444444"}'::jsonb)).* from cos_mhelp_placement_private.links l where equipment_id='123';
 insert into cos_sheets_placement_private.bindings(equipment_id,sheet_id,row_number,sheet_label,baseline_cells,authorization_sha256) select '456',sheet_id,3,'Retained Unit',baseline_cells,authorization_sha256 from cos_sheets_placement_private.bindings where equipment_id='123';`);
 await assert.rejects(()=>repair(db,item),/occupied/);assert.equal((await db.query('select count(*) n from cos_sheets_placement_private.binding_reviews')).rows[0].n,0);
 assert.equal((await db.query("select row_number from cos_sheets_placement_private.bindings where equipment_id='123'")).rows[0].row_number,2);
 }finally{await db.close();}
});

test('vacant-ended row chains apply in safe order; cyclic proposals roll back completely',async()=>{
 for(const cycle of [false,true]){
 const {db,item}=await setup();try{
 const id='44444444-4444-4444-8444-444444444444';
 await db.query(`insert into app_private.vision_tracker_locations select (jsonb_populate_record(null::app_private.vision_tracker_locations,to_jsonb(t)||jsonb_build_object('id',$1::text,'unit_number','Second Unit','unit_key','secondunit'))).* from app_private.vision_tracker_locations t`,[id]);
 await db.query(`insert into app_private.cos_geocode_sources select (jsonb_populate_record(null::app_private.cos_geocode_sources,to_jsonb(t)||jsonb_build_object('tracker_id',$1::text,'native_unit_id',$1::text,'product_id','456','unit_number','Second Unit','tracker_unit_number','Second Unit'))).* from app_private.cos_geocode_sources t`,[id]);
 const g=(await db.query('select cos_mhelp_placement_private.guard($1,null) v',[id])).rows[0].v;
 const obs={...item.observation,equipmentId:'456'};
 await db.query(`insert into cos_mhelp_placement_private.links select (jsonb_populate_record(null::cos_mhelp_placement_private.links,to_jsonb(l)||jsonb_build_object('equipment_id','456','tracker_id',$1::text,'baseline_guard',$2::text,'observation',$3::jsonb))).* from cos_mhelp_placement_private.links l where equipment_id='123'`,[id,g,obs]);
 const second={equipmentId:'456',before:{...item.before,row:3,label:'Second Unit',cells:['Second Unit','FIELD','Synthetic Builder','Synthetic Job'].map(cell)},after:{...item.after,row:cycle?2:4,label:'Second Unit',cells:['Second Unit','FIELD','Synthetic Builder: Synthetic Job','Synthetic Job'].map(cell)},observation:obs};
 await db.query(`insert into cos_sheets_placement_private.bindings(equipment_id,sheet_id,row_number,sheet_label,baseline_cells,authorization_sha256) values('456',2017346590,3,'Second Unit',$1,$2)`,[second.before.cells,sha]);
 await db.exec(`update cos_mhelp_placement_private.live_inventory_candidates set records=records||'[{"productId":"456","holdReason":null}]'::jsonb`);
 if(cycle){await assert.rejects(()=>repair(db,[item,second]),/cyclic/);assert.equal((await db.query('select count(*) n from cos_sheets_placement_private.binding_reviews')).rows[0].n,0);}
 else {assert.equal(await repair(db,[item,second]),2);assert.deepEqual((await db.query('select row_number from cos_sheets_placement_private.bindings order by equipment_id')).rows.map(x=>x.row_number),[3,4]);}
 }finally{await db.close();}
 }
});
