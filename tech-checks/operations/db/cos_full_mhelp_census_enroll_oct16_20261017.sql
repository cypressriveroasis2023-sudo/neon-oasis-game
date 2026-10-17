-- One-time source-bound enrollment only, not a new inventory import.
begin;
do $assert$ begin
 if (select c.active_sha256 from cos_mhelp_placement_private.upload_control c where c.singleton)
 is distinct from '7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891' then
 raise exception 'Active October16 mHelpDesk source changed'; end if;
 if (select b.payload_sha256 from cos_mhelp_placement_private.upload_batches b
 where b.source_sha256='7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891')
 is distinct from '0dd24712795aff7ea7b1a2474c27fc467d04578cc4630bf7220c6cb7caebc68e' then
 raise exception 'Immutable October16 upload payload changed'; end if;
 if exists(select 1 from cos_mhelp_placement_private.census_mhelp_product) then
 raise exception 'Census source enrollment already exists; do not duplicate';
 end if;
end $assert$;
create temporary table census_enrollment_seed on commit drop as
select b.source_sha256,b.payload_sha256,r,
 cos_mhelp_placement_private.census_mhelp_address_input(r) normalized_address,
 encode(sha256(convert_to(r::text,'UTF8')),'hex') source_row_sha256
from cos_mhelp_placement_private.upload_batches b
cross join lateral jsonb_array_elements(b.records) r
where b.source_sha256='7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891';
do $assert$ declare n int;f int;s int;begin
 select count(*),count(*) filter(where r->>'placement'='FIELD'),count(*) filter(where r->>'placement'='SHOP')
 into n,f,s from census_enrollment_seed;
 if n<>1001 or f<>287 or s<>714 or
 (select count(distinct r->>'productId') from census_enrollment_seed)<>1001 then
 raise exception 'Incomplete original mHelpDesk Product ID census';
 end if;
end $assert$;
insert into cos_mhelp_placement_private.census_mhelp_address
(source_sha256,address_sha256,street,city,state,zip,status,reason)
select distinct on (source_sha256,address_sha256) source_sha256,address_sha256,street,city,state,zip,
 case when reason is null then 'pending' else 'invalid_address' end, reason
from(
select source_sha256,
 encode(sha256(convert_to(normalized_address::text,'UTF8')),'hex') address_sha256,
 normalized_address->>'street' street,normalized_address->>'city' city,
 normalized_address->>'state' state,normalized_address->>'zip' zip,
 case
 when coalesce(normalized_address->>'street','')='' then 'missing_street'
 when (normalized_address->>'street')!~'^[0-9]+[[:space:]]+' then 'missing_building_number'
 when (normalized_address->>'state')!~'^[A-Z]{2}$' then 'invalid_state'
 when (normalized_address->>'city')='' and (normalized_address->>'zip')='' then 'missing_city_and_zip'
 else null end reason
from census_enrollment_seed
) a order by source_sha256,address_sha256;
insert into cos_mhelp_placement_private.census_mhelp_product
(source_sha256,payload_sha256,product_id,source_row_sha256,unit_number,placement,address_sha256)
select source_sha256,payload_sha256,r->>'productId',source_row_sha256,r->>'unitNumber',r->>'placement',
encode(sha256(convert_to(normalized_address::text,'UTF8')),'hex')
from census_enrollment_seed;
do $verify$ declare n int;f int;s int; a int; begin
 select count(*),count(*) filter(where placement='FIELD'),count(*) filter(where placement='SHOP')
 into n,f,s from cos_mhelp_placement_private.census_mhelp_product
 where source_sha256='7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891';
 select count(*) into a from cos_mhelp_placement_private.census_mhelp_address
 where source_sha256='7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891';
 if n<>1001 or f<>287 or s<>714 or a not between 100 and 120
 then raise exception 'Census enrollment failed: %, %, %, addresses %',n,f,s,a;end if;
end $verify$;
commit;