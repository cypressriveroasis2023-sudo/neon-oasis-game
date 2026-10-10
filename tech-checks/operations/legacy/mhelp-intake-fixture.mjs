import {PGlite} from '@electric-sql/pglite';
import {after} from 'node:test';
let sharedDatabase;
after(async()=>{await sharedDatabase?.close();});
import {readFile} from 'node:fs/promises';
import {LEGACY_PART_FIELDS, LEGACY_TECH_CHECK_PROJECT} from '../shared/mhelpLegacyRoutePlan.ts';
import {prepareMhelpLegacyIntake} from './mhelpIntakeAdapter.ts';
import {mhelpLocalLeadUpgradeSql} from './deploymentAssembly.mjs';
export const owner='10000000-0000-4000-8000-000000000001';
export const it='20000000-0000-4000-8000-000000000001';
export const service='30000000-0000-4000-8000-000000000001';
export function input(type='service') {
  return {
    source:{portalId:'17',ticketId:'42',ticketNumber:'000042',typeId:'5',statusId:'source-open',customStatusId:null,deleted:false,
      assignment:{state:'unassigned',identities:[],evidence:'Synthetic explicit empty source assignment'}},
    typeMappings:[{portalId:'17',typeId:'5',workType:type,reviewed:true,evidence:'Synthetic reviewed exact type mapping'}],
    identityCrosswalk:[{portalId:'17',sourceIdentity:'it.source',legacyProjectId:LEGACY_TECH_CHECK_PROJECT,legacyUserId:it,department:'it',active:true,archived:false,verified:true,evidence:'Synthetic exact same-person mapping'},
      {portalId:'17',sourceIdentity:'service.source',legacyProjectId:LEGACY_TECH_CHECK_PROJECT,legacyUserId:service,department:'service',active:true,archived:false,verified:true,evidence:'Synthetic exact same-person mapping'}],
    equipment:{complete:true,reviewed:true,evidence:'Synthetic complete equipment scope',items:type==='service'?[]:[{category:'device',label:'Sniper',qty:2}]},
    parts:{complete:true,reviewed:true,evidence:'Synthetic complete parts scope',quantities:Object.fromEntries(LEGACY_PART_FIELDS.map(key=>[key,0]))},
    site:{reviewed:true,value:'Synthetic test site',evidence:'Synthetic reviewed site'},
    description:{reviewed:true,value:'Synthetic ticket description',evidence:'Synthetic reviewed description'},
    schedule:{reviewed:true,date:'2026-10-12',time:null,evidence:'Synthetic explicit scheduled date'},
    notes:'',unitSummary:'',
  };
}
export const options=()=>({createdAt:'2026-10-10T00:00:01Z',schemaContract:'synthetic-verified-v1',ticketLead:{sourceIdentity:'it.source',evidence:'Synthetic deliberately verified IT lead'}});
export function payload(type='service') {
  const result=prepareMhelpLegacyIntake(input(type),options());
  if(!result.payload) throw Error('Invalid synthetic fixture: '+result.reasonCodes.join(','));
  return result.payload;
}
export const sql=()=>readFile(new URL('./mhelp-intake-proposal.sql',import.meta.url),'utf8');
export async function fixture({enabled=true,type='service',database,realScheduler=false,localLeadUpgrade=true}={}) {
  // One WASM engine per serial test file avoids repeated-runtime V8 teardown
  // instability. Every fixture rebuilds isolated schemas and roles from scratch.
  const db=database ?? (sharedDatabase ||= new PGlite());
  try {
    await db.exec(`reset role;drop schema if exists cos_mhelp_intake cascade;drop schema if exists public cascade;drop schema if exists auth cascade;
      create schema public;grant usage on schema public to public;drop role if exists anon;drop role if exists authenticated;drop role if exists service_role;`);
    // Synthetic isolated fixture. No external DB, credentials or network.
    // Types/defaults/CHECKs mirror narrowly inspected 2026-10-10 metadata.
    // Triggers are explicit behavior stubs; this is not a production clone.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.real_user',true),'')::uuid$$;
      create type public.app_role as enum ('owner','it','service','pending');
      create table public.profiles(user_id uuid primary key,role public.app_role not null,active boolean not null default true,archived_at timestamptz,full_name text,username text);
      create table public.job_assignments(
        id uuid primary key default gen_random_uuid(),ticket_no text not null,site text,assigned_role text not null check(assigned_role in ('it','service')),
        assignee_user_id uuid,assignee_name text not null default 'Unassigned Department',assignment_scope text not null default 'technician' check(assignment_scope in ('technician','department')),
        status text not null default 'assigned' check(status in ('assigned','started','completed','cancelled')),assigned_by uuid not null references auth.users(id),assigned_by_name text not null,assigned_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,claimed_at timestamptz,
        requested_unit_count integer check(requested_unit_count is null or requested_unit_count>=0),unit_summary text,job_description text,notes text,
        solar_panel_qty integer not null default 0 check(solar_panel_qty>=0),battery_replacement_qty integer not null default 0 check(battery_replacement_qty>=0),camera_replacement_qty integer not null default 0 check(camera_replacement_qty>=0),
        sim_replacement_qty integer not null default 0 check(sim_replacement_qty>=0),micro_sd_qty integer not null default 0 check(micro_sd_qty>=0),equipment_manifest jsonb not null default '[]',
        requires_it_handoff boolean not null default false,scheduled_for date not null default current_date,scheduled_time time,
        work_type text not null default 'service' check(work_type in ('delivery','swap','pickup','service')),return_equipment_manifest jsonb not null default '[]',prep_ticket_id uuid,
        job_lead_user_id uuid,job_lead_name text,job_lead_role text,created_from text
      );
      create table public.app_notifications(id uuid default gen_random_uuid(),assignment_id uuid,recipient_user_id uuid,read_at timestamptz);
      create table public.prep_tickets(id uuid default gen_random_uuid(),ticket_no text,status text);
      create table public.unit_returns(id uuid default gen_random_uuid(),ticket_no text,status text);
      create table public.reports(kind text,actor_id uuid,actor_name text,ticket_no text,text text);
      create function public.service_departure_readiness_v1(uuid) returns jsonb language sql as $$select '{"departure_ready":true}'::jsonb$$;
      create table public.workflow_checkpoints(record_id uuid,operation text,changed_by uuid);
      create function public.synthetic_checkpoint() returns trigger language plpgsql as $$begin
        insert into public.workflow_checkpoints values(new.id,tg_op,auth.uid());return new;end$$;
      create trigger workflow_checkpoint_job_assignments after insert or update on public.job_assignments for each row execute function public.synthetic_checkpoint();
      create function public.synthetic_reassignment() returns trigger language plpgsql as $$begin
        insert into public.app_notifications(assignment_id) values(new.id);return new;end$$;
      create trigger job_assignments_notify_service_reassigned after update of assignee_user_id on public.job_assignments for each row execute function public.synthetic_reassignment();
      create function public.enqueue_app_notification() returns void language plpgsql as $$begin raise exception 'Notifications forbidden in fixture';end$$;
      insert into auth.users values('${owner}'),('${it}'),('${service}');
      insert into public.profiles(user_id,role,full_name) values('${owner}','owner','Synthetic Owner'),('${it}','it','Synthetic IT'),('${service}','service','Synthetic Service');
      select set_config('test.real_user','',false);
    `);
    await db.exec(await sql());
    if(realScheduler)await db.exec(await readFile(new URL('../intake/mhelp-intake-scheduler-proposal.sql',import.meta.url),'utf8'));
    else {
    // Explicit scheduler fixture stub, not a production lease implementation.
    await db.exec(`create function cos_mhelp_intake.validate_intake_lease_v1(uuid) returns jsonb language sql as $$
      select '{"portalId":"17","createdAfter":"2026-10-09T00:00:00Z","createdBefore":"2026-10-11T00:00:00Z"}'::jsonb$$;
      revoke all on function cos_mhelp_intake.validate_intake_lease_v1(uuid) from public,anon,authenticated,service_role;`);
    }
    if(localLeadUpgrade)await db.exec(await mhelpLocalLeadUpgradeSql());
    await db.exec(await readFile(new URL('./tests/contracts/legacy-workflow-contract.sql',import.meta.url),'utf8'));
    await db.query(`insert into cos_mhelp_intake.portal_config(portal_id,enabled,activated_at,schema_contract,schema_evidence,reviewed_by,reviewed_at)
      values('17',$1,'2026-10-10T00:00:00Z','synthetic-verified-v1','Synthetic schema verification',$2,now())`,[enabled,owner]);
    await db.query(`insert into cos_mhelp_intake.type_mappings(portal_id,type_id,work_type,enabled,evidence,reviewed_by,reviewed_at)
      values('17','5',$1,true,'Synthetic mapping',$2,now())`,[type,owner]);
    await db.query(`insert into cos_mhelp_intake.source_status_policies(portal_id,status_id,custom_status_id,classification,enabled,evidence,reviewed_by,reviewed_at)
      values('17','source-open','','open',true,'Synthetic reviewed nonterminal status',$1,now())`,[owner]);
    for(const [identity,user,department] of [['it.source',it,'it'],['service.source',service,'service']])
      await db.query(`insert into cos_mhelp_intake.identity_crosswalk(portal_id,source_identity,legacy_user_id,department,enabled,evidence,reviewed_by,reviewed_at)
        values('17',$1,$2,$3,true,'Synthetic exact identity mapping',$4,now())`,[identity,user,department,owner]);
    return {exec:db.exec.bind(db),query:db.query.bind(db),close:async()=>{}};
  } catch(error) {throw error;}
}
export async function accept(db,body=payload()) {
  await db.exec('set role service_role');
  try{return (await db.query('select public.camera_mhelp_ticket_intake_v1($1::jsonb) value',[JSON.stringify({action:'record',leaseId:'40000000-0000-4000-8000-000000000001',ticket:body})])).rows[0].value;}
  finally{await db.exec('reset role');}
}
export const rows=async(db)=>(await db.query('select * from public.job_assignments order by assigned_at,id')).rows;
export const receipt=async(db)=>(await db.query('select * from cos_mhelp_intake.receipts')).rows;
