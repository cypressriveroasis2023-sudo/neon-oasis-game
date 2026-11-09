import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../db/mhelp-publisher-current-assignment-proof.sql',import.meta.url),'utf8');
const definition=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
const oldDefinition=definition.replace(definition.slice(definition.indexOf('(p_link.observed_at'),definition.indexOf('\n AND cos_mhelp_placement_private.guard')),"p_link.observed_at>clock_timestamp()-interval '20 minutes'");
const at=new Date(Date.now()-2*3600000).toISOString();
const record=()=>({productId:'123',unitNumber:'Synthetic exact unit',customerId:'4',placement:'FIELD',lifecycle:'UNFLAGGED',holdReason:null,
 apiAssignment:{active:true,fullLabel:'Synthetic exact unit',serviceLocationId:'7',placementProof:{version:1,model:null,parentIsServiceLocation:false,parentActive:true,parentLabel:'Synthetic customer',serviceVerified:true,serviceActive:true,siteLabel:'Synthetic site'}},
 sourceDates:{apiCustomerObservedAt:at,apiAddressObservedAt:at,apiCategoryObservedAt:at}});
async function fixture(){
 const db=new PGlite();await db.exec(`create schema cos_sheets_placement_private;create schema cos_mhelp_placement_private;create schema cos_operational_private;
 create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,baseline_guard text,observation jsonb,observed_at timestamptz,full_label text,model text);
 create table cos_mhelp_placement_private.control(singleton boolean,enabled boolean,error_code text,last_success_at timestamptz);
 create table cos_mhelp_placement_private.live_inventory_control(singleton boolean,enabled boolean,error_code text,last_success_at timestamptz,active_source_sha256 text);
 create table cos_mhelp_placement_private.upload_control(singleton boolean,active_sha256 text);
 create table cos_mhelp_placement_private.upload_batches(source_sha256 text,records jsonb,receipt jsonb);
 create table cos_operational_private.current_placements(product_id text);
 create function cos_mhelp_placement_private.guard(uuid,uuid) returns text language sql as $$select 'synthetic-guard'::text$$;
 create function cos_mhelp_placement_private.resource_observed_at(jsonb) returns timestamptz language plpgsql as $$begin return ($1#>>'{}')::timestamptz;exception when others then return null;end$$;
 insert into cos_mhelp_placement_private.control values(true,true,null,clock_timestamp());
 insert into cos_mhelp_placement_private.live_inventory_control values(true,true,null,clock_timestamp(),'active');
 insert into cos_mhelp_placement_private.upload_control values(true,'active');`);
 await db.query(`insert into cos_mhelp_placement_private.links values('123',null,null,'synthetic-guard',$1,$2,'Synthetic exact unit',null)`,[{state:'confirmed',customerId:'4',serviceLocationId:'7',placement:'FIELD',customerLabel:'Synthetic customer',siteLabel:'Synthetic site'},at]);
 await db.query(`insert into cos_mhelp_placement_private.upload_batches values('active',$1,$2)`,[[record()],{contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',complete:true}]);
 await db.exec(oldDefinition);await db.exec(sql);return db;
}
const current=async db=>(await db.query('select cos_sheets_placement_private.source_current(l) value from cos_mhelp_placement_private.links l')).rows[0].value;
test('fresh complete assignment accepts separately dated two-hour metadata without changing observation clocks',async()=>{
 const db=await fixture();try{const before=(await db.query('select to_jsonb(l) data from cos_mhelp_placement_private.links l')).rows;
 assert.equal(await current(db),true);assert.deepEqual((await db.query('select to_jsonb(l) data from cos_mhelp_placement_private.links l')).rows,before);
 await assert.rejects(db.exec(sql),/drift/);
 }finally{await db.close();}
});
test('exact identity, assignment, lifecycle, metadata and duplicate safeguards survive the cached-metadata path',async()=>{
 const db=await fixture();try{
 const changes=[r=>r.productId='999',r=>r.holdReason='review',r=>r.lifecycle='DO_NOT_USE',r=>r.customerId='9',r=>r.placement='SHOP',r=>r.apiAssignment.active=false,r=>r.apiAssignment.fullLabel='Another variant',r=>r.apiAssignment.serviceLocationId='8',r=>r.apiAssignment.placementProof.model='Other',r=>r.apiAssignment.placementProof.version=2,r=>r.apiAssignment.placementProof.parentIsServiceLocation=true,r=>r.apiAssignment.placementProof.parentActive=false,r=>r.apiAssignment.placementProof.parentLabel='Another customer',r=>r.apiAssignment.placementProof.serviceVerified=false,r=>r.apiAssignment.placementProof.serviceActive=false,r=>r.apiAssignment.placementProof.siteLabel='Another site',r=>r.sourceDates.apiCustomerObservedAt='invalid',r=>r.sourceDates.apiCategoryObservedAt=new Date(Date.now()-4*3600000).toISOString(),r=>r.sourceDates.apiAddressObservedAt=new Date(Date.now()+120000).toISOString()];
 for(const change of changes){const r=record();change(r);await db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[[r]]);assert.equal(await current(db),false,String(change));}
 await db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[[record(),record()]]);assert.equal(await current(db),false);
 }finally{await db.close();}
});
test('paused, failed, stale, incomplete or superseded source and native overrides cannot grant publication',async()=>{
 const db=await fixture();try{
 const changes=["update cos_mhelp_placement_private.live_inventory_control set enabled=false","update cos_mhelp_placement_private.live_inventory_control set error_code='failed'","update cos_mhelp_placement_private.live_inventory_control set last_success_at=clock_timestamp()-interval '21 minutes'","update cos_mhelp_placement_private.upload_control set active_sha256='other'","update cos_mhelp_placement_private.upload_batches set receipt=receipt||'{\"complete\":false}'","update cos_mhelp_placement_private.upload_batches set receipt=receipt||'{\"origin\":\"manual\"}'","update cos_mhelp_placement_private.links set baseline_guard='changed'","update cos_mhelp_placement_private.control set enabled=false","update cos_mhelp_placement_private.control set last_success_at=clock_timestamp()-interval '21 minutes'","insert into cos_operational_private.current_placements values('123')"];
 for(const change of changes){await db.exec('begin');await db.exec(change);assert.equal(await current(db),false,change);await db.exec('rollback');}
 }finally{await db.close();}
});
test('existing fresh observation path remains compatible, while stale source cannot borrow cached timestamps',async()=>{
 const db=await fixture();try{await db.exec('delete from cos_mhelp_placement_private.live_inventory_control');assert.equal(await current(db),false);await db.exec('update cos_mhelp_placement_private.links set observed_at=clock_timestamp()');assert.equal(await current(db),true);await db.exec("update cos_mhelp_placement_private.control set error_code='failed'");assert.equal(await current(db),false);
 }finally{await db.close();}
});
