-- PR #226: complete first-stage mirror, CAS, and service-only sync settlement.
-- DRAFT ONLY. Install after cos-operational-transfer-v1.sql, do not deploy
-- or enable until the independent authenticated Google worker and ACL tests pass.
-- No public or browser table access. The service caller must verify the exact
-- 2027 workbook, sheet metadata, full Product-ID crosswalk and cell provenance.
create table cos_operational_private.sheet_mirror (
 product_id text primary key check(product_id ~ '^[1-9][0-9]{0,14}$'),
 source_unit_label text not null check(length(source_unit_label) between 1 and 250),
 sheet_id integer not null check(sheet_id in
  (568394918,2017346590,426115083,386511683,826256700,651684134,
   451969219,135363149,1975227208,828079282,1900162010,1900162011)),
 row_number integer not null check(row_number between 2 and 10000),
 unit_label text not null check(length(unit_label) between 1 and 250),
 fields jsonb not null,
 revision bigint not null default 0 check(revision>=0),
 observed_at timestamptz not null default clock_timestamp(),
 unique(sheet_id,row_number)
);
create table cos_operational_private.sheet_sync_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 lease_id uuid,
 lease_until timestamptz,
 source_sha text,
 last_attempt_at timestamptz,
 last_success_at timestamptz,
 error_code text
);
insert into cos_operational_private.sheet_sync_control(singleton) values(true);
alter table cos_operational_private.sheet_mirror enable row level security;
alter table cos_operational_private.sheet_sync_control enable row level security;
revoke all on cos_operational_private.sheet_mirror,
 cos_operational_private.sheet_sync_control from public,anon,authenticated,service_role;

create function cos_operational_private.valid_sheet_fields(p_fields jsonb)
returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(
   jsonb_typeof(p_fields)='object'
   and (p_fields ?& array['placement','customer','site','address'])
   and (p_fields-array['placement','customer','site','address'])='{}'::jsonb
   and (p_fields->>'placement') in('FIELD','SHOP')
   and jsonb_typeof(p_fields->'customer')='string'
   and jsonb_typeof(p_fields->'site')='string'
   and jsonb_typeof(p_fields->'address')='string'
   and length(p_fields->>'customer')<=250
   and length(p_fields->>'site')<=250
   and length(p_fields->>'address')<=600
   and ((p_fields->>'customer')||(p_fields->>'site')||(p_fields->>'address'))
      !~ '[[:cntrl:]<>]'
   and coalesce(left(p_fields->>'customer',1),'') not in ('=','+','-','@')
   and coalesce(left(p_fields->>'site',1),'') not in ('=','+','-','@')
   and coalesce(left(p_fields->>'address',1),'') not in ('=','+','-','@')
   and (p_fields->>'placement'='SHOP' or
      (length(btrim(p_fields->>'customer'))>=2 and
       length(btrim(p_fields->>'site'))>=2 and
       length(btrim(p_fields->>'address'))>=8))
 ,false)
$fn$;
alter table cos_operational_private.sheet_mirror add constraint sheet_mirror_safe
 check(cos_operational_private.valid_sheet_fields(fields));

create function public.cos_operational_sheet_sync_begin()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ctl cos_operational_private.sheet_sync_control%rowtype;
 v_sha text;v_lease uuid;v_mirrors jsonb;v_outbox jsonb;
begin
 select * into strict ctl from cos_operational_private.sheet_sync_control
   where singleton for update;
 if not ctl.enabled then return jsonb_build_object('leaseId',null,'reason','disabled');end if;
 if ctl.lease_until>clock_timestamp() then return jsonb_build_object('leaseId',null,'reason','busy');end if;
 select active_sha256 into v_sha from cos_mhelp_placement_private.upload_control where singleton;
 if v_sha is null then raise exception 'Complete saved Product-ID census unavailable' using errcode='55000';end if;
 v_lease:=gen_random_uuid();
 update cos_operational_private.sheet_sync_control set
  lease_id=v_lease, lease_until=clock_timestamp()+interval '5 minutes',
  source_sha=v_sha,last_attempt_at=clock_timestamp(),error_code=null
  where singleton;
 select coalesce(jsonb_agg(jsonb_build_object(
   'productId',m.product_id,'sheetId',m.sheet_id,'row',m.row_number,
   'label',m.unit_label,'fields',m.fields,'revision',m.revision)
   order by m.product_id),'[]'::jsonb) into v_mirrors
 from cos_operational_private.sheet_mirror m;
 select coalesce(jsonb_agg(jsonb_build_object(
   'productId',o.product_id,'requestId',o.request_id,'revision',o.revision,
   'fields',o.new_state,'status',o.status) order by o.updated_at),'[]'::jsonb)
 into v_outbox
 from cos_operational_private.sheet_outbox o
 join cos_operational_private.current_placements c
   on c.product_id=o.product_id and c.last_request_id=o.request_id
 where o.status in('pending','conflict','failed') and o.revision=c.revision;
 return jsonb_build_object('contract','COS_OPERATIONAL_SHEETS_LEASE_V1',
  'leaseId',v_lease,'sourceSha256',v_sha,
  'mirrors',v_mirrors,'outbox',v_outbox);
end $fn$;

-- One-time full baseline. This is not permission to apply old Sheet values to
-- equipment. A complete 1,001-Product-ID crosswalk is supplied by the trusted
-- server reader and rechecked against the saved current mHelp census.
create function public.cos_operational_sheet_sync_bootstrap(
 p_lease uuid,p_source_sha text,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ctl cos_operational_private.sheet_sync_control%rowtype;
 v_source jsonb;v_record jsonb;v_row jsonb;v_count integer:=0;
begin
 select * into strict ctl from cos_operational_private.sheet_sync_control
  where singleton for update;
 if not ctl.enabled or ctl.lease_id is distinct from p_lease
  or ctl.lease_until<=clock_timestamp()
  or ctl.source_sha is distinct from p_source_sha then
    raise exception 'Sync lease expired or source changed' using errcode='40001';end if;
 perform 1 from cos_mhelp_placement_private.upload_control
  where singleton and active_sha256=p_source_sha for share;
 if not found then raise exception 'Source census changed' using errcode='40001';end if;
 select records into v_source from cos_mhelp_placement_private.upload_batches
   where source_sha256=p_source_sha;
 if jsonb_typeof(v_source)<>'array'
   or jsonb_array_length(v_source) not between 1 and 10000
   or jsonb_typeof(p_rows)<>'array'
   or jsonb_array_length(p_rows)<>jsonb_array_length(v_source)
   or exists(select 1 from cos_operational_private.sheet_mirror) then
     raise exception 'Incomplete or already initialized Sheet baseline' using errcode='22023';end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(v_row)<>'object'
   or (v_row-array['productId','sheetId','row','label','matchKey','fields'])<>'{}'::jsonb
   or (v_row->>'productId')!~'^[1-9][0-9]{0,14}$'
   or coalesce(length(v_row->>'label'),0) not between 1 and 250
   or v_row->>'matchKey' is distinct from
     (case (v_row->>'sheetId')::integer
        when 568394918 then 'SOLAR SPOTTERS'
        when 2017346590 then 'SPOTTERS'
        when 426115083 then 'HELIOS'
        when 386511683 then 'RANGERS'
        when 826256700 then 'SNIPERS'
        when 651684134 then 'CAM V & RSU'
        when 451969219 then 'RECONS'
        when 135363149 then 'RECON II'
        when 1975227208 then 'SOLAR STANDS 72'
        when 828079282 then 'SOLAR POLES & SKIDS'
        when 1900162010 then 'STANDS'
        when 1900162011 then 'WALL-E'
        else 'INVALID' end)||'|'||(v_row->>'label')
   or not cos_operational_private.valid_sheet_fields(v_row->'fields')
   then raise exception 'Invalid mirror row' using errcode='22023';end if;
  select value into v_record from jsonb_array_elements(v_source)
    where value->>'productId'=v_row->>'productId';
  if not found or (select count(*) from jsonb_array_elements(v_source)
                    where value->>'productId'=v_row->>'productId')<>1
   or coalesce(v_record->>'unitNumber','')=''
   then raise exception 'Mirror Product-ID or unit label changed' using errcode='40001';end if;
  insert into cos_operational_private.sheet_mirror(
    product_id,source_unit_label,sheet_id,row_number,unit_label,fields)
   values(v_row->>'productId',v_record->>'unitNumber',(v_row->>'sheetId')::integer,
     (v_row->>'row')::integer,v_row->>'label',v_row->'fields');
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('committed',true,'bootstrapped',v_count);
end $fn$;

-- No legacy publisher and no full tracker import is involved. Incoming Sheet
-- edits are accepted only if their old baseline and live Product ID still match,
-- and if there is no newer unsent COS Owner move for that product.
create function public.cos_operational_sheet_sync_inbound(
 p_lease uuid,p_source_sha text,p_product_id text,
 p_expected_mirror_revision bigint,p_request_id uuid,
 p_before jsonb,p_after jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ctl cos_operational_private.sheet_sync_control%rowtype;
 m cos_operational_private.sheet_mirror%rowtype;
 c cos_operational_private.current_placements%rowtype;
 e cos_operational_private.events%rowtype;
 product jsonb;v_record jsonb;v_after jsonb;v_before jsonb;v_revision bigint;
begin
 select * into strict ctl from cos_operational_private.sheet_sync_control where singleton for update;
 if not ctl.enabled or ctl.lease_id is distinct from p_lease or ctl.lease_until<=clock_timestamp()
  or ctl.source_sha is distinct from p_source_sha then
  raise exception 'Sync lease expired' using errcode='40001';end if;
 perform 1 from cos_mhelp_placement_private.upload_control
   where singleton and active_sha256=p_source_sha for share;
 if not found then raise exception 'Source inventory changed' using errcode='40001';end if;
 select * into e from cos_operational_private.events where request_id=p_request_id;
 if found then
  if e.origin is distinct from 'google_sheet' or e.product_id is distinct from p_product_id
   or e.submitted->'fields' is distinct from p_after then
    raise exception 'Sheet event replay mismatch' using errcode='23505';end if;
  return jsonb_build_object('committed',true,'replayed',true,'revision',e.revision);
 end if;
 select * into strict m from cos_operational_private.sheet_mirror
   where product_id=p_product_id for update;
 if m.revision is distinct from p_expected_mirror_revision
  or m.fields is distinct from p_before
  or not cos_operational_private.valid_sheet_fields(p_after)
  or p_after=p_before then
   raise exception 'Sheet baseline changed or invalid edit' using errcode='40001';end if;
 product:=cos_operational_private.active_product(p_product_id);
 v_record:=product->'record';
 if product->>'sourceSha256' is distinct from p_source_sha
  or v_record->>'unitNumber' is distinct from m.source_unit_label
  or v_record->>'lifecycle' is distinct from 'UNFLAGGED'
  then raise exception 'Inventory identity or lifecycle changed' using errcode='40001';end if;
 if exists(select 1 from cos_operational_private.sheet_outbox o
   where o.product_id=p_product_id and o.status in('pending','conflict','failed'))
   then raise exception 'A newer COS transfer must publish first' using errcode='40001';end if;
 insert into cos_operational_private.current_placements(
  product_id,source_unit_number,source_sha_at_move,revision,
  placement,customer,site,address,last_request_id,actor_id,origin
 ) values(p_product_id,m.source_unit_label,p_source_sha,0,
  p_before->>'placement',p_before->>'customer',p_before->>'site',p_before->>'address',
  p_request_id,null,'google_sheet') on conflict(product_id) do nothing;
 select * into strict c from cos_operational_private.current_placements
   where product_id=p_product_id for update;
 if c.source_unit_number is distinct from m.source_unit_label then
  raise exception 'Product ID was reused' using errcode='40001';end if;
 v_before:=jsonb_build_object('placement',c.placement,'customer',c.customer,
    'site',c.site,'address',c.address,'revision',c.revision);
 v_revision:=c.revision+1;
 update cos_operational_private.current_placements
   set placement=p_after->>'placement',customer=p_after->>'customer',
     site=p_after->>'site',address=p_after->>'address',
     revision=v_revision,source_sha_at_move=p_source_sha,
     last_request_id=p_request_id,actor_id=null,origin='google_sheet',
     updated_at=clock_timestamp()
   where product_id=p_product_id;
 v_after:=p_after||jsonb_build_object('revision',v_revision);
 insert into cos_operational_private.events(
  request_id,actor_id,origin,product_id,source_unit_number,
  submitted,before_state,after_state,revision
 ) values(p_request_id,null,'google_sheet',p_product_id,m.source_unit_label,
   jsonb_build_object('sheetId',m.sheet_id,'row',m.row_number,'fields',p_after),
   v_before,v_after,v_revision);
 update cos_operational_private.sheet_mirror
   set fields=p_after,revision=revision+1,observed_at=clock_timestamp()
   where product_id=p_product_id;
 return jsonb_build_object('committed',true,'replayed',false,'revision',v_revision,
     'productId',p_product_id,'placement',p_after->>'placement','syncState','published');
end $fn$;

-- Publisher stages only the current request and an unchanged mirror baseline.
-- After Sheets batchUpdate, the worker MUST reread and verify each target cell.
create function public.cos_operational_sheet_sync_stage(
 p_lease uuid,p_source_sha text,p_requests jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ctl cos_operational_private.sheet_sync_control%rowtype;
 v jsonb; o cos_operational_private.sheet_outbox%rowtype;
 m cos_operational_private.sheet_mirror%rowtype; c cos_operational_private.current_placements%rowtype;
begin
 select * into strict ctl from cos_operational_private.sheet_sync_control where singleton for update;
 if not ctl.enabled or ctl.lease_id is distinct from p_lease or ctl.lease_until<=clock_timestamp()
   or ctl.source_sha is distinct from p_source_sha then raise exception 'Sync lease expired' using errcode='40001';end if;
 perform 1 from cos_mhelp_placement_private.upload_control where singleton and active_sha256=p_source_sha for share;
 if not found then raise exception 'Source changed' using errcode='40001';end if;
 if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests)>60 then
   raise exception 'Unsupported publisher batch' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_requests) loop
  if jsonb_typeof(v)<>'object'
     or (v-array['productId','requestId','revision','oldFields','newFields'])<>'{}'::jsonb
     then raise exception 'Malformed publisher proof' using errcode='22023';end if;
  select * into strict o from cos_operational_private.sheet_outbox where request_id=(v->>'requestId')::uuid;
  select * into strict m from cos_operational_private.sheet_mirror where product_id=o.product_id;
  select * into strict c from cos_operational_private.current_placements where product_id=o.product_id;
  if o.status not in('pending','failed')
     or c.last_request_id is distinct from o.request_id or c.revision is distinct from o.revision
     or o.product_id is distinct from v->>'productId'
     or o.revision is distinct from (v->>'revision')::bigint
     or o.new_state->>'placement' is distinct from v->'newFields'->>'placement'
     or o.new_state->>'customer' is distinct from v->'newFields'->>'customer'
     or o.new_state->>'site' is distinct from v->'newFields'->>'site'
     or o.new_state->>'address' is distinct from v->'newFields'->>'address'
     or m.fields is distinct from v->'oldFields'
     or not cos_operational_private.valid_sheet_fields(v->'newFields')
     then raise exception 'Stale COS move or modified Sheet baseline' using errcode='40001';end if;
 end loop;
 return jsonb_build_object('staged',true,'count',jsonb_array_length(p_requests));
end $fn$;

-- Caller presents only cross-checked Sheets readbacks: success may settle
-- the outbox and advance the mirrored baseline; conflicts are retained for
-- user review rather than forging a success.
create function public.cos_operational_sheet_sync_ack(
 p_lease uuid,p_source_sha text,p_results jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ctl cos_operational_private.sheet_sync_control%rowtype;
 v jsonb;o cos_operational_private.sheet_outbox%rowtype;
 m cos_operational_private.sheet_mirror%rowtype;c cos_operational_private.current_placements%rowtype;
 success_count integer:=0;conflict_count integer:=0;
begin
 select * into strict ctl from cos_operational_private.sheet_sync_control where singleton for update;
 if not ctl.enabled or ctl.lease_id is distinct from p_lease or ctl.lease_until<=clock_timestamp()
   or ctl.source_sha is distinct from p_source_sha then raise exception 'Sync lease expired' using errcode='40001';end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>60 then
   raise exception 'Invalid readback batch' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(v)<>'object'
   or (v-array['productId','requestId','revision','oldFields','newFields','state'])<>'{}'::jsonb
   or v->>'state' not in('published','readback_mismatch')
   then raise exception 'Invalid publisher receipt' using errcode='22023';end if;
  select * into strict o from cos_operational_private.sheet_outbox where request_id=(v->>'requestId')::uuid for update;
  select * into strict m from cos_operational_private.sheet_mirror where product_id=o.product_id for update;
  select * into strict c from cos_operational_private.current_placements where product_id=o.product_id for update;
  if o.product_id is distinct from v->>'productId'
   or o.revision is distinct from (v->>'revision')::bigint
   or c.last_request_id is distinct from o.request_id
   or c.revision is distinct from o.revision
   or m.fields is distinct from v->'oldFields'
   or not cos_operational_private.valid_sheet_fields(v->'newFields')
   or (o.new_state-array['revision']) is distinct from v->'newFields'
   then raise exception 'Publisher readback does not match current COS placement' using errcode='40001';end if;
  if v->>'state'='published' then
    update cos_operational_private.sheet_mirror
      set fields=v->'newFields',revision=revision+1,observed_at=clock_timestamp() where product_id=o.product_id;
    update cos_operational_private.sheet_outbox
      set status='published',attempts=attempts+1,last_error_code=null,updated_at=clock_timestamp()
      where request_id=o.request_id;
    success_count:=success_count+1;
  else
    update cos_operational_private.sheet_outbox
      set status='conflict',attempts=attempts+1,last_error_code='sheet_readback_mismatch',updated_at=clock_timestamp()
      where request_id=o.request_id;
    conflict_count:=conflict_count+1;
  end if;
 end loop;
 return jsonb_build_object('committed',true,'published',success_count,'conflict',conflict_count);
end $fn$;

create function public.cos_operational_sheet_sync_finish(p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_count integer;
begin
 update cos_operational_private.sheet_sync_control set lease_id=null,lease_until=null,
   last_success_at=clock_timestamp(),error_code=null
 where singleton and enabled and lease_id=p_lease and lease_until>clock_timestamp();
 get diagnostics v_count=row_count;
 return jsonb_build_object('committed',v_count=1);
end $fn$;
create function public.cos_operational_sheet_sync_fail(p_lease uuid,p_error_code text)
returns void language plpgsql security definer set search_path='' as $fn$
begin
 update cos_operational_private.sheet_sync_control
   set lease_id=null,lease_until=null,error_code=case
      when p_error_code in('google_read','google_write','google_auth','source_changed','conflict','server') then p_error_code
      else 'server' end
 where singleton and lease_id=p_lease;
end $fn$;

revoke all on all functions in schema cos_operational_private from public,anon,authenticated,service_role;
revoke all on function public.cos_operational_sheet_sync_begin(),
 public.cos_operational_sheet_sync_bootstrap(uuid,text,jsonb),
 public.cos_operational_sheet_sync_inbound(uuid,text,text,bigint,uuid,jsonb,jsonb),
 public.cos_operational_sheet_sync_stage(uuid,text,jsonb),
 public.cos_operational_sheet_sync_ack(uuid,text,jsonb),
 public.cos_operational_sheet_sync_finish(uuid),
 public.cos_operational_sheet_sync_fail(uuid,text)
 from public,anon,authenticated;
grant execute on function public.cos_operational_sheet_sync_begin(),
 public.cos_operational_sheet_sync_bootstrap(uuid,text,jsonb),
 public.cos_operational_sheet_sync_inbound(uuid,text,text,bigint,uuid,jsonb,jsonb),
 public.cos_operational_sheet_sync_stage(uuid,text,jsonb),
 public.cos_operational_sheet_sync_ack(uuid,text,jsonb),
 public.cos_operational_sheet_sync_finish(uuid),
 public.cos_operational_sheet_sync_fail(uuid,text)
 to service_role;
