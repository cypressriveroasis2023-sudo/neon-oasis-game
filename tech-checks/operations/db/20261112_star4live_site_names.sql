-- Star4Live site names verified by a person against VCC (camera project). NOT INSTALLED.
-- Star4Live's device feed gives each camera's organization NUMBER, never its name.
-- This table holds the name a person read off VCC for a number. The sync reads it;
-- nothing here is sent to Star4Live. Adds one table; alters no existing object.
begin;
create table public.star4live_site_names(
 organization_id text primary key check(organization_id~'^[0-9]{1,12}$' and organization_id<>'283838'),
 name text not null check(btrim(name)<>'' and length(name)<=200 and lower(btrim(name))<>'root'),
 verified_by text not null check(btrim(verified_by)<>''),
 verified_from text not null check(btrim(verified_from)<>''),
 verified_at timestamptz not null default now()
);
alter table public.star4live_site_names enable row level security;
revoke all on public.star4live_site_names from public,anon,authenticated;
commit;
