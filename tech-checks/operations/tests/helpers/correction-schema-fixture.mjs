// Synthetic schema shared by local PGlite and isolated PostgreSQL concurrency checks.
// Contains no production identifiers, data or network access.
export const correctionActors={
 it:'00000000-0000-4000-8000-000000000001',svc:'00000000-0000-4000-8000-000000000002',
 other:'00000000-0000-4000-8000-000000000003',unverified:'00000000-0000-4000-8000-000000000004',
 owner:'00000000-0000-4000-8000-000000000005',secondIT:'00000000-0000-4000-8000-000000000006'
};
const {it,svc,other,unverified,owner,secondIT}=correctionActors;
export const correctionActorNames={[it]:'Synthetic IT',[svc]:'Synthetic Service',[other]:'Other Service',[owner]:'Synthetic Owner',[secondIT]:'Second IT'};
export const correctionMigrationNames=['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-integration-v3.sql','techcheck-transfer-purpose-v2.sql','techcheck-handoff-corrections-v1.sql'];
export const correctionFixtureSchema=`
 create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('test.jwt_role',true))$$;
 create table prep_tickets(id uuid primary key,status text,is_test boolean default false);
 create table prep_items(id uuid primary key,prep_ticket_id uuid,equipment_type text,unit_tag text);
 create table service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text);
 create table unit_returns(id uuid,equipment_type text,unit_tag text,status text,service_tech_id uuid);
 create table unit_registry(equipment_type text,unit_tag text,lifecycle_status text,current_holder_id uuid);
 create table app_private.service_daily_reports(id uuid,service_tech_id uuid,check_date date,submitted_at timestamptz default now(),snapshot jsonb);
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id in ('${it}','${secondIT}')))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${unverified}','it',true,null,'Unverified IT','unknown'),('${owner}','owner',true,null,'Synthetic Owner','owner'),('${secondIT}','it',true,null,'Second IT','second');
 grant usage on schema auth,app_private,storage to authenticated;grant execute on function auth.uid() to authenticated;
 grant select,insert,update,delete on storage.objects to authenticated;
`;
export const correctionLegacyReadySql='update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true';
export const correctionTestReadySql='update app_private.techcheck_transfer_correction_settings set enabled=true,reports_ready=true';
