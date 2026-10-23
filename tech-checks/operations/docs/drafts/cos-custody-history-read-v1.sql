-- REVIEW DRAFT ONLY. Not referenced by any production installer or frontend.
-- Target: existing legacy Tech Check project, after named handoffs / purpose v2.
-- Adds only one role-scoped READ RPC; no table, trigger, grant-on-table or data changes.
-- Production approval must cover this exact new authenticated execution surface.
begin;
create function public.techcheck_transfer_history_page_v1(
 p_after_id uuid default null,p_snapshot_token text default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text;v_token text;v_total bigint;v_pending bigint;v_rows jsonb;v_last uuid;v_more boolean;
begin
 v_role:=app_private.techcheck_transfer_role();
 if v_actor is null or v_role is null or v_role not in ('it','service') then raise exception 'Verified transfer role required' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>100 or (p_after_id is not null and p_snapshot_token is null) or (p_snapshot_token is not null and p_snapshot_token!~'^[a-f0-9]{64}$') then raise exception 'Invalid history page' using errcode='22023';end if;
 select count(*),count(*) filter(where t.state in ('awaiting_service','discrepancy')),
  encode(sha256(convert_to(coalesce(string_agg(t.id::text||':'||t.revision::text||':'||t.updated_at::text,',' order by t.id),''),'UTF8')),'hex')
 into v_total,v_pending,v_token from app_private.techcheck_transfers t where v_role='it' or t.service_actor=v_actor;
 if p_snapshot_token is not null and p_snapshot_token<>v_token then raise exception 'Handoff history changed; restart pagination' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'it_actor',t.it_actor,'service_actor',t.service_actor,'it_name',t.it_name,'service_name',t.service_name,'manifest',t.manifest,'state',t.state,'revision',t.revision,'created_at',t.created_at,'updated_at',t.updated_at) order by t.id),'[]')
 into v_rows from (select * from app_private.techcheck_transfers t where (v_role='it' or t.service_actor=v_actor) and (p_after_id is null or t.id>p_after_id) order by t.id limit p_limit)t;
 if jsonb_array_length(v_rows)>0 then v_last:=(v_rows->(jsonb_array_length(v_rows)-1)->>'id')::uuid;end if;
 select exists(select 1 from app_private.techcheck_transfers t where (v_role='it' or t.service_actor=v_actor) and v_last is not null and t.id>v_last) into v_more;
 return jsonb_build_object('contract','COS_CUSTODY_HISTORY_READ_V1','actor_id',v_actor,'role',v_role,
  'count_basis','role_scoped_handoffs_not_current_equipment_custody','total',v_total,'pending_count',v_pending,
  'snapshot_token',v_token,'items',v_rows,'next_after_id',case when v_more then v_last end,'complete',not v_more);
end$$;
revoke all on function public.techcheck_transfer_history_page_v1(uuid,text,integer) from public,anon,service_role;
grant execute on function public.techcheck_transfer_history_page_v1(uuid,text,integer) to authenticated;
commit;
