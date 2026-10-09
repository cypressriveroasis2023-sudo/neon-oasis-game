-- Camera Health project only. The complete payload must already be verified in
-- private Storage. Compare the entire original payload to preserve concurrent edits.
create or replace function public.cos_archive_camera_event_v1(p_id bigint, p_expected jsonb, p_archived jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare ref jsonb; changed integer;
begin
  ref := p_archived->'cos_private_archive';
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_expected->'binary') is distinct from 'array'
    or p_expected ? 'cos_private_archive' or ref is null or jsonb_typeof(ref) <> 'object'
    or ref->'version' is distinct from '1'::jsonb or coalesce(ref->>'bucket','') <> 'camera-event-archives'
    or coalesce(ref->>'sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(ref->>'path','') <> 'reconeyez/'||(ref->>'sha256')||'.json.gz'
    or ref->'archivedFields' is distinct from '["binary"]'::jsonb
    or coalesce(ref->>'jsonBytes','') !~ '^[1-9][0-9]{0,7}$'
    or coalesce(ref->>'storedBytes','') !~ '^[1-9][0-9]{0,7}$'
    or (ref->>'jsonBytes')::bigint > 8388608 or (ref->>'storedBytes')::bigint > 8388608
    or p_archived - 'cos_private_archive' <> p_expected - 'binary' then return false; end if;
  if not exists (
    select 1 from storage.buckets b join storage.objects o on o.bucket_id=b.id
    where b.id='camera-event-archives' and b.public=false and o.name=ref->>'path'
      and (o.metadata->>'size')::bigint=(ref->>'storedBytes')::bigint
  ) then return false; end if;
  update public.camera_integration_events set payload=p_archived
  where id=p_id and provider='reconeyez' and payload=p_expected;
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;
revoke all on function public.cos_archive_camera_event_v1(bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.cos_archive_camera_event_v1(bigint,jsonb,jsonb) to service_role;
comment on function public.cos_archive_camera_event_v1(bigint,jsonb,jsonb) is 'Server-only immutable private archive replacement; retains all non-binary event metadata and rejects a changed original.';
