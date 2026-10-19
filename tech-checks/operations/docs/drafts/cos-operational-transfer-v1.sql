-- PR #226: Reviewed, NOT INSTALLED, Owner-controlled Field/Shop transfer kernel.
-- This migration is intentionally kept under docs/drafts. Do not deploy before
-- end-to-end COS projection and Google Sheets publication are independently verified.
-- No GPS, camera health, provider, external API, IP, SIM or native-unit writes.
create schema cos_operational_private;
revoke all on schema cos_operational_private from public,anon,authenticated,service_role;

create table cos_operational_private.current_placements (
  product_id text primary key check(product_id ~ '^[1-9][0-9]{0,14}$'),
  source_unit_number text not null,
  source_sha_at_move text not null check(source_sha_at_move ~ '^[a-f0-9]{64}$'),
  revision bigint not null default 0 check(revision >= 0),
  placement text not null check(placement in ('FIELD','SHOP')),
  customer text not null,
  site text not null,
  address text not null,
  last_request_id uuid not null unique,
  actor_id uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table cos_operational_private.events (
  request_id uuid primary key,
  actor_id uuid not null,
  product_id text not null check(product_id ~ '^[1-9][0-9]{0,14}$'),
  source_unit_number text not null,
  submitted jsonb not null,
  before_state jsonb not null,
  after_state jsonb not null,
  revision bigint not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create table cos_operational_private.sheet_outbox (
  request_id uuid primary key references cos_operational_private.events(request_id),
  product_id text not null,
  revision bigint not null,
  new_state jsonb not null,
  status text not null default 'pending' check(status in ('pending','published','conflict','failed')),
  attempts integer not null default 0 check(attempts >= 0),
  last_error_code text,
  updated_at timestamptz not null default clock_timestamp()
);
create index cos_operational_outbox_pending on cos_operational_private.sheet_outbox(status,updated_at);
alter table cos_operational_private.current_placements enable row level security;
alter table cos_operational_private.events enable row level security;
alter table cos_operational_private.sheet_outbox enable row level security;
alter table cos_operational_private.current_placements force row level security;
alter table cos_operational_private.events force row level security;
alter table cos_operational_private.sheet_outbox force row level security;
revoke all on all tables in schema cos_operational_private from public,anon,authenticated,service_role;

-- Exactly one current Product ID is required; historic census revisions cannot
-- silently become operational truth. Unlike an API refresh, this query is local.
create function cos_operational_private.active_product(p_product text)
returns jsonb language plpgsql stable set search_path='' as $fn$
declare v_sha text; v_rows jsonb; v_product jsonb; v_count integer;
begin
  select active_sha256 into v_sha from cos_mhelp_placement_private.upload_control where singleton;
  if v_sha is null then raise exception 'Current complete equipment source unavailable' using errcode='55000';end if;
  select records into v_rows from cos_mhelp_placement_private.upload_batches where source_sha256=v_sha;
  if jsonb_typeof(v_rows)<>'array' or jsonb_array_length(v_rows)<1 or jsonb_array_length(v_rows)>10000 then
    raise exception 'Current complete source unavailable' using errcode='55000';end if;
  select count(*), max(x.value) into v_count,v_product
  from jsonb_array_elements(v_rows) x where x.value->>'productId'=p_product;
  if v_count<>1 or v_product->>'unitNumber' is null then
    raise exception 'Exact mHelp Product ID not found or duplicated' using errcode='22023';end if;
  return jsonb_build_object('sourceSha256',v_sha,'record',v_product);
end $fn$;

-- Light census read; no map, geocoder, health or upstream vendor request.
-- The eventual publisher reads the private outbox, not this endpoint.
create function public.cos_operational_transfer_snapshot(
  p_actor_user_id uuid,p_organization_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_sha text; v_records jsonb; v_items jsonb;
begin
  perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
  select active_sha256 into v_sha from cos_mhelp_placement_private.upload_control where singleton;
  select b.records into v_records from cos_mhelp_placement_private.upload_batches b where b.source_sha256=v_sha;
  if jsonb_typeof(v_records)<>'array' or jsonb_array_length(v_records)<1 or jsonb_array_length(v_records)>10000 then
    raise exception 'Current complete equipment census unavailable' using errcode='55000';end if;
  if (select count(distinct r.value->>'productId') from jsonb_array_elements(v_records) r)
     <>jsonb_array_length(v_records) then
    raise exception 'Duplicate Product IDs require inventory review' using errcode='22023';end if;
  select jsonb_agg(jsonb_build_object(
    'productId',r.value->>'productId','unitNumber',r.value->>'unitNumber',
    'lifecycle',r.value->>'lifecycle','sourcePlacement',r.value->>'placement',
    'placement',coalesce(c.placement,r.value->>'placement'),
    'customer',coalesce(c.customer,r.value->>'customer'),
    'site',coalesce(c.site,''),
    'address',coalesce(c.address,''),
    'sourceAddress',r.value->'sourceAddress',
    'revision',coalesce(c.revision,0),
    'operationalOverride',c.product_id is not null,
    'syncState',coalesce(o.status,'source_recorded'),
    'changedAt',c.updated_at
  ) order by r.value->>'unitNumber',r.value->>'productId') into v_items
  from jsonb_array_elements(v_records) r
  left join cos_operational_private.current_placements c
     on c.product_id=r.value->>'productId' and c.source_unit_number=r.value->>'unitNumber'
  left join cos_operational_private.sheet_outbox o on o.request_id=c.last_request_id;
  return jsonb_build_object('contract','COS_OPERATIONAL_TRANSFER_V1','sourceSha256',v_sha,'items',coalesce(v_items,'[]'::jsonb));
end $fn$;

-- A fast, single local transaction. Google publishing and geocoding NEVER
-- participate in success/failure of this operational placement command.
create function public.cos_operational_transfer_apply(
  p_actor_user_id uuid,p_organization_id uuid,p_product_id text,
  p_expected_source_sha256 text,p_expected_revision bigint,p_request_id uuid,
  p_placement text,p_customer text,p_site text,p_address text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_active jsonb;v_product jsonb;v_source_sha text;v_label text;
 v_before cos_operational_private.current_placements%rowtype;
 v_after cos_operational_private.current_placements%rowtype;
 v_prev cos_operational_private.events%rowtype;
 v_submitted jsonb;v_before_state jsonb;v_after_state jsonb;
 v_customer text;v_site text;v_address text;v_revision bigint;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 if p_request_id is null or coalesce(p_product_id,'') !~ '^[1-9][0-9]{0,14}$'
   or coalesce(p_expected_source_sha256,'') !~ '^[a-f0-9]{64}$'
   or p_expected_revision is null or p_expected_revision<0
   or p_placement not in ('FIELD','SHOP') then
   raise exception 'Invalid move identity or revision' using errcode='22023';end if;
 if p_placement='FIELD' and
   (coalesce(length(btrim(p_customer)),0)<2 or coalesce(length(btrim(p_site)),0)<2
     or coalesce(length(btrim(p_address)),0)<8) then
   raise exception 'Field placement requires customer, site and postal address' using errcode='22023';end if;
 if p_placement='FIELD' and
   (length(p_customer)>250 or length(p_site)>250 or length(p_address)>600
    or (p_customer||p_site||p_address) ~ '[[:cntrl:]<>]'
    or left(btrim(p_customer),1) in ('=','+','-','@')
    or left(btrim(p_site),1) in ('=','+','-','@')
    or left(btrim(p_address),1) in ('=','+','-','@')) then
   raise exception 'Unsafe or incomplete field address' using errcode='22023';end if;
 v_customer:=case when p_placement='SHOP' then 'Cameras OnSite' else btrim(p_customer) end;
 v_site:=case when p_placement='SHOP' then 'SHOP' else btrim(p_site) end;
 v_address:=case when p_placement='SHOP' then '9949 W Sam Houston Pkwy N, Houston, TX 77064-7503' else btrim(p_address) end;
 v_submitted:=jsonb_build_object('sourceSha256',p_expected_source_sha256,
   'expectedRevision',p_expected_revision,'placement',p_placement,
   'customer',v_customer,'site',v_site,'address',v_address);
 select * into v_prev from cos_operational_private.events where request_id=p_request_id;
 if found then
  if v_prev.product_id is distinct from p_product_id
    or v_prev.actor_id is distinct from p_actor_user_id
    or v_prev.submitted is distinct from v_submitted then
   raise exception 'Request ID was already used for a different move' using errcode='23505';end if;
  return jsonb_build_object('committed',true,'replayed',true,'productId',p_product_id,
     'revision',v_prev.revision,'placement',v_prev.after_state->>'placement',
     'syncState','pending_or_published');
 end if;
 -- Lock the current census source for this transaction; no network call.
 perform 1 from cos_mhelp_placement_private.upload_control where singleton for share;
 v_active:=cos_operational_private.active_product(p_product_id);
 v_source_sha:=v_active->>'sourceSha256';v_product:=v_active->'record';
 if v_source_sha is distinct from p_expected_source_sha256 then
   raise exception 'Inventory changed; refresh this unit before moving' using errcode='40001';end if;
 if v_product->>'lifecycle' is distinct from 'UNFLAGGED' then
   raise exception 'Restricted equipment must be reviewed before transfer' using errcode='42501';end if;
 v_label:=v_product->>'unitNumber';
 if coalesce(v_label,'')='' then raise exception 'Unusable Product ID identity' using errcode='22023';end if;
 insert into cos_operational_private.current_placements(
   product_id,source_unit_number,source_sha_at_move,revision,
   placement,customer,site,address,last_request_id,actor_id
 ) values (p_product_id,v_label,v_source_sha,0,
   v_product->>'placement',v_product->>'customer','',coalesce(v_product->'sourceAddress'->>'street',''),
   p_request_id,p_actor_user_id) on conflict(product_id) do nothing;
 select * into strict v_before from cos_operational_private.current_placements
    where product_id=p_product_id for update;
 if v_before.source_unit_number is distinct from v_label then
   raise exception 'Product ID was reused for another unit; review identity' using errcode='40001';end if;
 if v_before.revision is distinct from p_expected_revision then
   raise exception 'This unit was moved elsewhere; refresh before retrying' using errcode='40001';end if;
 v_before_state:=jsonb_build_object('placement',v_before.placement,'customer',v_before.customer,
   'site',v_before.site,'address',v_before.address,'revision',v_before.revision);
 v_revision:=v_before.revision+1;
 update cos_operational_private.current_placements
    set placement=p_placement,customer=v_customer,site=v_site,address=v_address,
      source_sha_at_move=v_source_sha,revision=v_revision,
      last_request_id=p_request_id,actor_id=p_actor_user_id,updated_at=clock_timestamp()
    where product_id=p_product_id returning * into strict v_after;
 v_after_state:=jsonb_build_object('placement',v_after.placement,'customer',v_after.customer,
   'site',v_after.site,'address',v_after.address,'revision',v_after.revision);
 insert into cos_operational_private.events(
   request_id,actor_id,product_id,source_unit_number,submitted,before_state,after_state,revision
 ) values(p_request_id,p_actor_user_id,p_product_id,v_label,v_submitted,v_before_state,v_after_state,v_revision);
 insert into cos_operational_private.sheet_outbox(request_id,product_id,revision,new_state)
   values(p_request_id,p_product_id,v_revision,v_after_state);
 return jsonb_build_object('committed',true,'replayed',false,'productId',p_product_id,
   'unitNumber',v_label,'revision',v_revision,'placement',p_placement,
   'customer',v_customer,'site',v_site,'address',v_address,'syncState','pending');
end $fn$;

-- Never expose private writable tables through the data API.
revoke all on all functions in schema cos_operational_private from public,anon,authenticated,service_role;
revoke all on function public.cos_operational_transfer_snapshot(uuid,uuid),
 public.cos_operational_transfer_apply(uuid,uuid,text,text,bigint,uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.cos_operational_transfer_snapshot(uuid,uuid),
 public.cos_operational_transfer_apply(uuid,uuid,text,text,bigint,uuid,text,text,text,text)
 to service_role;
