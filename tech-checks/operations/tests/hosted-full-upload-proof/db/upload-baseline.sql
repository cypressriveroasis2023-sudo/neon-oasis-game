-- Read adapters only. Apply through the fingerprint-guarded rollout script.
-- Every current graph guard is still evaluated in this statement. No persistent cache.
create or replace function cos_mhelp_placement_private.upload_snapshot()
returns jsonb language sql stable set search_path='' as $$
 with active as materialized (
  select b.receipt,b.records,b.payload_sha256
  from cos_mhelp_placement_private.upload_control c
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  where c.singleton
 ), source_rows as materialized (
  select r,
   r->'binding' is not null and r->'binding'<>'null'::jsonb eligible,
   case when r->'binding' is not null and r->'binding'<>'null'::jsonb then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(a.records) r
 ), tracker_rows as materialized (
  select r,r->'binding'->>'state'='linked' eligible,
   case when (r->'binding'->>'state'='linked') is not false then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(coalesce(a.receipt->'trackerRecords','[]'::jsonb)) r
 ), bindings as materialized (
  select binding_key from source_rows where eligible
  union
  select binding_key from tracker_rows where eligible is not false
 ), current_guards as materialized (
  select b.*,cos_mhelp_placement_private.continuity_current((binding_key->>0)::uuid,(binding_key->>1)::uuid,binding_key->>2) guard_current
  from bindings b
 )
 select (a.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object(
  'trackerRecords',(
   select coalesce(jsonb_agg((s.r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object(
    'binding',((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',coalesce(s.eligible and g.guard_current,false)))
    order by s.r->>'recordId'),'[]'::jsonb)
   from tracker_rows s left join current_guards g
    on g.binding_key=s.binding_key
  ),'reviewed',true,'payloadSha256',a.payload_sha256,'records',(
   select jsonb_agg((s.r-'binding')||jsonb_build_object('binding',case when not s.eligible then 'null'::jsonb else
    ((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',g.guard_current) end)
    order by (s.r->>'sourceRow')::integer)
   from source_rows s left join current_guards g
    on g.binding_key=s.binding_key
  )) from active a
$$;
