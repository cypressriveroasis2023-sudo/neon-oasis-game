-- Full October 16 mHelpDesk Census address-range audit. Source-only,
-- append-only equipment membership; never a GPS/installation/provider binding.
begin;
create table cos_mhelp_placement_private.census_mhelp_address (
 source_sha256 text not null references cos_mhelp_placement_private.upload_batches(source_sha256),
 address_sha256 text not null check(address_sha256~'^[a-f0-9]{64}$'),
 street text not null, city text not null, state text not null, zip text not null,
 status text not null check(status in('invalid_address','pending','queued','matched','no_match','ambiguous','address_review','provider_error')),
 reason text,
 request_id bigint unique,
 http_status integer,
 census_benchmark text,
 matches integer,
 matched_address text,
 latitude double precision,
 longitude double precision,
 requested_at timestamptz,
 completed_at timestamptz,
 primary key(source_sha256,address_sha256),
 check ((latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180 and
     not (latitude=0 and longitude=0))),
 check ((status not in('matched','address_review')) or
    (latitude is not null and longitude is not null and
     census_benchmark='Public_AR_Current' and matched_address is not null and matches=1)),
 check ((status<>'invalid_address') or (request_id is null))
);
create table cos_mhelp_placement_private.census_mhelp_product (
 source_sha256 text not null references cos_mhelp_placement_private.upload_batches(source_sha256),
 payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),
 product_id text not null check(product_id~'^[1-9][0-9]{0,14}$'),
 source_row_sha256 text not null check(source_row_sha256~'^[a-f0-9]{64}$'),
 unit_number text not null,
 placement text not null check(placement in('FIELD','SHOP')),
 address_sha256 text not null,
 observed_at timestamptz not null default clock_timestamp(),
 primary key(source_sha256,product_id),
 foreign key(source_sha256,address_sha256) references cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256)
);
create index census_mhelp_product_address on cos_mhelp_placement_private.census_mhelp_product(source_sha256,address_sha256);
create table cos_mhelp_placement_private.census_mhelp_http_receipt (
 id bigint generated always as identity primary key,
 source_sha256 text not null,
 address_sha256 text not null,
 request_id bigint not null unique,
 status text not null,
 status_code integer,
 error_reason text,
 match_count integer,
 response_sha256 text,
 observed_at timestamptz not null default clock_timestamp(),
 foreign key(source_sha256,address_sha256) references cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256)
);
create function cos_mhelp_placement_private.census_mhelp_membership_immutable() returns trigger
 language plpgsql set search_path='' as $$begin raise exception 'Census source and attempt evidence append-only' using errcode='42501';end$$;
create trigger census_membership_immutable before update or delete or truncate on cos_mhelp_placement_private.census_mhelp_product
 for each statement execute function cos_mhelp_placement_private.census_mhelp_membership_immutable();
create trigger census_attempt_immutable before update or delete or truncate on cos_mhelp_placement_private.census_mhelp_http_receipt
 for each statement execute function cos_mhelp_placement_private.census_mhelp_membership_immutable();
alter table cos_mhelp_placement_private.census_mhelp_address enable row level security;
alter table cos_mhelp_placement_private.census_mhelp_product enable row level security;
alter table cos_mhelp_placement_private.census_mhelp_http_receipt enable row level security;
revoke all on cos_mhelp_placement_private.census_mhelp_address,cos_mhelp_placement_private.census_mhelp_product,
 cos_mhelp_placement_private.census_mhelp_http_receipt from public,anon,authenticated,service_role;
revoke all on sequence cos_mhelp_placement_private.census_mhelp_http_receipt_id_seq from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_placement_private.census_mhelp_membership_immutable() from public,anon,authenticated,service_role;
-- Canonical Census request input. Strip an explanatory ZIP suffix but retain
-- exact original four-field source in the immutable mHelpDesk upload.
-- Missing city and ZIP are legal in Census's separate-field API.
create function cos_mhelp_placement_private.census_mhelp_address_input(r jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'street',btrim(regexp_replace(coalesce(r#>>'{sourceAddress,street}',''),'[[:space:]]+',' ','g')),
 'city',btrim(regexp_replace(coalesce(r#>>'{sourceAddress,city}',''),'[[:space:]]+',' ','g')),
 'state',upper(btrim(coalesce(r#>>'{sourceAddress,state}',''))),
 'zip',coalesce(substring(btrim(coalesce(r#>>'{sourceAddress,zip}','')) from '^[0-9]{5}'),'')
 )
$$;
revoke all on function cos_mhelp_placement_private.census_mhelp_address_input(jsonb) from public,anon,authenticated,service_role;
commit;