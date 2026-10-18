-- Native COS project only. Reviewed site references do not verify equipment GPS.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
alter table cos_mhelp_placement_private.mhelp_address_resolution
 drop constraint mhelp_address_resolution_provider_check;
alter table cos_mhelp_placement_private.mhelp_address_resolution
 add constraint mhelp_address_resolution_provider_check check(provider in
 ('geocodio','us_census_address_range','municipal_address_point','public_site_reference'));
alter table cos_mhelp_placement_private.mhelp_address_resolution
 add constraint mhelp_public_site_reference_review check
 (provider<>'public_site_reference' or status='address_review');
commit;
