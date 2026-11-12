-- Audited router-reference corrections for the camera project (goqrnolcvqnirjmzaeyk).
-- NOT INSTALLED. Review, then run the read-only precheck first.
--
-- Why: public.camera_unit_routers has no router-serial field, no A# link, no
-- history table and no change trigger. A direct edit of router_public_ip loses
-- the old value. This adds an append-only receipt table and the only supported
-- way to correct a router's public address. It alters no existing object.
--
-- A correction changes ONLY the router row it names: router_public_ip, the
-- provider-reported fields, and it clears COS's own probe result so a result
-- measured against the old address is never shown for the new one. It never
-- reads or writes camera, SIM, placement, activation or monitoring data.
begin;

create table public.camera_unit_router_corrections(
 id uuid primary key,
 seq bigint generated always as identity unique,
 action text not null check(action in('correct','revert')),
 router_id bigint not null,
 unit_key text not null,
 prior_row jsonb not null,
 old_public_ip inet,
 new_public_ip inet,
 router_serial text,
 product_id text,
 cos_unit_id uuid,
 provider text not null,
 source text not null,
 reported_status text not null check(reported_status in('online','offline','unknown')),
 observed_at timestamptz not null,
 approved_by text not null,
 approval_source text not null,
 reason text not null,
 reverts uuid references public.camera_unit_router_corrections(id),
 recorded_at timestamptz not null default clock_timestamp(),
 check((action='correct' and reverts is null and new_public_ip is not null and router_serial is not null and product_id is not null and cos_unit_id is not null)
    or (action='revert' and reverts is not null))
);
create unique index camera_unit_router_corrections_one_revert on public.camera_unit_router_corrections(reverts) where reverts is not null;
create index camera_unit_router_corrections_router on public.camera_unit_router_corrections(router_id,recorded_at);
alter table public.camera_unit_router_corrections enable row level security;
-- Production default privileges hand new public tables to service_role, and that
-- role bypasses row-level security. Take everything back, then allow readback only:
-- receipts are written solely by the two functions below, which run as their owner.
revoke all on public.camera_unit_router_corrections from public,anon,authenticated,service_role;
grant select on public.camera_unit_router_corrections to service_role;
-- The identity sequence orders receipts, and that order decides which correction
-- may be reversed. Default privileges would let the API roles move it (setval)
-- even with table writes revoked, so take the sequence back as well.
revoke all on sequence public.camera_unit_router_corrections_seq_seq from public,anon,authenticated,service_role;

create function public.camera_unit_router_corrections_immutable() returns trigger language plpgsql as $$
begin raise exception 'Router correction receipts are append-only' using errcode='PT409'; end$$;
create trigger camera_unit_router_corrections_no_change before update or delete on public.camera_unit_router_corrections
 for each row execute function public.camera_unit_router_corrections_immutable();
create trigger camera_unit_router_corrections_no_truncate before truncate on public.camera_unit_router_corrections
 for each statement execute function public.camera_unit_router_corrections_immutable();

-- One correction. Refuses unless every guard passes; on refusal nothing is written.
create function public.camera_unit_router_correct_v1(
 p_id uuid,p_router_id bigint,p_unit_key text,p_expected_old_ip inet,p_new_ip inet,
 p_router_serial text,p_product_id text,p_cos_unit_id uuid,
 p_provider text,p_source text,p_reported_status text,p_observed_at timestamptz,
 p_approved_by text,p_approval_source text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.camera_unit_routers%rowtype; seen public.camera_unit_router_corrections%rowtype; other text;
begin
 if p_id is null or p_router_id is null or p_new_ip is null or p_cos_unit_id is null or p_observed_at is null
  or coalesce(p_unit_key,'')='' or p_router_serial is null or p_router_serial!~'^[A-Z0-9]{8,32}$'
  or p_product_id is null or p_product_id!~'^[0-9]{4,12}$'
  or coalesce(btrim(p_provider),'')='' or coalesce(btrim(p_source),'')='' or coalesce(btrim(p_approved_by),'')=''
  or coalesce(btrim(p_approval_source),'')='' or coalesce(btrim(p_reason),'')=''
  or p_reported_status is null or p_reported_status not in('online','offline','unknown')
  or family(p_new_ip)<>4 or masklen(p_new_ip)<>32 then
  raise exception 'Router correction is incomplete' using errcode='PT409';
 end if;
 -- Up to one minute ahead of this server's clock is tolerated as clock skew
 -- between the reader and the database; anything later, or older than 24 hours, is refused.
 if p_observed_at>clock_timestamp()+interval '1 minute' or p_observed_at<clock_timestamp()-interval '24 hours' then
  raise exception 'Provider observation is not current; read the provider again' using errcode='PT409';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('camera_unit_router_corrections',0));
 select * into seen from public.camera_unit_router_corrections where id=p_id;
 if found then
  -- A repeat is accepted only when the whole reviewed payload is identical.
  if seen.action='correct' and seen.router_id=p_router_id and seen.unit_key=p_unit_key
   and seen.old_public_ip is not distinct from p_expected_old_ip and seen.new_public_ip=p_new_ip
   and seen.router_serial=p_router_serial and seen.product_id=p_product_id and seen.cos_unit_id=p_cos_unit_id
   and seen.provider=btrim(p_provider) and seen.source=btrim(p_source) and seen.reported_status=p_reported_status
   and seen.observed_at=p_observed_at and seen.approved_by=btrim(p_approved_by)
   and seen.approval_source=btrim(p_approval_source) and seen.reason=btrim(p_reason) then
   return jsonb_build_object('contract','COS_ROUTER_CORRECTION_V1','id',seen.id,'applied',false,'repeat',true);
  end if;
  raise exception 'Correction id was already used for a different change' using errcode='PT409';
 end if;
 select * into r from public.camera_unit_routers where id=p_router_id for update;
 if not found or r.unit_key is distinct from p_unit_key then
  raise exception 'Router record is not the one reviewed' using errcode='PT409'; end if;
 if r.router_public_ip is distinct from p_expected_old_ip then
  raise exception 'Router address changed since review' using errcode='PT409'; end if;
 if r.router_public_ip is not distinct from p_new_ip then
  raise exception 'Router already has that address' using errcode='PT409'; end if;
 -- The meaning of unit_ip is not established. A row that has one is never
 -- changed here: the health check falls back to it, so it needs its own review.
 if r.unit_ip is not null then
  raise exception 'Router record has a unit IP that needs separate review' using errcode='PT409'; end if;
 select unit_key into other from public.camera_unit_routers
  where id<>p_router_id and (router_public_ip=p_new_ip or unit_ip=p_new_ip) order by id limit 1;
 if found then
  raise exception 'Another router record already holds that address (%)',other using errcode='PT409'; end if;
 if exists(select 1 from public.camera_unit_router_corrections c where c.action='correct' and c.router_serial=p_router_serial
   and c.router_id<>p_router_id and not exists(select 1 from public.camera_unit_router_corrections v where v.reverts=c.id)) then
  raise exception 'That router serial is already recorded for another router record' using errcode='PT409'; end if;
 insert into public.camera_unit_router_corrections(id,action,router_id,unit_key,prior_row,old_public_ip,new_public_ip,router_serial,product_id,cos_unit_id,
   provider,source,reported_status,observed_at,approved_by,approval_source,reason)
  values(p_id,'correct',r.id,r.unit_key,to_jsonb(r),r.router_public_ip,p_new_ip,p_router_serial,p_product_id,p_cos_unit_id,
   btrim(p_provider),btrim(p_source),p_reported_status,p_observed_at,btrim(p_approved_by),btrim(p_approval_source),btrim(p_reason));
 update public.camera_unit_routers set router_public_ip=p_new_ip,
   reported_status=p_reported_status,reported_latency_ms=null,status_source=btrim(p_source),status_observed_at=p_observed_at,
   current_status='unknown',last_checked_at=null,last_online_at=null,updated_at=clock_timestamp()
  where id=r.id;
 return jsonb_build_object('contract','COS_ROUTER_CORRECTION_V1','id',p_id,'applied',true,'repeat',false);
end$$;

-- Reversal: a new receipt that restores the saved address. The original stays.
-- The probe result is cleared again; the old row's probe result is not restored.
create function public.camera_unit_router_revert_v1(p_id uuid,p_reverts uuid,p_approved_by text,p_approval_source text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.camera_unit_router_corrections%rowtype; r public.camera_unit_routers%rowtype; seen public.camera_unit_router_corrections%rowtype; other text;
begin
 if p_id is null or p_reverts is null or coalesce(btrim(p_approved_by),'')='' or coalesce(btrim(p_approval_source),'')='' or coalesce(btrim(p_reason),'')='' then
  raise exception 'Router reversal is incomplete' using errcode='PT409'; end if;
 perform pg_advisory_xact_lock(hashtextextended('camera_unit_router_corrections',0));
 select * into seen from public.camera_unit_router_corrections where id=p_id;
 if found then
  if seen.action='revert' and seen.reverts=p_reverts and seen.approved_by=btrim(p_approved_by)
   and seen.approval_source=btrim(p_approval_source) and seen.reason=btrim(p_reason) then return jsonb_build_object('contract','COS_ROUTER_CORRECTION_V1','id',seen.id,'applied',false,'repeat',true); end if;
  raise exception 'Correction id was already used for a different change' using errcode='PT409';
 end if;
 select * into c from public.camera_unit_router_corrections where id=p_reverts and action='correct';
 if not found then raise exception 'No such correction to reverse' using errcode='PT409'; end if;
 if exists(select 1 from public.camera_unit_router_corrections where reverts=p_reverts) then
  raise exception 'That correction was already reversed' using errcode='PT409'; end if;
 -- Only the latest correction still in effect for this router record can be
 -- reversed. An address that merely matches an earlier correction is not enough.
 if exists(select 1 from public.camera_unit_router_corrections l where l.router_id=c.router_id and l.action='correct' and l.seq>c.seq
   and not exists(select 1 from public.camera_unit_router_corrections v where v.reverts=l.id)) then
  raise exception 'A later correction is in effect for this router record; reverse that one first' using errcode='PT409'; end if;
 select * into r from public.camera_unit_routers where id=c.router_id for update;
 if not found or r.unit_key is distinct from c.unit_key or r.router_public_ip is distinct from c.new_public_ip or r.unit_ip is not null then
  raise exception 'Router record changed since the correction; review before reversing' using errcode='PT409'; end if;
 if c.old_public_ip is not null then
  select unit_key into other from public.camera_unit_routers where id<>r.id and (router_public_ip=c.old_public_ip or unit_ip=c.old_public_ip) order by id limit 1;
  if found then raise exception 'Another router record now holds the earlier address (%)',other using errcode='PT409'; end if;
 end if;
 insert into public.camera_unit_router_corrections(id,action,router_id,unit_key,prior_row,old_public_ip,new_public_ip,router_serial,product_id,cos_unit_id,
   provider,source,reported_status,observed_at,approved_by,approval_source,reason,reverts)
  values(p_id,'revert',r.id,r.unit_key,to_jsonb(r),r.router_public_ip,c.old_public_ip,c.router_serial,c.product_id,c.cos_unit_id,
   c.provider,'Reversal of correction '||c.id,'unknown',clock_timestamp(),btrim(p_approved_by),btrim(p_approval_source),btrim(p_reason),c.id);
 update public.camera_unit_routers set router_public_ip=c.old_public_ip,
   reported_status='unknown',reported_latency_ms=null,status_source='Reversal of correction '||c.id,status_observed_at=null,
   current_status='unknown',last_checked_at=null,last_online_at=null,updated_at=clock_timestamp()
  where id=r.id;
 return jsonb_build_object('contract','COS_ROUTER_CORRECTION_V1','id',p_id,'applied',true,'repeat',false);
end$$;

revoke all on function public.camera_unit_router_correct_v1(uuid,bigint,text,inet,inet,text,text,uuid,text,text,text,timestamptz,text,text,text) from public,anon,authenticated;
revoke all on function public.camera_unit_router_revert_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.camera_unit_router_corrections_immutable() from public,anon,authenticated;
grant execute on function public.camera_unit_router_correct_v1(uuid,bigint,text,inet,inet,text,text,uuid,text,text,text,timestamptz,text,text,text) to service_role;
grant execute on function public.camera_unit_router_revert_v1(uuid,uuid,text,text,text) to service_role;

commit;
