-- AI-assisted photo tag verification for Tech Check.
-- Adds persisted MATCH / MISMATCH / UNREADABLE results for IT unit photos
-- and Service return-tag photos. OCR remains advisory; human confirmation stays required.

alter table public.prep_items
  add column if not exists ai_tag_scan_status text,
  add column if not exists ai_tag_scan_detected text,
  add column if not exists ai_tag_scan_expected text,
  add column if not exists ai_tag_scan_confidence numeric,
  add column if not exists ai_tag_scan_engine text,
  add column if not exists ai_tag_scan_at timestamptz;

alter table public.unit_returns
  add column if not exists tag_scan_status text,
  add column if not exists tag_scan_detected text,
  add column if not exists tag_scan_expected text,
  add column if not exists tag_scan_confidence numeric,
  add column if not exists tag_scan_engine text,
  add column if not exists tag_scan_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='prep_items_ai_tag_scan_status_check'
      and conrelid='public.prep_items'::regclass
  ) then
    alter table public.prep_items
      add constraint prep_items_ai_tag_scan_status_check
      check (ai_tag_scan_status is null or ai_tag_scan_status in ('match','mismatch','unreadable'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='unit_returns_tag_scan_status_check'
      and conrelid='public.unit_returns'::regclass
  ) then
    alter table public.unit_returns
      add constraint unit_returns_tag_scan_status_check
      check (tag_scan_status is null or tag_scan_status in ('match','mismatch','unreadable'));
  end if;
end $$;

create or replace function public.record_it_unit_ai_tag_scan(
  p_item_id uuid,
  p_status text,
  p_detected text default null,
  p_confidence numeric default null,
  p_engine text default 'tesseract.js-7.0.0'
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_tag text;
  v_prep uuid;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  if p_status not in ('match','mismatch','unreadable') then
    raise exception 'Invalid AI tag scan status';
  end if;

  select i.prep_ticket_id,t.status,i.unit_tag
  into v_prep,v_status,v_tag
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id
  for update of i,t;

  if not found then raise exception 'Prep item not found'; end if;
  if v_status<>'draft'::public.prep_status then
    raise exception 'AI photo tag scan can only be recorded while IT prep is pending';
  end if;
  if nullif(trim(v_tag),'') is null then
    raise exception 'Enter the exact unit tag before scanning the photo';
  end if;
  if not exists(
    select 1 from public.handoff_evidence
    where prep_ticket_id=v_prep and prep_item_id=p_item_id
      and stage='it' and kind='photo'
  ) then
    raise exception 'Save the unit photo before recording the AI tag scan';
  end if;

  update public.prep_items
  set ai_tag_scan_status=p_status,
      ai_tag_scan_detected=nullif(trim(coalesce(p_detected,'')),''),
      ai_tag_scan_expected=v_tag,
      ai_tag_scan_confidence=case when p_confidence is null then null else greatest(0,least(100,p_confidence)) end,
      ai_tag_scan_engine=left(coalesce(nullif(trim(p_engine),''),'tesseract.js-7.0.0'),80),
      ai_tag_scan_at=now()
  where id=p_item_id;
end;
$function$;

revoke all on function public.record_it_unit_ai_tag_scan(uuid,text,text,numeric,text) from public,anon;
grant execute on function public.record_it_unit_ai_tag_scan(uuid,text,text,numeric,text) to authenticated;

create or replace function public.validate_unit_return_tag_scan()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if new.tag_scan_status is not null then
    if new.tag_scan_status not in ('match','mismatch','unreadable') then
      raise exception 'Invalid return photo tag scan status';
    end if;
    if nullif(trim(coalesce(new.tag_scan_expected,'')),'') is null then
      raise exception 'Expected unit tag is required when a return photo scan is saved';
    end if;
    if public.normalize_unit_key(new.tag_scan_expected) is distinct from public.normalize_unit_key(new.unit_tag) then
      raise exception 'Return photo scan expected tag must match the returned unit tag';
    end if;
    new.tag_scan_at=coalesce(new.tag_scan_at,now());
    new.tag_scan_engine=left(coalesce(nullif(trim(new.tag_scan_engine),''),'tesseract.js-7.0.0'),80);
    if new.tag_scan_confidence is not null then
      new.tag_scan_confidence=greatest(0,least(100,new.tag_scan_confidence));
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_unit_return_tag_scan_trigger on public.unit_returns;
create trigger validate_unit_return_tag_scan_trigger
before insert or update of unit_tag,tag_scan_status,tag_scan_expected,tag_scan_confidence,tag_scan_engine
on public.unit_returns
for each row execute function public.validate_unit_return_tag_scan();

revoke all on function public.validate_unit_return_tag_scan() from public,anon,authenticated;
