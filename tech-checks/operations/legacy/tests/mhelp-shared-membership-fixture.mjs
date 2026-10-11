import {readFile} from 'node:fs/promises';
export const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
/** Synthetic contract only, independent of rejected/legacy intake proposals. */
export function membershipBaseSql(){return `reset role;drop schema if exists cos_mhelp_intake cascade;drop schema if exists public cascade;drop schema if exists auth cascade;
create schema public;grant usage on schema public to public;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create type public.app_role as enum('owner','it','service','pending');
create table public.profiles(user_id uuid primary key,role public.app_role not null,active boolean not null default true,archived_at timestamptz,full_name text,username text);
create table public.job_assignments(id uuid primary key default gen_random_uuid(),ticket_no text not null,site text,assigned_role text not null check(assigned_role in ('it','service')),
assignee_user_id uuid,assignee_name text not null default 'Unassigned Department',assignment_scope text not null default 'technician' check(assignment_scope in ('technician','department')),
status text not null default 'assigned' check(status in ('assigned','started','completed','cancelled')),assigned_by uuid not null references auth.users(id),assigned_by_name text not null,
assigned_at timestamptz not null default now(),updated_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,claimed_at timestamptz,
requested_unit_count integer,unit_summary text,job_description text,notes text,solar_panel_qty integer not null default 0,battery_replacement_qty integer not null default 0,camera_replacement_qty integer not null default 0,sim_replacement_qty integer not null default 0,micro_sd_qty integer not null default 0,equipment_manifest jsonb not null default '[]',requires_it_handoff boolean not null default false,scheduled_for date not null default current_date,scheduled_time time,
work_type text not null default 'service' check(work_type in ('delivery','swap','pickup','service')),return_equipment_manifest jsonb not null default '[]',prep_ticket_id uuid,job_lead_user_id uuid,job_lead_name text,job_lead_role text,created_from text);
create table public.prep_tickets(id uuid primary key default gen_random_uuid(),ticket_no text,status text,site text);
create table public.prep_items(id uuid primary key,prep_ticket_id uuid references public.prep_tickets(id),equipment_type text,unit_tag text,purpose text);
create table public.unit_returns(id uuid primary key default gen_random_uuid(),ticket_no text,status text);
create table public.workflow_checkpoints(record_id uuid,operation text,changed_by uuid);
create function public.synthetic_checkpoint() returns trigger language plpgsql as $$begin insert into public.workflow_checkpoints values(new.id,tg_op,auth.uid());return new;end$$;
create trigger workflow_checkpoint_job_assignments after insert or update on public.job_assignments for each row execute function public.synthetic_checkpoint();
create table public.app_notifications(id uuid default gen_random_uuid(),assignment_id uuid);
create function public.synthetic_reassignment() returns trigger language plpgsql as $$begin insert into public.app_notifications(assignment_id) values(new.id);return new;end$$;
create trigger job_assignments_notify_service_reassigned after update of assignee_user_id on public.job_assignments for each row execute function public.synthetic_reassignment();
insert into auth.users values ${[1,2,3,4,9].map(n=>`('${id(n)}')`).join(',')};
insert into public.profiles(user_id,role,full_name) values ${[1,2,3,4,9].map(n=>`('${id(n)}','${n===9?'owner':n<3?'it':'service'}','Synthetic ${n}')`).join(',')};
select set_config('test.user','',false);`;}
export async function setupMembershipFixture(db,{roster=true}={}){
 await db.exec(membershipBaseSql());await db.exec(await readFile(new URL('../mhelp-shared-memberships-proposal.sql',import.meta.url),'utf8'));
 await db.exec(`insert into cos_mhelp_intake.work_orders(id,portal_id,ticket_id,ticket_number) values('${id(100)}','17','42','SYN-42');`);
 for(const n of [1,2,3,4]){
  await db.exec(`insert into public.job_assignments(id,ticket_no,created_from,assigned_role,assignee_user_id,assigned_by,assigned_by_name,scheduled_for) values('${id(n+10)}','SYN-42','mhelpdesk_service_intake','${n<3?'it':'service'}','${id(n)}','${id(9)}','Synthetic fixture actor','2026-10-12');select cos_mhelp_intake.register_assignment_v1('${id(100)}','${id(n+10)}','${n<3?'it':'service'}','source-${n}');`);
 }
 if(roster)await db.query('select cos_mhelp_intake.reconcile_memberships_v1($1,1,$2,$3::jsonb)',[id(100),'revision-1',JSON.stringify(members())]);
}
export const members=(ns=[1,2,3,4])=>ns.map(n=>({sourceIdentity:'source-'+n,legacyUserId:id(n),department:n<3?'it':'service',assignmentId:id(n+10),scheduledFor:'2026-10-12',scheduledTime:null}));
export async function actor(db,n,sql,params=[]){await db.query("select set_config('test.user',$1,false)",[id(n)]);try{return params.length===0&&sql.includes(';')?await db.exec(sql):await db.query(sql,params);}finally{await db.exec("select set_config('test.user','',false)");}}
