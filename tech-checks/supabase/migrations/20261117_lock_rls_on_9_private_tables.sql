-- Owner-approved 2026-11-17: enable RLS on 9 private-schema tables. No policies (only table owner postgres / SECURITY DEFINER functions access them; owner bypasses RLS). No grants changed, no FORCE.
alter table app_private.cos_owner_product_links enable row level security;
alter table app_private.crm_number_sequences enable row level security;
alter table app_private.external_identities enable row level security;
alter table app_private.invoice_number_sequences enable row level security;
alter table app_private.job_number_sequences enable row level security;
alter table app_private.legacy_import_map enable row level security;
alter table app_private.quote_number_sequences enable row level security;
alter table app_private.work_request_number_sequences enable row level security;
alter table cos_fleet_hand_edit_private.unit_status_edit_log enable row level security;
