import {test} from 'node:test';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {assignmentPostgres} from './fixtures/assignment-postgres.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {setup,installActualReview,actor,org,previous,censusSha,stage,commit} from './mhelp-owner-staging-fixture.mjs';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
import {prepareOwnerAssignmentReviewSql} from '../scripts/prepareOwnerAssignmentReviewSql.mjs';
const ids=['2226860','2300344','2229407','2229931','2233383'];
const labels=['Spotter 261HDC2','Solar Spotter 054','Solar Spotter 008','Solar Stand 015','Solar Spotter 013'];
const note='I confirm these exact existing identities and the proposed assignments.';
async function fixture(){
 const db=await setup(process.env.COS_ASSIGNMENT_POSTGRES_CI==='1'?assignmentPostgres():undefined);
 await db.exec(schema.slice(schema.indexOf(' create table '),schema.indexOf(' create function ')));
 await db.exec("alter table public.equipment_units add column model_id uuid,add column sim text,add column ip text; create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,full_label text,observation jsonb,observed_at timestamptz);create table app_private.cos_fleet_shop_moves(id uuid,organization_id uuid,unit_id uuid,unit_number text,model_id uuid,created_at timestamptz,source_bindings jsonb);");
 await db.exec('drop function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)');
 const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
 await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.upload_binding_guard('),overlay.indexOf('create function cos_mhelp_placement_private.review_upload(')));
 await installActualReview(db);
 const old=[],rows=[],trackers=[];
 for(let i=0;i<5;i++){
  const tracker=randomUUID(),native=i===3?null:randomUUID();
  await db.query("insert into app_private.vision_tracker_locations values($1,$2,$3,$3,'synthetic','FIELD','Old customer','Old site','Old address',null,null)",[tracker,org,labels[i]]);
  if(native)await db.query("insert into public.equipment_units(id,organization_id,unit_number,status,sim,ip) values($1,$2,$3,'available','preserved-sim','192.0.2.1')",[native,org,labels[i]]);
  const guard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g',[tracker,native])).rows[0].g;
  const binding={productId:ids[i],fullLabel:labels[i],trackerId:tracker,trackerLabel:labels[i],nativeUnitId:native,nativeLabel:native?labels[i]:null,matchMethod:'reviewed_product_id',representedUnitIds:[native||tracker],representationEvidenceSha256:previous,evidenceSha256:previous,expectedGuard:guard};
  await db.query('insert into cos_mhelp_placement_private.links values($1,$2,$3,$4,null,null)',[ids[i],tracker,native,labels[i]]);
  const row={productId:ids[i],unitNumber:labels[i],category:i===3?'Solar Stand':'Camera',customerId:'100',customer:'Old customer',placement:i===4?'SHOP':'FIELD',lifecycle:'UNFLAGGED',sourceRow:i+2,sourceAddress:{street:'Old',city:'Houston',state:'TX',zip:'77064'}};
  old.push({...row,binding});rows.push({...row,customerId:i===4?'300':'200',customer:i===4?'New customer: New site':'Cameras OnSite',placement:i===4?'FIELD':'SHOP',sourceAddress:{...row.sourceAddress,street:i===4?'New field address':'Known shop address'}});
  trackers.push({recordId:'tracker:'+ids[i],matchedProductId:ids[i],unitNumber:labels[i],binding:{state:'linked',trackerId:tracker,trackerLabel:labels[i],nativeUnitId:native,nativeLabel:native?labels[i]:null,expectedGuard:guard,unitIds:[native||tracker],unitLabels:{[tracker]:labels[i],...(native?{[native]:labels[i]}:{})},representedUnitIds:[native||tracker]}});
  if(i<2){await db.query("insert into app_private.cos_fleet_shop_moves values($1,$2,$3,$4,null,now(),$5)",[randomUUID(),org,native,labels[i],JSON.stringify([{productId:ids[i],sourceSha256:previous,sourceUnitNumber:labels[i]}])]);await db.query("update public.equipment_units set current_location_type='shop' where id=$1",[native]);await db.query('insert into public.equipment_unit_location_history values($1)',[native]);}
 }
 const receipt={contract:'COS_MHELP_API_V1',reviewed:true,complete:true,origin:'mhelpdesk_api',portalId:'224643',sourceSha256:previous,recordCount:5,trackerRecords:trackers};
 await db.query('update cos_mhelp_placement_private.upload_batches set records=$1,receipt=$2 where source_sha256=$3',[JSON.stringify(old),JSON.stringify(receipt),previous]);
 const defs={};for(const n of ['public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)','public.cos_owner_mhelp_equipment_commit_v1(uuid,uuid,uuid,text,text,text)'])defs[n]=(await db.query('select pg_get_functiondef($1::regprocedure) d',[n])).rows[0].d;
 await db.exec(await prepareOwnerAssignmentReviewSql(defs));
 const bytes=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n'+rows.map(r=>[r.productId,r.unitNumber,r.customerId,r.customer,r.category,r.sourceAddress.street,'Houston','TX','77064'].join(',')).join('\n')+'\n');
 const sha=createHash('sha256').update(bytes).digest('hex'),id=randomUUID();
 await stage(db,[actor,org,id,'ServiceItem_List_20261020172623.csv',sha,previous,censusSha,JSON.stringify(rows.map(r=>({productId:r.productId,unitLabel:r.unitNumber,family:r.category,placement:r.placement,customer:r.customer}))),bytes.toString('base64'),JSON.stringify(rows)]);
 const read=()=>db.query("select public.cos_owner_mhelp_assignment_review_v1($1,$2,$3,$4,$5) r",[actor,org,id,sha,censusSha]).then(r=>r.rows[0].r);
 const approve=(digest,noteValue=note)=>db.query("select public.cos_owner_mhelp_assignment_review_v1($1,$2,$3,$4,$5,'approve',$6,$7) r",[actor,org,id,sha,censusSha,digest,noteValue]).then(r=>r.rows[0].r);
 const protectedState=async()=>{const result={};for(const table of ['public.equipment_units','app_private.vision_tracker_locations','public.equipment_unit_location_history','cos_mhelp_placement_private.links','app_private.cos_fleet_shop_moves'])result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') r from ${table} t`)).rows[0].r;return result;};
 return {db,id,sha,read,approve,old,rows,protectedState};
}
test('five exact assignments retain identities, recorded Shop moves and tracker-only equipment; commit replay does not duplicate writes',async()=>{
 const f=await fixture();try{
  const before=await f.protectedState(),view=await f.read();assert.equal(view.items.length,5);assert.equal(view.items.filter(i=>i.guardChanged).length,2);assert.ok(view.items.every(i=>i.eligible));
  assert.equal(view.items.find(i=>i.productId==='2229931').identity.nativeUnitId,null);
  await assert.rejects(commit(f.db,f.id),/assignment review required/);
  assert.equal((await f.approve(view.reviewDigest)).approved,true);assert.equal((await f.approve(view.reviewDigest)).idempotent,true);
  await assert.rejects(f.approve(view.reviewDigest,note+' changed'),/Conflicting/);
  const saved=await commit(f.db,f.id);assert.equal(saved.applied,true);assert.equal((await commit(f.db,f.id)).idempotent,true);
  const records=(await f.db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[f.sha])).rows[0].records;
  for(const row of records){const old=f.old.find(o=>o.productId===row.productId);assert.equal(row.binding.nativeUnitId,old.binding.nativeUnitId);assert.equal(row.binding.trackerId,old.binding.trackerId);assert.notEqual(row.placementHeld,true);}
  const batch=(await f.db.query('select * from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[f.sha])).rows[0];
  const upload={...batch.receipt,payloadSha256:batch.payload_sha256,records:records.map(r=>({...r,binding:{...r.binding,guardCurrent:true}}))};
  const inventoryItems=records.map(r=>({id:r.binding.representedUnitIds[0],unitNumber:r.binding.nativeLabel||r.binding.trackerLabel,placement:'FIELD',customer:'Old customer',site:'Old site',hasUnitGps:false,latitude:null,longitude:null,health:'unverified'}));
  const projection=projectMhelpUploadPlacement({items:inventoryItems,inventoryItems},upload,[]).snapshot;
  assert.equal(projection.uploadInventory.summary.linkedRecords,5);assert.equal(projection.uploadInventory.summary.heldRecords,0);assert.equal(projection.uploadInventory.summary.appliedRecords,5);
  assert.equal(projection.items.length,1);assert.equal(projection.items[0].uploadProductId,'2233383');assert.equal(projection.items[0].customer,'New customer: New site');assert.equal(projection.items[0].latitude,null);assert.equal(projection.items[0].hasUnitGps,false);assert.equal(projection.items[0].health,'unverified');assert.equal(projection.items[0].uploadSourceAddress.street,'New field address');
  assert.deepEqual(await f.protectedState(),before);assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,1);
 }finally{await f.db.close();}
});
for(const change of ['native identity','tracker assignment','source conflict','receipt changed','census','scoped'])test(`concurrent ${change} rejects stale approval or commit atomically`,async()=>{
 const f=await fixture();try{const view=await f.read();await f.approve(view.reviewDigest);
  if(change==='native identity')await f.db.query("update public.equipment_units set unit_number='Changed identity' where id=$1",[f.old[0].binding.nativeUnitId]);
  if(change==='tracker assignment')await f.db.query("update app_private.vision_tracker_locations set site='Newer edit' where id=$1",[f.old[2].binding.trackerId]);
  if(change==='source conflict')await f.db.query("insert into app_private.cos_geocode_sources(tracker_id,product_id,active) values($1,'999',true)",[f.old[3].binding.trackerId]);
  if(change==='receipt changed')await f.db.exec("update app_private.cos_fleet_shop_moves set source_bindings='[]'");
  if(change==='scoped')await f.db.query('insert into cos_mhelp_placement_private.scoped_control values($1,1,null)',[previous]);
  await assert.rejects(commit(f.db,f.id,note,change==='census'?'e'.repeat(64):censusSha));
  assert.equal((await f.db.query('select active_sha256 a from cos_mhelp_placement_private.upload_control')).rows[0].a,previous);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,0);
 }finally{await f.db.close();}
});
for(const scenario of ['changed before approval','partial failure','lifecycle restriction','wrong actor','source bytes'])test(`assignment review preserves all-or-nothing protection: ${scenario}`,async()=>{
 const f=await fixture();try{
  const view=await f.read();
  if(scenario==='changed before approval')await f.db.query("update app_private.vision_tracker_locations set address='Concurrent edit' where id=$1",[f.old[4].binding.trackerId]);
  if(scenario==='partial failure')await f.db.exec('delete from cos_mhelp_placement_private.links where equipment_id=\'2233383\'');
  if(scenario==='lifecycle restriction')await f.db.query("update public.equipment_units set status='retired' where id=$1",[f.old[2].binding.nativeUnitId]);
  if(scenario==='source bytes')await f.db.query("update cos_mhelp_placement_private.owner_equipment_stages set source_bytes=convert_to('changed','UTF8') where id=$1",[f.id]);
  if(scenario==='wrong actor')await assert.rejects(f.db.query("select public.cos_owner_mhelp_assignment_review_v1($1,$2,$3,$4,$5)",[randomUUID(),org,f.id,f.sha,censusSha]));
  else await assert.rejects(f.approve(view.reviewDigest));
  const stored=(await f.db.query('select records,review_receipt from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[f.id])).rows[0];
  assert.ok(stored.records.every(r=>r.binding===null));assert.equal(stored.review_receipt.assignmentReview,undefined);
  assert.equal((await f.db.query('select active_sha256 a from cos_mhelp_placement_private.upload_control')).rows[0].a,previous);
 }finally{await f.db.close();}
});

test('stale Shop guard with another protected location or identity claim cannot be approved',async()=>{
 const f=await fixture();try{await f.db.query('update public.equipment_units set gps_latitude=30 where id=$1',[f.old[0].binding.nativeUnitId]);const view=await f.read();assert.equal(view.items.find(i=>i.productId==='2226860').eligible,false);await assert.rejects(f.approve(view.reviewDigest));}finally{await f.db.close();}
});
test('failure after stage update rolls back the entire approval',async()=>{
 const f=await fixture();try{const view=await f.read();await f.db.exec("create function app_private.synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic late failure';end $$;create trigger assignment_failure after update on cos_mhelp_placement_private.owner_equipment_stages for each row execute function app_private.synthetic_failure()");await assert.rejects(f.approve(view.reviewDigest),/synthetic late failure/);const row=(await f.db.query('select records,review_receipt from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[f.id])).rows[0];assert.ok(row.records.every(r=>r.binding===null));assert.equal(row.review_receipt.assignmentReview,undefined);}finally{await f.db.close();}
});
