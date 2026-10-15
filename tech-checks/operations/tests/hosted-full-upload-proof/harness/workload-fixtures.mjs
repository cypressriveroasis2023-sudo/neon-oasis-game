import assert from 'node:assert/strict';
// Generated payload/graph enrichment only. No production rows or schemas.
export async function addContinuity({admin,readSnapshot,t,n,sha}){
 const source=(await admin.query('select * from cos_mhelp_placement_private.upload_batches order by source_sha256 limit 1')).rows[0];
 const request='99999999-9999-4999-8999-999999999991';
 await admin.query(`insert into cos_mhelp_placement_private.source_admissions(request_id,source_sha256,payload_sha256,input_sha256,authorization_sha256,records,before_guards,after_sources,created_at) values($1,$2,$3,$4,$4,'[]','[]','[]','2026-01-01T12:00:00Z')`,[request,source.source_sha256,source.payload_sha256,sha]);
 for(const step of [1,2]){
  for(let i=1;i<=32;i++){
   const original=source.records[i-1].binding.expectedGuard;
   const before=(await admin.query('select cos_mhelp_placement_private.continuity_graph($1,$2) value',[t(i),n(i)])).rows[0].value;
   await admin.query('insert into public.equipment_unit_location_history values($1,$2)',[n(i),'Synthetic continuity step '+step]);
   await admin.query(`insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256,created_at)
    select $1,'admit',$2,$3,$4,$5,$6,encode(sha256(convert_to($7::jsonb::text,'UTF8')),'hex'),cos_mhelp_placement_private.upload_binding_guard($4,$5),$7::jsonb,cos_mhelp_placement_private.continuity_graph($4,$5),$8,'2026-01-01T12:00:00Z'`,[request,source.source_sha256,source.payload_sha256,t(i),n(i),original,JSON.stringify(before),sha]);
  }
 }
 const result=await readSnapshot();assert(!result.outcome.error);for(let i=0;i<32;i++)assert.equal(result.outcome.value.upload.records[i].binding.guardCurrent,true,'Latest matching successful continuity head');
 return {rows:64,identities:32,headsPerIdentity:2,successful:true,generatedDirectly:true,admissionWriteWorkflowNotClaimed:true};
}
export async function widenFixture({admin,n,t,org,sha}){
 await admin.query(`update app_private.vision_tracker_locations set customer=repeat('Synthetic customer ',8),site=repeat('Synthetic site ',12),address=repeat('Synthetic address ',45);
 insert into public.equipment_unit_location_history select id,repeat('Synthetic historical detail ',24)||i::text from public.equipment_units cross join generate_series(1,3) i;
 insert into app_private.cos_owner_identity_claims select id,repeat('Synthetic Owner claim ',24)||i::text from public.equipment_units cross join generate_series(1,3) i;`);
 await admin.query("update app_private.cos_geocode_sources set street=left(repeat('Synthetic long street ',12),250),city=left(repeat('Synthetic city ',8),100)");
 for(let i=1;i<=32;i++)for(const side of [0,1])await admin.query(`insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256,recorded_at)
 values($1,$2,$3,$4,$5,$6,$6,$7,$7,'2026-01-01T12:00:00Z')`,[org,side?n(i):n(900+i),side?n(950+i):n(i),side?t(i):t(900+i),side?t(950+i):t(i),JSON.stringify({syntheticDetail:'Synthetic archive detail '.repeat(20)}),sha]);
 // Refresh synthetic reviewed guards after deliberate width/history enrichment.
 const batches=(await admin.query('select source_sha256,records,receipt from cos_mhelp_placement_private.upload_batches')).rows;
 for(const batch of batches){for(const record of batch.records){record.customer='Synthetic customer '.repeat(12);record.sourceAddress={street:'Synthetic street '.repeat(12),city:'Synthetic city '.repeat(6),state:'TX',zip:'77001'};record.syntheticGeneratedDetail='Synthetic full-width record detail '.repeat(12);}
 for(const record of batch.receipt.trackerRecords)record.syntheticGeneratedDetail='Synthetic tracker detail '.repeat(12);
 for(const record of [...batch.records,...batch.receipt.trackerRecords]){const b=record.binding;if(b&&b.trackerId){b.expectedGuard=(await admin.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) value',[b.trackerId,b.nativeUnitId??null])).rows[0].value;}}
 await admin.query('update cos_mhelp_placement_private.upload_batches set records=$1,receipt=$2 where source_sha256=$3',[JSON.stringify(batch.records),JSON.stringify(batch.receipt),batch.source_sha256]);}
 await admin.query("update cos_mhelp_placement_private.upload_batches set payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',records)::text,'UTF8')),'hex')");
 await admin.query('analyze');
}
