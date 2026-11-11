-- Owner-approved inventory links: one exact mHelp Product ID (A#) to one existing COS record.
-- Owner decision 2026-11-11 (James Martin). Inventory identity only.
--
-- What this adds: one private append-only table and three functions.
-- What it does NOT touch: mHelp upload batches, the mHelp importer and its readers, tracker
-- rows, camera devices, IP/SIM data, monitoring, equipment records, or any existing binding.
-- No existing object is altered, so normal mHelp uploads cannot be blocked by it.
-- The link is applied at read time by cos-operations-pages and is re-proven on every load.
begin;

create table app_private.cos_owner_product_links(
 id uuid primary key,
 organization_id uuid not null,
 action text not null check(action in('approve','revoke')),
 product_id text not null check(product_id ~ '^[1-9][0-9]{0,14}$'),
 unit_id uuid not null,
 mhelp_label text not null check(length(mhelp_label) between 1 and 250),
 cos_label text not null check(length(cos_label) between 1 and 250),
 approved_by text not null check(length(btrim(approved_by)) between 3 and 200),
 approval_source text not null check(length(btrim(approval_source)) between 10 and 800),
 approved_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 10 and 800),
 recorded_by uuid,
 recorded_via text not null check(recorded_via in('owner_session','reviewed_install')),
 revokes uuid references app_private.cos_owner_product_links(id),
 evidence jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check((action='revoke')=(revokes is not null)),
 check(approved_at<=recorded_at+interval '1 minute')
);
-- One live approval per A# and per COS record is enforced in the function under a lock;
-- a revoke row can name each approval once.
create unique index cos_owner_product_links_one_revoke on app_private.cos_owner_product_links(revokes) where revokes is not null;
revoke all on app_private.cos_owner_product_links from public,anon,authenticated,service_role;

create function app_private.cos_owner_product_links_immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Owner-approved Product links are append-only' using errcode='42501';end$$;
create trigger cos_owner_product_links_no_change before update or delete or truncate on app_private.cos_owner_product_links
 for each statement execute function app_private.cos_owner_product_links_immutable();

-- Capital letters and trailing spaces are the only label differences allowed.
create function app_private.cos_owner_product_link_label(v text) returns text
language sql immutable set search_path='' as $$select lower(regexp_replace(v,'\s+$',''))$$;

-- Live approvals: approved and not revoked.
create function app_private.cos_owner_product_links_live(p_org uuid) returns setof app_private.cos_owner_product_links
language sql stable set search_path='' as $$
 select a.* from app_private.cos_owner_product_links a
 where a.organization_id=p_org and a.action='approve'
  and not exists(select 1 from app_private.cos_owner_product_links r where r.revokes=a.id)$$;

-- Every guard runs here. Both entry points (Owner session, reviewed install) go through it.
create function app_private.cos_owner_product_link_record(
 p_id uuid,p_org uuid,p_action text,p_product text,p_unit uuid,p_mhelp_label text,p_cos_label text,
 p_approved_by text,p_source text,p_approved_at timestamptz,p_reason text,p_recorded_by uuid,p_via text,p_revokes uuid)
returns jsonb language plpgsql set search_path='' as $$
declare existing app_private.cos_owner_product_links;target app_private.cos_owner_product_links;
 active_sha text;recs jsonb;rec jsonb;unit_row jsonb;evidence jsonb;
begin
 if p_id is null or p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or p_action not in('approve','revoke')
  or p_approved_at is null or p_approved_at>clock_timestamp()+interval '1 minute' then raise exception 'Invalid Product link request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('COS_OWNER_PRODUCT_LINKS_V1',0));
 select * into existing from app_private.cos_owner_product_links where id=p_id;
 if existing.id is not null then
  if (existing.action,existing.product_id,existing.unit_id,existing.mhelp_label,existing.cos_label,existing.approved_by,existing.approval_source,existing.approved_at,existing.reason,existing.revokes)
   is distinct from (p_action,p_product,p_unit,p_mhelp_label,p_cos_label,p_approved_by,p_source,p_approved_at,p_reason,p_revokes)
  then raise exception 'Request identity reused with different content' using errcode='PT409';end if;
  return jsonb_build_object('contract','COS_OWNER_PRODUCT_LINK_V1','id',existing.id,'action',existing.action,'productId',existing.product_id,'unitId',existing.unit_id,'recordedAt',existing.recorded_at,'replayed',true);
 end if;
 if p_action='revoke' then
  select * into target from app_private.cos_owner_product_links_live(p_org) where id=p_revokes;
  if target.id is null then raise exception 'No live approval to revoke' using errcode='PT409';end if;
  insert into app_private.cos_owner_product_links(id,organization_id,action,product_id,unit_id,mhelp_label,cos_label,approved_by,approval_source,approved_at,reason,recorded_by,recorded_via,revokes,evidence)
   values(p_id,p_org,'revoke',target.product_id,target.unit_id,target.mhelp_label,target.cos_label,p_approved_by,p_source,p_approved_at,p_reason,p_recorded_by,p_via,target.id,jsonb_build_object('revoked',target.id));
  return jsonb_build_object('contract','COS_OWNER_PRODUCT_LINK_V1','id',p_id,'action','revoke','productId',target.product_id,'unitId',target.unit_id,'replayed',false);
 end if;
 if p_revokes is not null or coalesce(p_product,'')!~'^[1-9][0-9]{0,14}$' or p_unit is null then raise exception 'Invalid Product link request' using errcode='22023';end if;
 if exists(select 1 from app_private.cos_owner_product_links_live(p_org) l where l.product_id=p_product or l.unit_id=p_unit)
  then raise exception 'This A# or this COS record already has a live approval' using errcode='PT409';end if;
 -- The COS record: exists, same organization, exact label, not retired.
 select to_jsonb(u) into unit_row from public.equipment_units u where u.id=p_unit;
 if unit_row is null or unit_row->>'organization_id' is distinct from p_org::text or unit_row->>'unit_number' is distinct from p_cos_label
  or unit_row->>'status' in('retired','decommissioned','deleted','stolen') or unit_row->>'retired_at' is not null
  then raise exception 'COS record is missing, renamed or retired' using errcode='PT409';end if;
 -- The mHelp record in the current load: exact A#, unflagged, unlinked, no hold an approval may not answer.
 select active_sha256 into strict active_sha from cos_mhelp_placement_private.upload_control where singleton;
 recs:=cos_mhelp_placement_private.scoped_records(active_sha);
 if jsonb_typeof(recs) is distinct from 'array' or (select count(*) from jsonb_array_elements(recs) r where r->>'productId'=p_product)<>1
  then raise exception 'A# is not present exactly once in the current mHelp load' using errcode='PT409';end if;
 select r into strict rec from jsonb_array_elements(recs) r where r->>'productId'=p_product;
 if rec->>'lifecycle' is distinct from 'UNFLAGGED' or coalesce(rec->'binding','null'::jsonb)<>'null'::jsonb
  or app_private.cos_owner_product_link_label(rec->>'unitNumber') is distinct from app_private.cos_owner_product_link_label(p_mhelp_label)
  or coalesce((rec->>'placementHeld')::boolean,false) or jsonb_array_length(coalesce(rec->'possibleAliasUnitIds','[]'::jsonb))>0
  or rec ? 'inventoryOnlyReason' or coalesce(rec->'scopedAuthority','null'::jsonb)<>'null'::jsonb
  or (rec->>'holdReason' is not null and rec->>'holdReason' not in('Product ID identity label changed; confirm before linking','Prior reviewed scoped identity or assignment requires Owner installation review'))
  then raise exception 'mHelp record is flagged, already linked, renamed or under a hold' using errcode='PT409';end if;
 -- Nothing else may already point at this COS record.
 if exists(select 1 from jsonb_array_elements(recs) r where r->>'productId'<>p_product and (r->'binding'->>'nativeUnitId'=p_unit::text or r->'binding'->>'trackerId'=p_unit::text
     or coalesce(r->'binding'->'representedUnitIds','[]'::jsonb) ? p_unit::text or coalesce(r->'possibleAliasUnitIds','[]'::jsonb) ? p_unit::text))
  or exists(select 1 from cos_mhelp_placement_private.links l where l.equipment_id<>p_product and p_unit in(l.tracker_id,l.native_unit_id))
  or exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=p_unit and c.product_association->>'productId' is distinct from p_product and c.product_association is not null)
  or exists(select 1 from app_private.cos_owner_identity_claims c where c.product_association->>'productId'=p_product and c.native_unit_id<>p_unit)
  then raise exception 'Another record already claims this COS record or this A#' using errcode='PT409';end if;
 evidence:=jsonb_build_object('sourceSha256',active_sha,'mhelpUnitNumber',rec->>'unitNumber','mhelpCategory',rec->>'category','mhelpCustomer',rec->>'customer','mhelpPlacement',rec->>'placement',
  'answeredNote',rec->>'holdReason','cosUnitNumber',unit_row->>'unit_number','cosStatus',unit_row->>'status');
 insert into app_private.cos_owner_product_links(id,organization_id,action,product_id,unit_id,mhelp_label,cos_label,approved_by,approval_source,approved_at,reason,recorded_by,recorded_via,evidence)
  values(p_id,p_org,'approve',p_product,p_unit,p_mhelp_label,p_cos_label,p_approved_by,p_source,p_approved_at,p_reason,p_recorded_by,p_via,evidence);
 return jsonb_build_object('contract','COS_OWNER_PRODUCT_LINK_V1','id',p_id,'action','approve','productId',p_product,'unitId',p_unit,'evidence',evidence,'replayed',false);
end$$;

-- Owner session entry point. The signed-in Owner is the recorder.
create function public.cos_owner_product_link_v1(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('productId','unitId','mhelpLabel','cosLabel','approvedBy','approvalSource','approvedAt','reason','revokes'))
  then raise exception 'Invalid Product link request' using errcode='22023';end if;
 return app_private.cos_owner_product_link_record(p_request_id,p_organization_id,p_action,p_payload->>'productId',(p_payload->>'unitId')::uuid,p_payload->>'mhelpLabel',p_payload->>'cosLabel',
  p_payload->>'approvedBy',p_payload->>'approvalSource',(p_payload->>'approvedAt')::timestamptz,p_payload->>'reason',p_actor_user_id,'owner_session',(p_payload->>'revokes')::uuid);
end$$;

-- Read used by cos-operations-pages on every field-map build. Returns identifiers and labels only.
create function public.cos_owner_product_links_active_v1(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('contract','COS_OWNER_PRODUCT_LINKS_V1','links',coalesce(jsonb_agg(jsonb_build_object('approvalId',l.id,'productId',l.product_id,'unitId',l.unit_id,'mhelpLabel',l.mhelp_label,'cosLabel',l.cos_label) order by l.product_id),'[]'::jsonb))
 from app_private.cos_owner_product_links_live(p_organization_id) l$$;

revoke all on function app_private.cos_owner_product_links_immutable(),app_private.cos_owner_product_link_label(text),app_private.cos_owner_product_links_live(uuid),
 app_private.cos_owner_product_link_record(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.cos_owner_product_link_v1(uuid,uuid,uuid,text,jsonb),public.cos_owner_product_links_active_v1(uuid) from public,anon,authenticated;
grant execute on function public.cos_owner_product_link_v1(uuid,uuid,uuid,text,jsonb),public.cos_owner_product_links_active_v1(uuid) to service_role;
commit;
