-- Read-only. Run before the install. Confirms the live objects the install reads have the
-- shape it expects, that nothing it creates already exists, and whether each of the two
-- approvals would pass its guards right now. It writes nothing.
with cols as (select table_schema s,table_name t,column_name c,data_type d from information_schema.columns),
 need(s,t,c,d) as (values ('public','equipment_units','id','uuid'),('public','equipment_units','organization_id','uuid'),('public','equipment_units','unit_number','text'),
  ('public','equipment_units','status',null),('public','equipment_units','retired_at',null),
  ('cos_mhelp_placement_private','upload_control','singleton','boolean'),('cos_mhelp_placement_private','upload_control','active_sha256','text'),
  ('cos_mhelp_placement_private','links','equipment_id','text'),('cos_mhelp_placement_private','links','tracker_id','uuid'),('cos_mhelp_placement_private','links','native_unit_id','uuid'),
  ('app_private','cos_owner_identity_claims','native_unit_id','uuid'),('app_private','cos_owner_identity_claims','product_association','jsonb')),
 missing as (select n.s||'.'||n.t||'.'||n.c x from need n where not exists(select 1 from cols where cols.s=n.s and cols.t=n.t and cols.c=n.c and (n.d is null or cols.d=n.d))),
 recs as (select cos_mhelp_placement_private.scoped_records(active_sha256) r from cos_mhelp_placement_private.upload_control where singleton),
 want(product_id,unit_id,mhelp_label,cos_label) as (values ('2232677','0d3a6038-b645-4c62-913d-479783c34f6f'::uuid,'Solar Spotter 012','Solar Spotter 012HDC2'),
  ('2221820','e2fb7468-b4bf-4b4a-97a1-6248f7c144e4'::uuid,'Spotter 028.1 HDC4S - SOLAR COMPATIBLE','Spotter 028.1HDC4S'))
select jsonb_build_object(
 'missingColumns',(select coalesce(jsonb_agg(x),'[]'::jsonb) from missing),
 'scopedRecordsReturnsJsonb',to_regprocedure('cos_mhelp_placement_private.scoped_records(text)') is not null and (select jsonb_typeof(r)='array' from recs),
 'ownerAssertExists',to_regprocedure('app_private.cos_owner_identity_assert_actor(uuid,uuid,boolean)') is not null,
 'rolesExist',(select count(*)=3 from pg_roles where rolname in('anon','authenticated','service_role')),
 'nothingToCreateAlreadyExists',to_regclass('app_private.cos_owner_product_links') is null and not exists(select 1 from pg_proc where proname like 'cos_owner_product_link%'),
 'uploadBatchesTriggers',(select count(*) from pg_trigger where not tgisinternal and tgrelid='cos_mhelp_placement_private.upload_batches'::regclass),
 'approvals',(select jsonb_agg(jsonb_build_object('productId',w.product_id,
   'cosRecordOk',exists(select 1 from public.equipment_units u where u.id=w.unit_id and u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and u.unit_number=w.cos_label and to_jsonb(u)->>'status' not in('retired','decommissioned','deleted','stolen') and to_jsonb(u)->>'retired_at' is null),
   'mhelpRecordOk',(select count(*)=1 and bool_and(x->>'lifecycle'='UNFLAGGED' and coalesce(x->'binding','null'::jsonb)='null'::jsonb and lower(regexp_replace(x->>'unitNumber','\s+$',''))=lower(regexp_replace(w.mhelp_label,'\s+$',''))
      and not coalesce((x->>'placementHeld')::boolean,false) and jsonb_array_length(coalesce(x->'possibleAliasUnitIds','[]'::jsonb))=0 and not x ? 'inventoryOnlyReason' and coalesce(x->'scopedAuthority','null'::jsonb)='null'::jsonb
      and (x->>'holdReason' is null or x->>'holdReason' in('Product ID identity label changed; confirm before linking','Prior reviewed scoped identity or assignment requires Owner installation review')))
     from recs, jsonb_array_elements(recs.r) x where x->>'productId'=w.product_id),
   'nothingElseClaimsIt',not exists(select 1 from recs, jsonb_array_elements(recs.r) x where x->>'productId'<>w.product_id and (x->'binding'->>'nativeUnitId'=w.unit_id::text or x->'binding'->>'trackerId'=w.unit_id::text or coalesce(x->'binding'->'representedUnitIds','[]'::jsonb) ? w.unit_id::text or coalesce(x->'possibleAliasUnitIds','[]'::jsonb) ? w.unit_id::text))
     and not exists(select 1 from cos_mhelp_placement_private.links l where l.equipment_id<>w.product_id and w.unit_id in(l.tracker_id,l.native_unit_id))
     and not exists(select 1 from app_private.cos_owner_identity_claims c where (c.native_unit_id=w.unit_id and c.product_association is not null and c.product_association->>'productId' is distinct from w.product_id) or (c.product_association->>'productId'=w.product_id and c.native_unit_id<>w.unit_id))
  ) order by w.product_id) from want w)) as precheck;
