-- Add shared display timing while preserving existing selections and revision checks.
begin;
alter table app_private.cos_tv_board_settings add column if not exists rotation_seconds integer not null default 15 check(rotation_seconds between 5 and 300);
alter table app_private.cos_tv_board_settings_history add column if not exists rotation_seconds integer not null default 15 check(rotation_seconds between 5 and 300);

create or replace function public.cos_tv_board_settings_snapshot(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v app_private.cos_tv_board_settings;
begin
 perform app_private.cos_tv_board_assert_owner(p_actor_user_id,p_organization_id);
 select * into v from app_private.cos_tv_board_settings where organization_id=p_organization_id;
 if not found then return jsonb_build_object('sections',array['today','pickup','swap','delivery','service','shop','camera','map'],'revision',0,'updatedAt',null,'rotationSeconds',15); end if;
 return jsonb_build_object('sections',v.sections,'revision',v.revision,'updatedAt',v.updated_at,'rotationSeconds',v.rotation_seconds);
end $$;

create or replace function public.cos_tv_board_settings_save_v2(p_actor_user_id uuid,p_organization_id uuid,p_sections text[],p_expected_revision integer,p_rotation_seconds integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_revision integer;v_time timestamptz=clock_timestamp();
begin
 perform app_private.cos_tv_board_assert_owner(p_actor_user_id,p_organization_id);
 if p_sections is null or array_position(p_sections,null) is not null or cardinality(p_sections)>9
 or not (p_sections <@ array['today','pickup','swap','delivery','service','shop','readiness','camera','map']::text[])
 or cardinality(p_sections)<>(select count(distinct x) from unnest(p_sections) x)
 or p_expected_revision is null or p_expected_revision<0
 or p_rotation_seconds is null or p_rotation_seconds not between 5 and 300
 then raise exception 'Invalid TV settings.' using errcode='22023';end if;
 insert into app_private.cos_tv_board_settings(organization_id) values(p_organization_id) on conflict do nothing;
 select revision into v_revision from app_private.cos_tv_board_settings where organization_id=p_organization_id for update;
 if v_revision<>p_expected_revision then raise exception 'TV settings changed on another computer. Refresh before saving.' using errcode='40001';end if;
 update app_private.cos_tv_board_settings set sections=p_sections,rotation_seconds=p_rotation_seconds,revision=revision+1,updated_at=v_time,updated_by=p_actor_user_id where organization_id=p_organization_id;
 insert into app_private.cos_tv_board_settings_history(organization_id,revision,sections,updated_at,updated_by,rotation_seconds)
 values(p_organization_id,v_revision+1,p_sections,v_time,p_actor_user_id,p_rotation_seconds);
 return public.cos_tv_board_settings_snapshot(p_actor_user_id,p_organization_id);
end $$;
revoke all on function public.cos_tv_board_settings_save_v2(uuid,uuid,text[],integer,integer) from public,anon,authenticated;
grant execute on function public.cos_tv_board_settings_save_v2(uuid,uuid,text[],integer,integer) to service_role;

-- Already-open browsers keep using their existing four-argument save.
create or replace function public.cos_tv_board_settings_save(p_actor_user_id uuid,p_organization_id uuid,p_sections text[],p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_seconds integer;
begin
 perform app_private.cos_tv_board_assert_owner(p_actor_user_id,p_organization_id);
 select rotation_seconds into v_seconds from app_private.cos_tv_board_settings where organization_id=p_organization_id;
 return public.cos_tv_board_settings_save_v2(p_actor_user_id,p_organization_id,p_sections,p_expected_revision,coalesce(v_seconds,15));
end $$;
revoke all on function public.cos_tv_board_settings_snapshot(uuid,uuid),public.cos_tv_board_settings_save(uuid,uuid,text[],integer) from public,anon,authenticated;
grant execute on function public.cos_tv_board_settings_snapshot(uuid,uuid),public.cos_tv_board_settings_save(uuid,uuid,text[],integer) to service_role;
notify pgrst,'reload schema';
commit;
