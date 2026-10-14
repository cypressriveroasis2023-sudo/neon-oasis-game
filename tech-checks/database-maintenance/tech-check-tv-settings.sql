-- Additive shared Owner TV settings. Existing jobs, checklists and permissions are unchanged.
begin;
grant usage on schema app_private to service_role;
create table if not exists app_private.cos_tv_board_settings (
 organization_id uuid primary key references public.organizations(id),
 sections text[] not null default array['today','pickup','swap','delivery','service','shop','camera','map'],
 revision integer not null default 0 check(revision>=0), updated_at timestamptz,
 updated_by uuid references auth.users(id),
 check(cardinality(sections)<=9 and sections <@ array['today','pickup','swap','delivery','service','shop','readiness','camera','map']::text[])
);
create table if not exists app_private.cos_tv_board_settings_history (
 organization_id uuid not null references public.organizations(id), revision integer not null,
 sections text[] not null, updated_at timestamptz not null,
 updated_by uuid not null references auth.users(id), primary key(organization_id,revision)
);
alter table app_private.cos_tv_board_settings enable row level security;
alter table app_private.cos_tv_board_settings_history enable row level security;
revoke all on app_private.cos_tv_board_settings,app_private.cos_tv_board_settings_history from public,anon,authenticated;
grant select,insert,update on app_private.cos_tv_board_settings to service_role;
grant insert on app_private.cos_tv_board_settings_history to service_role;

create or replace function app_private.cos_tv_board_assert_owner(p_actor uuid,p_org uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
 or not exists(select 1 from public.user_profiles p join public.user_roles ur on ur.user_id=p.user_id
 join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id
 join public.role_permissions rp on rp.role_id=r.id and rp.permission_code='job.override'
 where p.user_id=p_actor and p.organization_id=p_org and p.active and p.department='owner' and r.code='owner')
 then raise exception 'An active existing COS Owner is required.' using errcode='42501'; end if;
end $$;
revoke all on function app_private.cos_tv_board_assert_owner(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.cos_tv_board_assert_owner(uuid,uuid) to service_role;

create or replace function public.cos_tv_board_settings_snapshot(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v app_private.cos_tv_board_settings;
begin
 perform app_private.cos_tv_board_assert_owner(p_actor_user_id,p_organization_id);
 select * into v from app_private.cos_tv_board_settings where organization_id=p_organization_id;
 if not found then return jsonb_build_object('sections',array['today','pickup','swap','delivery','service','shop','camera','map'],'revision',0,'updatedAt',null); end if;
 return jsonb_build_object('sections',v.sections,'revision',v.revision,'updatedAt',v.updated_at);
end $$;

create or replace function public.cos_tv_board_settings_save(p_actor_user_id uuid,p_organization_id uuid,p_sections text[],p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_revision integer; v_time timestamptz=clock_timestamp();
begin
 perform app_private.cos_tv_board_assert_owner(p_actor_user_id,p_organization_id);
 if p_sections is null or array_position(p_sections,null) is not null or cardinality(p_sections)>9
 or not (p_sections <@ array['today','pickup','swap','delivery','service','shop','readiness','camera','map']::text[])
 or cardinality(p_sections)<>(select count(distinct x) from unnest(p_sections) x)
 or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid TV settings.' using errcode='22023'; end if;
 insert into app_private.cos_tv_board_settings(organization_id) values(p_organization_id) on conflict do nothing;
 select revision into v_revision from app_private.cos_tv_board_settings where organization_id=p_organization_id for update;
 if v_revision<>p_expected_revision then raise exception 'TV settings changed on another computer. Refresh before saving.' using errcode='PT409'; end if;
 update app_private.cos_tv_board_settings set sections=p_sections,revision=revision+1,updated_at=v_time,updated_by=p_actor_user_id where organization_id=p_organization_id;
 insert into app_private.cos_tv_board_settings_history values(p_organization_id,v_revision+1,p_sections,v_time,p_actor_user_id);
 return public.cos_tv_board_settings_snapshot(p_actor_user_id,p_organization_id);
end $$;
revoke all on function public.cos_tv_board_settings_snapshot(uuid,uuid),public.cos_tv_board_settings_save(uuid,uuid,text[],integer) from public,anon,authenticated;
grant execute on function public.cos_tv_board_settings_snapshot(uuid,uuid),public.cos_tv_board_settings_save(uuid,uuid,text[],integer) to service_role;
commit;
