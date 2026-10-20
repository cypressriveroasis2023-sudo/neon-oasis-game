-- Owner-approved VRM embed URLs are private data. Do not commit an actual share link.
-- Additive, service-only configuration for newly discovered installations.
create table cos_vrm_private.dashboard_embeds (
  installation_id bigint primary key references cos_vrm_private.installations(installation_id) on update restrict on delete restrict,
  embed_url text not null,
  approved_at timestamptz not null default now(),
  constraint cos_vrm_dashboard_embeds_valid check (
    embed_url ~ ('^https://vrm[.]victronenergy[.]com/installation/' || installation_id::text || '/embed/[A-Za-z0-9_-]+/?$')
  )
);
alter table cos_vrm_private.dashboard_embeds enable row level security;
revoke all on table cos_vrm_private.dashboard_embeds from public, anon, authenticated, service_role;

create function public.cos_vrm_dashboard_embeds()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    jsonb_object_agg(installation_id::text,embed_url order by installation_id),
    '{}'::jsonb
  ) from cos_vrm_private.dashboard_embeds
$$;
revoke all on function public.cos_vrm_dashboard_embeds() from public, anon, authenticated;
grant execute on function public.cos_vrm_dashboard_embeds() to service_role;
