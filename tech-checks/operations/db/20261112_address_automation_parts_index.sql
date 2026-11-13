-- Why the address job cannot finish, and what it actually takes to fix it.
-- NOT INSTALLED. The indexes here are only half the fix; see the end of the file.
--
-- Measured on production 2026-11-12, 5:52 PM CT. The comparison at the heart of
-- address_automation_sync_v1 - "has an earlier source already resolved this same
-- normalized address?" - reports for ONE address:
--
--   Seq Scan on census_mhelp_address  (rows removed by filter: 31288)
--   Execution Time: 13932 ms
--
-- The job loops over every distinct Field address in the new source, so it
-- cannot finish inside its 25 second statement timeout. It then retried every
-- minute from 1:40 AM, which emptied the disk IO budget and took the database
-- down.
--
-- The cause is that nothing indexes the normalized address, so address_parts_v1
-- is evaluated on all 31,288 rows every time.
--
-- The obvious index cannot be created. address_parts_v1 is IMMUTABLE, but the
-- expression the sync compares wraps it around jsonb_build_object, and
-- jsonb_build_object is only STABLE:
--
--   create index ... ((address_parts_v1(jsonb_build_object('street',street,...))))
--   ERROR 42P17: functions in index expression must be marked IMMUTABLE
--
-- So the value has to be normalized by a function over the stored columns, which
-- can be declared IMMUTABLE. The function below returns exactly what
-- address_parts_v1 returns for the same address: checked against all 31,288
-- production rows in tests/address-automation-parts-index-sql.test.mjs, with no
-- disagreement.
begin;

create or replace function cos_mhelp_placement_private.address_parts_columns_v1(street text,city text,state text,zip text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'street',upper(trim(regexp_replace(coalesce(street,''),'[[:space:]]+',' ','g'))),
  'city',upper(trim(regexp_replace(coalesce(city,''),'[[:space:]]+',' ','g'))),
  'state',upper(trim(coalesce(state,''))),
  'zip',left(trim(coalesce(zip,'')),5))
$$;
comment on function cos_mhelp_placement_private.address_parts_columns_v1(text,text,text,text) is
 'The same normalization as address_parts_v1, over the stored columns, so the value can be indexed. Keep the two in step.';

create index if not exists census_mhelp_address_parts_idx
 on cos_mhelp_placement_private.census_mhelp_address
 ((cos_mhelp_placement_private.address_parts_columns_v1(street,city,state,zip)));

-- The owner-corrected address on a resolution, which the same comparison also
-- accepts. Partial: only a few resolutions carry one.
create index if not exists mhelp_address_resolution_corrected_parts_idx
 on cos_mhelp_placement_private.mhelp_address_resolution
 ((cos_mhelp_placement_private.address_parts_columns_v1(
    evidence->'ownerCorrectedAddress'->>'street',
    evidence->'ownerCorrectedAddress'->>'city',
    evidence->'ownerCorrectedAddress'->>'state',
    evidence->'ownerCorrectedAddress'->>'zip')))
 where evidence ? 'ownerCorrectedAddress';

-- The group checks for an incomplete address read every Field product of a
-- source and address. census_mhelp_product holds 275,811 rows and its existing
-- index stops at (source_sha256, address_sha256).
create index if not exists census_mhelp_product_address_field_idx
 on cos_mhelp_placement_private.census_mhelp_product(source_sha256,address_sha256,product_id)
 where placement='FIELD';

commit;

-- WHAT IS STILL MISSING, and why this file alone changes nothing.
--
-- The sync compares with one OR across two tables:
--
--   (address_parts_v1(the address's own columns) = parts
--    or q.corrected_address is not null and address_parts_v1(q.corrected_address) = parts)
--
-- Because the OR spans both the address and the joined resolution, no index on
-- either table can be used: the planner has to join first and filter after.
-- Installing these indexes while that comparison stands leaves the job exactly
-- as slow as it is now.
--
-- Split into two branches against these indexes, the same lookup is an index
-- scan on each side: 13,932 ms becomes 0.34 ms, measured on 31,288 address rows
-- and 30,647 resolutions in the test named above.
--
-- That split is a change to address_automation_sync_v1 and belongs in its own
-- review. Until it is made, cos-mhelp-address-automation stays paused: resuming
-- it is what brought the database down.
