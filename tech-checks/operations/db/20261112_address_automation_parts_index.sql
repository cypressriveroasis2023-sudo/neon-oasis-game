-- Why the address job could never finish, and the index that fixes it.
--
-- Measured on production 2026-11-12, 5:52 PM CT:
--
--   explain (analyze) on the single comparison at the heart of
--   address_automation_sync_v1 - "has any earlier source already resolved this
--   same normalized address?" - reports
--     Seq Scan on census_mhelp_address  (rows removed by filter: 31288)
--     Execution Time: 13932 ms
--   for ONE address. The job loops over every distinct FIELD address in the new
--   source, so it cannot finish inside its 25 second statement timeout. It then
--   retried every minute from 1:40 AM, which is what emptied the disk IO budget
--   and took the database down.
--
-- The comparison calls address_parts_v1 on every one of the 31,288 address rows
-- because nothing indexes the normalized value. address_parts_v1 is IMMUTABLE,
-- so it can be indexed directly.
--
-- This file adds indexes only. No function, no table, no row, and no behaviour
-- changes, so it can be installed while the job is paused and reversed by
-- dropping the two indexes.
begin;

-- The normalized address, as the sync compares it.
create index if not exists census_mhelp_address_parts_idx
 on cos_mhelp_placement_private.census_mhelp_address
 ((cos_mhelp_placement_private.address_parts_v1(
    jsonb_build_object('street',street,'city',city,'state',state,'zip',zip))));

-- The owner-corrected address on a resolution, which the same comparison also
-- accepts. Partial: only a few resolutions carry one.
create index if not exists mhelp_address_resolution_corrected_parts_idx
 on cos_mhelp_placement_private.mhelp_address_resolution
 ((cos_mhelp_placement_private.address_parts_v1(evidence->'ownerCorrectedAddress')))
 where evidence ? 'ownerCorrectedAddress';

-- The group checks for an incomplete address read every Field product of a
-- source and address. census_mhelp_product holds 275,811 rows and its existing
-- index stops at (source_sha256, address_sha256).
create index if not exists census_mhelp_product_address_field_idx
 on cos_mhelp_placement_private.census_mhelp_product(source_sha256,address_sha256,product_id)
 where placement='FIELD';

commit;

-- Reversal:
--   drop index if exists cos_mhelp_placement_private.census_mhelp_address_parts_idx;
--   drop index if exists cos_mhelp_placement_private.mhelp_address_resolution_corrected_parts_idx;
--   drop index if exists cos_mhelp_placement_private.census_mhelp_product_address_field_idx;
--
-- Still to prove before the job is resumed: that the planner actually uses the
-- first index through the OR between the plain and the corrected address. If it
-- does not, the comparison has to be split into two index-friendly branches,
-- which is a change to the function and a separate review.
