-- Extend the existing authenticated route without replacing the deployed operations gateway.
-- Revisions below 1,000,000,000 retain the original section-save meaning.
-- Timing saves use BASE + actual_revision * 1000 + seconds; the actual revision
-- is decoded before the same locked compare-and-save and normal audit increment.
begin;
create or replace function public.cos_tv_board_settings_save(p_actor_user_id uuid,p_organization_id uuid,p_sections text[],p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_seconds integer;v_revision integer;v_payload integer;
begin
 perform app_private.cos_tv_board_assert_owner(p_actor_user_id,p_organization_id);
 if p_expected_revision>=1000000000 then
   v_payload:=p_expected_revision-1000000000;
   v_revision:=v_payload/1000;
   v_seconds:=v_payload%1000;
 else
   v_revision:=p_expected_revision;
   select rotation_seconds into v_seconds from app_private.cos_tv_board_settings where organization_id=p_organization_id;
   v_seconds:=coalesce(v_seconds,15);
 end if;
 return public.cos_tv_board_settings_save_v2(p_actor_user_id,p_organization_id,p_sections,v_revision,v_seconds);
end $$;
revoke all on function public.cos_tv_board_settings_save(uuid,uuid,text[],integer) from public,anon,authenticated;
grant execute on function public.cos_tv_board_settings_save(uuid,uuid,text[],integer) to service_role;
notify pgrst,'reload schema';
commit;
