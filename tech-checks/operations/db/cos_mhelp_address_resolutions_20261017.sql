-- Additional address evidence only. Original Census requests/source bytes stay
-- immutable; this table cannot move, activate or associate equipment.
begin;
create table cos_mhelp_placement_private.mhelp_address_resolution (
 id bigint generated always as identity primary key,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 address_sha256 text not null check(address_sha256 ~ '^[a-f0-9]{64}$'),
 provider text not null check(provider in ('geocodio','us_census_address_range','municipal_address_point')),
 lookup_address text not null check(length(lookup_address) between 1 and 600),
 status text not null check(status in ('matched','address_review','no_match','provider_error')),
 reason text,
 matched_address text,
 latitude double precision,
 longitude double precision,
 geocoded_at timestamptz not null,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default now(),
 foreign key(source_sha256,address_sha256) references cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256),
 unique(source_sha256,payload_sha256,address_sha256,evidence_sha256),
 check((status in ('matched','address_review') and latitude between -90 and 90
   and latitude is not null and longitude is not null and matched_address is not null
   and longitude between -180 and 180 and (latitude<>0 or longitude<>0)
   and length(matched_address)>0)
  or (status in ('no_match','provider_error') and latitude is null and longitude is null and matched_address is null))
);
create index mhelp_address_resolution_current on cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,id desc);
alter table cos_mhelp_placement_private.mhelp_address_resolution enable row level security;
revoke all on cos_mhelp_placement_private.mhelp_address_resolution from public,anon,authenticated,service_role;
-- Writes are operator-reviewed release data, never a browser/API capability.
commit;
