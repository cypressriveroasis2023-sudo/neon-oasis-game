// Synthetic status/dispatch fixtures; no equipment/customer or Vault values.
export const statusFixture=`
create table cos_mhelp_placement_private.live_inventory_control(singleton boolean primary key,enabled boolean,last_attempt_at timestamptz,last_success_at timestamptz,error_code text);
insert into cos_mhelp_placement_private.live_inventory_control values(true,true,null,null,null);
create table cos_mhelp_placement_private.inventory_read_lease(singleton boolean primary key,lease_until timestamptz);
insert into cos_mhelp_placement_private.inventory_read_lease values(true,null);
create function public.cos_mhelp_inventory_read_lease(p_action text,p_lease uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 -- Respect the durable vendor cooldown.
 return jsonb_build_object('allowed',true);end$$;
create function public.cos_mhelp_placement_from_inventory() returns jsonb language plpgsql security definer set search_path='' as $$declare ctl cos_mhelp_placement_private.live_inventory_control;begin
 select * into ctl from cos_mhelp_placement_private.live_inventory_control where singleton;
 if not ctl.enabled then return jsonb_build_object('handled',false);end if;
 return jsonb_build_object('handled',true,'state','synthetic_test_only');end$$;
create function public.cos_mhelp_placement_status() returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('contract','COS_MHELP_PLACEMENT_V1','sheetsPublisher',false,'links',0)$$;
revoke all on function public.cos_mhelp_inventory_read_lease(text,uuid),public.cos_mhelp_placement_from_inventory(),public.cos_mhelp_placement_status() from public,anon,authenticated;
grant execute on function public.cos_mhelp_inventory_read_lease(text,uuid),public.cos_mhelp_placement_from_inventory(),public.cos_mhelp_placement_status() to service_role;
`;
