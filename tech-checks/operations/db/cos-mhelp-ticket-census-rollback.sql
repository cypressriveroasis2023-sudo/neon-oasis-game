-- Rollback for cos-mhelp-ticket-census.sql. Review before applying.
-- Drops only the census table, its cursor, and its functions.
-- Does not drop cos_mhelp_placement_private, links, request budget, or tokens.
-- Does not change an edge function. Revert the function commit separately.
-- Do not apply this to production from the pull request.
begin;
drop function if exists public.cos_mhelp_census_ticket_upsert(jsonb);
drop function if exists public.cos_mhelp_census_ticket_duplicates(text);
drop function if exists public.cos_mhelp_census_ticket_cursor(text, jsonb);
drop function if exists public.cos_mhelp_census_ticket_equipment(integer);
drop function if exists public.cos_mhelp_census_ticket_refresh(integer);
drop function if exists public.cos_mhelp_census_ticket_touch(text);
drop function if exists cos_mhelp_placement_private.census_ticket_cursor_ok(jsonb);
drop table if exists cos_mhelp_placement_private.census_mhelp_ticket_cursor;
drop table if exists cos_mhelp_placement_private.census_mhelp_ticket;
notify pgrst, 'reload schema';
commit;
