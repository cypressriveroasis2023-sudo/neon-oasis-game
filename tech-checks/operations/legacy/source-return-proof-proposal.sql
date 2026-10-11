-- RECONSTRUCTED LOCAL PROPOSAL. Depends on the separately reviewed team foundation.
-- No public API/grants in this checkpoint. No historical rows are adopted.
begin;
create table if not exists cos_mhelp_intake.source_returns_v1(
 return_id uuid primary key,work_order_id uuid not null references cos_mhelp_intake.work_orders(id),
 membership_id uuid not null references cos_mhelp_intake.participants(id),assignment_id uuid not null,
 actor_id uuid not null,request_id uuid not null,request jsonb not null,
 identity jsonb not null,photo_paths text[] not null check(cardinality(photo_paths) between 1 and 20),
 objects jsonb not null,source_scope jsonb not null,creation_authority jsonb not null,
 created_at timestamptz not null default now(),unique(actor_id,request_id)
);
alter table cos_mhelp_intake.source_returns_v1 enable row level security;
revoke all on cos_mhelp_intake.source_returns_v1 from public,anon,authenticated,service_role;
create or replace function cos_mhelp_intake.immutable_source_return_v1() returns trigger
language plpgsql set search_path=pg_catalog as $$begin raise exception 'source_return_provenance_is_immutable';end$$;
revoke all on function cos_mhelp_intake.immutable_source_return_v1() from public,anon,authenticated,service_role;
create trigger source_returns_immutable before update or delete on cos_mhelp_intake.source_returns_v1
 for each row execute function cos_mhelp_intake.immutable_source_return_v1();

create or replace function cos_mhelp_intake.return_identity_v1(r public.unit_returns) returns jsonb
language sql immutable set search_path=pg_catalog as $$select jsonb_build_object(
 'return_id',r.id,'ticket_no',r.ticket_no,'equipment_type',r.equipment_type,'unit_tag',r.unit_tag,
 'prep_ticket_id',r.prep_ticket_id,'prep_item_id',r.prep_item_id,'service_tech_id',r.service_tech_id,
 'service_tech_name',r.service_tech_name,'returned_at',r.returned_at,'created_at',r.created_at,
 'return_notes',r.return_notes,'return_photo_paths',r.return_photo_paths,
 'tag_scan_status',r.tag_scan_status,'tag_scan_detected',r.tag_scan_detected,'tag_scan_expected',r.tag_scan_expected,
 'tag_scan_confidence',r.tag_scan_confidence,'tag_scan_engine',r.tag_scan_engine,'tag_scan_at',r.tag_scan_at)$$;
revoke all on function cos_mhelp_intake.return_identity_v1(public.unit_returns) from public,anon,authenticated,service_role;

create or replace function cos_mhelp_intake.assert_return_storage_index_v1() returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if not exists(select 1 from pg_index i join pg_class idx on idx.oid=i.indexrelid
  join pg_class tbl on tbl.oid=i.indrelid join pg_namespace ns on ns.oid=tbl.relnamespace
  join pg_attribute a on a.attrelid=tbl.oid and a.attnum=i.indkey[0]
  join pg_attribute b on b.attrelid=tbl.oid and b.attnum=i.indkey[1]
  join pg_collation c on c.oid=i.indcollation[1]
  where ns.nspname='storage' and tbl.relname='objects' and idx.relname='idx_objects_current_version'
   and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts=2 and i.indnatts=2
   and a.attname='bucket_id' and b.attname='name' and c.collname='C'
   and replace(replace(pg_get_expr(i.indpred,i.indrelid),'(',''),')','')='archived_at IS NULL')
 then raise exception 'source_return_current_object_uniqueness_unverified';end if;
end$$;
revoke all on function cos_mhelp_intake.assert_return_storage_index_v1() from public,anon,authenticated,service_role;

create or replace function cos_mhelp_intake.return_objects_v1(p_paths text[],p_actor uuid,p_lock boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare path text;o storage.objects%rowtype;result jsonb:='[]'::jsonb;
begin
 perform cos_mhelp_intake.assert_return_storage_index_v1();
 if p_actor is null or coalesce(cardinality(p_paths),0) not between 1 and 20
  or exists(select 1 from unnest(p_paths) x group by x having count(*)>1) then raise exception 'source_return_exact_photos_required';end if;
 foreach path in array p_paths loop
  if path is null or split_part(path,'/',1)<>p_actor::text or path like '%..%' or path like '%//%' or length(path)>1024 then raise exception 'source_return_photo_path_invalid';end if;
  if p_lock then
   select * into strict o from storage.objects where bucket_id='handoff-evidence' and name collate "C"=path collate "C" and archived_at is null for share nowait;
  else
   select * into strict o from storage.objects where bucket_id='handoff-evidence' and name collate "C"=path collate "C" and archived_at is null;
  end if;
  if coalesce(o.owner_id,o.owner::text) is distinct from p_actor::text or o.is_delete_marker
   or coalesce(o.metadata->>'size','')!~'^[0-9]+$' or (o.metadata->>'size')::numeric<=0
   or coalesce(o.metadata->>'mimetype','')!~'^image/(jpeg|png|webp|heic|heif)$'
  then raise exception 'source_return_current_object_invalid';end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',o.id,'bucket_id',o.bucket_id,'name',o.name,
   'owner',o.owner,'owner_id',o.owner_id,'created_at',o.created_at,'updated_at',o.updated_at,
   'version',o.version,'metadata',o.metadata,'is_delete_marker',o.is_delete_marker));
 end loop;
 return result;
end$$;
revoke all on function cos_mhelp_intake.return_objects_v1(text[],uuid,boolean) from public,anon,authenticated,service_role;

create or replace function cos_mhelp_intake.return_scope_v1(p_work_order uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('source_scope_revision',w.source_scope_revision,'source_scope_snapshot',w.source_scope_snapshot,'installation_scope_revision',w.installation_scope_revision,
  'installation_scope_snapshot',w.installation_scope_snapshot) from cos_mhelp_intake.work_orders w where w.id=p_work_order
$$;
revoke all on function cos_mhelp_intake.return_scope_v1(uuid) from public,anon,authenticated,service_role;

create or replace function cos_mhelp_intake.source_return_set_v1(p_work_order uuid,p_lock boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare w cos_mhelp_intake.work_orders%rowtype;b cos_mhelp_intake.source_returns_v1%rowtype;
 r public.unit_returns%rowtype;proof jsonb:='[]';intake jsonb:='[]';scope jsonb;objects jsonb;
begin
 if p_lock then
  select * into strict w from cos_mhelp_intake.work_orders where id=p_work_order for update;
  perform cos_mhelp_intake.fence_assignments_v1();
 else select * into strict w from cos_mhelp_intake.work_orders where id=p_work_order;end if;
 scope:=cos_mhelp_intake.return_scope_v1(w.id);
 for b in select * from cos_mhelp_intake.source_returns_v1 where work_order_id=w.id order by return_id loop
  if p_lock then select * into r from public.unit_returns where id=b.return_id for share nowait;
  else select * into r from public.unit_returns where id=b.return_id;end if;
  if not found or cos_mhelp_intake.return_identity_v1(r) is distinct from b.identity or b.source_scope is distinct from scope
  then raise exception 'source_return_physical_proof_stale';end if;
  objects:=cos_mhelp_intake.return_objects_v1(b.photo_paths,b.actor_id,p_lock);
  if objects is distinct from b.objects then raise exception 'source_return_object_proof_stale';end if;
  -- Creation-time authorized physical contributions survive later crew changes.
  -- Current member/profile checks belong only to new writes and exact replay.
  proof:=proof||jsonb_build_array(jsonb_build_object('return_id',b.return_id,'membership_id',b.membership_id,
   'actor_id',b.actor_id,'assignment_id',b.assignment_id,'identity',b.identity,'photos',to_jsonb(b.photo_paths),
   'objects',b.objects,'creation_authority',b.creation_authority,'source_scope',b.source_scope));
  intake:=intake||jsonb_build_array(jsonb_build_object('return_id',r.id,'status',r.status,'it_tech_id',r.it_tech_id,
   'it_tech_name',r.it_tech_name,'it_received_at',r.it_received_at,'intake_photo_paths',r.intake_photo_paths,
   'damage_notes',r.damage_notes,'mhelp_inventory_confirmed',r.mhelp_inventory_confirmed,'completed_at',r.completed_at));
 end loop;
 return jsonb_build_object('contract','source_return_set_v1','work_order_id',w.id,
  'installation_scope_revision',w.installation_scope_revision,'source_scope',scope,'returns',proof,'intake',intake);
end$$;
revoke all on function cos_mhelp_intake.source_return_set_v1(uuid,boolean) from public,anon,authenticated,service_role;
commit;
