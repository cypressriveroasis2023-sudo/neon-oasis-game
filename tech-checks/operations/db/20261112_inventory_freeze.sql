-- COS-owned inventory copy: the freeze record (Tech Check Platform). NOT INSTALLED.
--
-- James's direction 2026-11-12: COS keeps one exact, approved copy of the mHelp
-- inventory as its own unit list; after that only people change it. A freeze
-- names one admitted census by fingerprint, with its real mHelp read time and who
-- accepted it. The read time is copied from the census and never refreshed.
--
-- Adds one append-only table, two functions and one guard trigger on
-- upload_control (the only change to an existing object): while a freeze is in
-- force the active census cannot be switched, so a stray import fails closed with
-- a clear message instead of silently replacing the approved copy.
begin;

create table cos_mhelp_placement_private.inventory_freeze_log(
 id uuid primary key,
 seq bigint generated always as identity unique,
 organization_id uuid not null,
 action text not null check(action in('freeze','unfreeze')),
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),
 source_read_at timestamptz not null,
 record_count integer not null check(record_count between 1 and 10000),
 field_count integer not null check(field_count>=0),
 shop_count integer not null check(shop_count>=0),
 accepted_by uuid not null,
 accepted_by_name text not null check(btrim(accepted_by_name)<>'' and length(accepted_by_name)<=120),
 reason text not null check(btrim(reason)<>'' and length(reason)<=500),
 -- The COS-kept A# -> public IP list, copied once from the tracker when the freeze
 -- is approved. From then on IPs change only through cos_inventory_ip_edit_v1.
 ip_census jsonb,
 recorded_at timestamptz not null default clock_timestamp(),
 check(field_count+shop_count=record_count),
 check((action='freeze')=(ip_census is not null))
);
create table cos_mhelp_placement_private.inventory_ip_edit_log(
 id uuid primary key,
 seq bigint generated always as identity unique,
 organization_id uuid not null,
 freeze_id uuid not null references cos_mhelp_placement_private.inventory_freeze_log(id),
 product_id text not null check(product_id~'^[1-9][0-9]{0,14}$'),
 old_ip text,
 new_ip text,
 edited_by uuid not null,
 edited_by_name text not null check(btrim(edited_by_name)<>'' and length(edited_by_name)<=120),
 reason text not null check(btrim(reason)<>'' and length(reason)<=500),
 recorded_at timestamptz not null default clock_timestamp(),
 check(old_ip is distinct from new_ip)
);
create index inventory_ip_edit_log_current on cos_mhelp_placement_private.inventory_ip_edit_log(freeze_id,product_id,seq desc);
alter table cos_mhelp_placement_private.inventory_ip_edit_log enable row level security;
revoke all on cos_mhelp_placement_private.inventory_ip_edit_log from public,anon,authenticated,service_role;
revoke all on sequence cos_mhelp_placement_private.inventory_ip_edit_log_seq_seq from public,anon,authenticated,service_role;
alter table cos_mhelp_placement_private.inventory_freeze_log enable row level security;
revoke all on cos_mhelp_placement_private.inventory_freeze_log from public,anon,authenticated,service_role;
revoke all on sequence cos_mhelp_placement_private.inventory_freeze_log_seq_seq from public,anon,authenticated,service_role;

create function cos_mhelp_placement_private.inventory_freeze_immutable() returns trigger language plpgsql as $$
begin raise exception 'Inventory freeze history is append-only' using errcode='PT409'; end$$;
create trigger inventory_freeze_log_no_change before update or delete on cos_mhelp_placement_private.inventory_freeze_log
 for each row execute function cos_mhelp_placement_private.inventory_freeze_immutable();
create trigger inventory_freeze_log_no_truncate before truncate on cos_mhelp_placement_private.inventory_freeze_log
 for each statement execute function cos_mhelp_placement_private.inventory_freeze_immutable();
create trigger inventory_ip_edit_log_no_change before update or delete on cos_mhelp_placement_private.inventory_ip_edit_log
 for each row execute function cos_mhelp_placement_private.inventory_freeze_immutable();
create trigger inventory_ip_edit_log_no_truncate before truncate on cos_mhelp_placement_private.inventory_ip_edit_log
 for each statement execute function cos_mhelp_placement_private.inventory_freeze_immutable();

-- The IP list as it stands: the approved copy with each A#'s latest hand edit applied.
-- Only publicIp changes; holds and placements stay exactly as approved.
create function cos_mhelp_placement_private.inventory_ip_census_current(f cos_mhelp_placement_private.inventory_freeze_log)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_set(f.ip_census,'{records}',coalesce((select jsonb_agg(
   case when e.product_id is null then r.value else jsonb_set(r.value,'{publicIp}',coalesce(to_jsonb(e.new_ip),'null'::jsonb)) end order by r.ord)
  from jsonb_array_elements(f.ip_census->'records') with ordinality r(value,ord)
  left join lateral (select x.product_id,x.new_ip from cos_mhelp_placement_private.inventory_ip_edit_log x
   where x.freeze_id=f.id and x.product_id=r.value->>'productId' order by x.seq desc limit 1) e on true),'[]'::jsonb))
$$;

-- The freeze in force, if any: the latest entry, when it is a freeze.
create function cos_mhelp_placement_private.inventory_freeze_current(p_organization_id uuid)
returns cos_mhelp_placement_private.inventory_freeze_log language sql stable security definer set search_path='' as $$
 select l from cos_mhelp_placement_private.inventory_freeze_log l
 where l.organization_id=p_organization_id and l.action='freeze'
  and l.seq=(select max(x.seq) from cos_mhelp_placement_private.inventory_freeze_log x where x.organization_id=p_organization_id)
$$;

-- While frozen, the approved census stays the active one.
create function cos_mhelp_placement_private.inventory_freeze_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare f cos_mhelp_placement_private.inventory_freeze_log;
begin
 select * into f from cos_mhelp_placement_private.inventory_freeze_log l where l.action='freeze'
  and l.seq=(select max(x.seq) from cos_mhelp_placement_private.inventory_freeze_log x where x.organization_id=l.organization_id) limit 1;
 if found and (tg_op='DELETE' or new.active_sha256 is distinct from f.source_sha256) then
  raise exception 'COS inventory is frozen on the approved copy; unfreeze before loading a different mHelp census' using errcode='PT409';
 end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
create trigger upload_control_inventory_freeze_guard before update or delete on cos_mhelp_placement_private.upload_control
 for each row execute function cos_mhelp_placement_private.inventory_freeze_guard();

-- What the app reads on every board build. Cheap: one indexed row.
create function public.cos_inventory_freeze_state_v1(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f cos_mhelp_placement_private.inventory_freeze_log;
begin
 f:=cos_mhelp_placement_private.inventory_freeze_current(p_organization_id);
 if f.id is null then return jsonb_build_object('contract','COS_INVENTORY_FREEZE_STATE_V1','state','none'); end if;
 return jsonb_build_object('contract','COS_INVENTORY_FREEZE_STATE_V1','state','frozen','freeze',jsonb_build_object(
  'contract','COS_INVENTORY_FREEZE_V1','sourceSha256',f.source_sha256,'sourceReadAt',to_char(f.source_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'acceptedAt',to_char(f.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'acceptedBy',f.accepted_by_name,
  'recordCount',f.record_count,'fieldCount',f.field_count,'shopCount',f.shop_count),
  'ipCensus',cos_mhelp_placement_private.inventory_ip_census_current(f),
  'ipEdits',(select jsonb_build_object('count',count(*),'lastAt',to_char(max(e.recorded_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    from cos_mhelp_placement_private.inventory_ip_edit_log e where e.freeze_id=f.id));
end$$;

-- Owner only. Freeze: the Owner names the exact census (fingerprint and counts)
-- they were shown; it must be the complete, reviewed, active one. Unfreeze: a new entry.
create function public.cos_inventory_freeze_v1(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b cos_mhelp_placement_private.upload_batches; f cos_mhelp_placement_private.inventory_freeze_log; seen cos_mhelp_placement_private.inventory_freeze_log;
 n integer; nf integer; read_at timestamptz; who text; why text; ip_census jsonb;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 who:=btrim(coalesce(p_payload->>'acceptedByName','')); why:=btrim(coalesce(p_payload->>'reason',''));
 if p_request_id is null or p_action is null or p_action not in('freeze','unfreeze') or jsonb_typeof(p_payload) is distinct from 'object'
  or who='' or length(who)>120 or why='' or length(why)>500 then
  raise exception 'Inventory freeze request is incomplete' using errcode='PT409'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cos_inventory_freeze',0));
 select * into seen from cos_mhelp_placement_private.inventory_freeze_log where id=p_request_id;
 if found then
  if seen.action=p_action and seen.organization_id=p_organization_id and seen.accepted_by=p_actor_user_id and seen.accepted_by_name=who and seen.reason=why
   and (p_action='unfreeze' or seen.source_sha256=p_payload->>'sourceSha256') then
   return jsonb_build_object('contract','COS_INVENTORY_FREEZE_RESULT_V1','id',seen.id,'applied',false,'repeat',true); end if;
  raise exception 'Request id was already used for a different change' using errcode='PT409';
 end if;
 f:=cos_mhelp_placement_private.inventory_freeze_current(p_organization_id);
 if p_action='unfreeze' then
  if f.id is null then raise exception 'COS inventory is not frozen' using errcode='PT409'; end if;
  insert into cos_mhelp_placement_private.inventory_freeze_log(id,organization_id,action,source_sha256,source_read_at,record_count,field_count,shop_count,accepted_by,accepted_by_name,reason)
   values(p_request_id,p_organization_id,'unfreeze',f.source_sha256,f.source_read_at,f.record_count,f.field_count,f.shop_count,p_actor_user_id,who,why);
  return jsonb_build_object('contract','COS_INVENTORY_FREEZE_RESULT_V1','id',p_request_id,'applied',true,'repeat',false);
 end if;
 if f.id is not null then raise exception 'COS inventory is already frozen; unfreeze first' using errcode='PT409'; end if;
 select ub.* into b from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches ub on ub.source_sha256=c.active_sha256 where c.singleton for update of c;
 if not found or b.source_sha256 is distinct from p_payload->>'sourceSha256' then
  raise exception 'The census shown for approval is no longer the active one; review the current census' using errcode='PT409'; end if;
 if b.receipt->>'complete' is distinct from 'true' or b.receipt->>'reviewed' is distinct from 'true' or jsonb_typeof(b.records) is distinct from 'array' then
  raise exception 'Only a complete, reviewed census can be frozen' using errcode='PT409'; end if;
 n:=jsonb_array_length(b.records);
 select count(*) into nf from jsonb_array_elements(b.records) x where x->>'placement'='FIELD';
 if n is distinct from (b.receipt->>'recordCount')::integer or exists(select 1 from jsonb_array_elements(b.records) x where coalesce(x->>'placement','') not in('FIELD','SHOP'))
  or n is distinct from (p_payload->>'recordCount')::integer or nf is distinct from (p_payload->>'fieldCount')::integer or n-nf is distinct from (p_payload->>'shopCount')::integer then
  raise exception 'The census totals do not match the totals approved' using errcode='PT409'; end if;
 begin read_at:=(b.receipt->>'receivedAt')::timestamptz; exception when others then read_at:=null; end;
 if read_at is null or read_at>clock_timestamp()+interval '1 minute' then
  raise exception 'The census has no usable mHelp read time' using errcode='PT409'; end if;
 -- Every A# in the census appears once, so an IP list can be keyed by it.
 if (select count(distinct x->>'productId') from jsonb_array_elements(b.records) x)<>n then
  raise exception 'The census lists an A# more than once; it cannot be frozen' using errcode='PT409'; end if;
 -- The IP list approved with it: tied to this census and listing exactly its A#s, each once.
 -- The Owner may accept the unit list WITHOUT the IPs. The list is then seeded empty and
 -- marked seeded=false, so no reader can read "not copied in yet" as "this A# has no IP".
 -- Copying the real IPs in is a separate, recorded step.
 if p_payload ? 'ipCensus' then
  if jsonb_typeof(p_payload->'ipCensus') is distinct from 'object' or jsonb_typeof(p_payload->'ipCensus'->'records') is distinct from 'array'
   or p_payload->'ipCensus'->>'expectedMhelpSourceSha256' is distinct from b.source_sha256
   or jsonb_array_length(p_payload->'ipCensus'->'records')<>n
   or (select count(distinct r->>'productId') from jsonb_array_elements(p_payload->'ipCensus'->'records') r)<>n
   or exists(select 1 from jsonb_array_elements(p_payload->'ipCensus'->'records') r
      where not exists(select 1 from jsonb_array_elements(b.records) x where x->>'productId'=r->>'productId')
       or not(jsonb_typeof(r->'publicIp') in('string','null'))) then
   raise exception 'The IP list does not match the census being approved' using errcode='PT409'; end if;
  ip_census:=jsonb_set(p_payload->'ipCensus','{seeded}','true'::jsonb);
 else
  ip_census:=jsonb_build_object('expectedMhelpSourceSha256',b.source_sha256,'seeded','false'::jsonb,
   'records',coalesce((select jsonb_agg(jsonb_build_object('productId',x->>'productId','publicIp','null'::jsonb) order by x->>'productId')
     from jsonb_array_elements(b.records) x),'[]'::jsonb));
 end if;
 insert into cos_mhelp_placement_private.inventory_freeze_log(id,organization_id,action,source_sha256,source_read_at,record_count,field_count,shop_count,accepted_by,accepted_by_name,reason,ip_census)
  values(p_request_id,p_organization_id,'freeze',b.source_sha256,read_at,n,nf,n-nf,p_actor_user_id,who,why,ip_census);
 return jsonb_build_object('contract','COS_INVENTORY_FREEZE_RESULT_V1','id',p_request_id,'applied',true,'repeat',false);
end$$;

-- One hand edit of one A#'s public IP. Owner or verified IT (the existing fleet check,
-- read level). The editor states the IP they saw, so two people cannot overwrite each
-- other unseen, and an IP already held by another A# is refused.
create function public.cos_inventory_ip_edit_v1(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f cos_mhelp_placement_private.inventory_freeze_log; seen cos_mhelp_placement_private.inventory_ip_edit_log; cur jsonb; rec jsonb;
 pid text; old_ip text; new_ip text; who text; why text; holder text;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'IP edit is incomplete' using errcode='PT409'; end if;
 pid:=p_payload->>'productId'; old_ip:=nullif(btrim(coalesce(p_payload->>'expectedOldIp','')),''); new_ip:=nullif(btrim(coalesce(p_payload->>'newIp','')),'');
 who:=btrim(coalesce(p_payload->>'editedByName','')); why:=btrim(coalesce(p_payload->>'reason',''));
 if pid is null or pid!~'^[1-9][0-9]{0,14}$' or who='' or length(who)>120 or why='' or length(why)>500
  or not(p_payload ? 'expectedOldIp') or not(p_payload ? 'newIp') then raise exception 'IP edit is incomplete' using errcode='PT409'; end if;
 if new_ip is not null then
  if new_ip!~'^([0-9]{1,3}\.){3}[0-9]{1,3}$' then raise exception 'Enter a public IPv4 address' using errcode='PT409'; end if;
  begin
   if host(new_ip::inet)<>new_ip or new_ip::inet<<=any(array['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','127.0.0.0/8','169.254.0.0/16','100.64.0.0/10','0.0.0.0/8','224.0.0.0/3']::inet[]) then
    raise exception 'Enter a public IPv4 address' using errcode='PT409'; end if;
  exception when invalid_text_representation then raise exception 'Enter a public IPv4 address' using errcode='PT409'; end;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('cos_inventory_freeze',0));
 select * into seen from cos_mhelp_placement_private.inventory_ip_edit_log where id=p_request_id;
 if found then
  if seen.organization_id=p_organization_id and seen.product_id=pid and seen.old_ip is not distinct from old_ip and seen.new_ip is not distinct from new_ip
   and seen.edited_by=p_actor_user_id and seen.edited_by_name=who and seen.reason=why then
   return jsonb_build_object('contract','COS_INVENTORY_IP_EDIT_RESULT_V1','id',seen.id,'applied',false,'repeat',true); end if;
  raise exception 'Request id was already used for a different change' using errcode='PT409';
 end if;
 f:=cos_mhelp_placement_private.inventory_freeze_current(p_organization_id);
 if f.id is null then raise exception 'COS inventory is not frozen; IPs are edited on the approved COS copy' using errcode='PT409'; end if;
 cur:=cos_mhelp_placement_private.inventory_ip_census_current(f);
 select r into rec from jsonb_array_elements(cur->'records') r where r->>'productId'=pid;
 if rec is null then raise exception 'That A# is not in the approved COS inventory' using errcode='PT409'; end if;
 if rec->>'publicIp' is distinct from old_ip then raise exception 'The IP changed since you opened it; reload and review' using errcode='PT409'; end if;
 if new_ip is not distinct from old_ip then raise exception 'That is already the saved IP' using errcode='PT409'; end if;
 if new_ip is not null then
  select r->>'productId' into holder from jsonb_array_elements(cur->'records') r where r->>'publicIp'=new_ip and r->>'productId'<>pid limit 1;
  if holder is not null then raise exception 'A# % already has that IP; correct that record first',holder using errcode='PT409'; end if;
 end if;
 insert into cos_mhelp_placement_private.inventory_ip_edit_log(id,organization_id,freeze_id,product_id,old_ip,new_ip,edited_by,edited_by_name,reason)
  values(p_request_id,p_organization_id,f.id,pid,old_ip,new_ip,p_actor_user_id,who,why);
 return jsonb_build_object('contract','COS_INVENTORY_IP_EDIT_RESULT_V1','id',p_request_id,'applied',true,'repeat',false);
end$$;

revoke all on function public.cos_inventory_ip_edit_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function cos_mhelp_placement_private.inventory_ip_census_current(cos_mhelp_placement_private.inventory_freeze_log) from public,anon,authenticated,service_role;
grant execute on function public.cos_inventory_ip_edit_v1(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.cos_inventory_freeze_state_v1(uuid) from public,anon,authenticated;
revoke all on function public.cos_inventory_freeze_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function cos_mhelp_placement_private.inventory_freeze_current(uuid) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_placement_private.inventory_freeze_guard() from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_placement_private.inventory_freeze_immutable() from public,anon,authenticated,service_role;
grant execute on function public.cos_inventory_freeze_state_v1(uuid) to service_role;
grant execute on function public.cos_inventory_freeze_v1(uuid,uuid,uuid,text,jsonb) to service_role;

commit;
