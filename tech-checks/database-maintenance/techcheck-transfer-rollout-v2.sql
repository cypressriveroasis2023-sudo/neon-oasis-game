-- Additive release gate: install after techcheck-named-handoffs-v1.sql.
-- No feature activation, production inventory change or outbound request.
begin;
alter table app_private.techcheck_transfer_settings
 add column reports_ready boolean not null default false,
 add column receipt_link_ready boolean not null default false,
 add column custody_ready boolean not null default false;
-- These release attestations are deliberately false in the review migration.
-- They are not delivery results. Only a reviewed operator rollout may set them
-- after the adapter, signed daily linkage and global custody tests are complete.
create function app_private.techcheck_transfer_ready_v1() returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and reports_ready and receipt_link_ready and custody_ready
   from app_private.techcheck_transfer_settings where singleton),false)
 and to_regprocedure('public.techcheck_transfer_context_v1()') is not null
 and to_regprocedure('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is not null
 and exists(select 1 from storage.buckets where id='techcheck-transfer-evidence' and public=false
   and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg']::text[])
$$;
revoke all on function app_private.techcheck_transfer_ready_v1() from public,anon,authenticated,service_role;

-- Minimal, account-bound rollout probe. No equipment, SIMs or other users' data.
create function public.techcheck_transfer_readiness_v1() returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare v_role text:=app_private.techcheck_transfer_role(); v_settings jsonb;
begin
 if v_role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 select to_jsonb(s) into v_settings from app_private.techcheck_transfer_settings s where singleton;
 return jsonb_build_object('version',1,'actor_id',auth.uid(),'role',v_role,
   'ready',app_private.techcheck_transfer_ready_v1(),'enabled',coalesce((v_settings->>'enabled')::boolean,false),
   'dependencies',jsonb_build_object(
     'read',to_regprocedure('public.techcheck_transfer_context_v1()') is not null,
     'submit',to_regprocedure('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is not null,
     'privateEvidence',exists(select 1 from storage.buckets where id='techcheck-transfer-evidence' and public=false
       and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg']::text[])),
   'release',jsonb_build_object('reports',coalesce((v_settings->>'reports_ready')::boolean,false),
     'receiptLink',coalesce((v_settings->>'receipt_link_ready')::boolean,false),
     'custody',coalesce((v_settings->>'custody_ready')::boolean,false)));
end$$;
revoke all on function public.techcheck_transfer_readiness_v1() from public,anon;
grant execute on function public.techcheck_transfer_readiness_v1() to authenticated;


-- Keep the implemented core unchanged, but remove all direct client entry points.
alter function public.techcheck_transfer_context_v1() set schema app_private;
alter function app_private.techcheck_transfer_context_v1() rename to techcheck_transfer_context_core_v1;
revoke all on function app_private.techcheck_transfer_context_core_v1() from public,anon,authenticated,service_role;
alter function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) set schema app_private;
alter function app_private.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) rename to submit_techcheck_transfer_core_v1;
revoke all on function app_private.submit_techcheck_transfer_core_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create function public.techcheck_transfer_context_v1() returns jsonb
 language plpgsql stable security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if app_private.techcheck_transfer_ready_v1() is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 return app_private.techcheck_transfer_context_core_v1();
end$$;
revoke all on function public.techcheck_transfer_context_v1() from public,anon;
grant execute on function public.techcheck_transfer_context_v1() to authenticated;

create function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if app_private.techcheck_transfer_ready_v1() is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 return app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
end$$;
revoke all on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

create or replace function app_private.techcheck_transfer_file(p_name text,p_write boolean) returns boolean
 language sql stable security definer set search_path='' as $$
 select app_private.techcheck_transfer_ready_v1() and app_private.techcheck_transfer_role() is not null
 and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$'
 and case when p_write then split_part(p_name,'/',1)=auth.uid()::text and not exists(select 1 from app_private.techcheck_transfer_events e where e.id::text=split_part(p_name,'/',2))
 else split_part(p_name,'/',1)=auth.uid()::text or exists(select 1 from app_private.techcheck_transfer_events e join app_private.techcheck_transfers t on t.id=e.transfer_id where e.id::text=split_part(p_name,'/',2) and (app_private.techcheck_transfer_role()='it' or t.service_actor=auth.uid()) and exists(select 1 from jsonb_array_elements(e.photos) p where p->>'path'=p_name)) end
$$;
revoke all on function app_private.techcheck_transfer_file(text,boolean) from public,anon;
grant execute on function app_private.techcheck_transfer_file(text,boolean) to authenticated;
commit;
