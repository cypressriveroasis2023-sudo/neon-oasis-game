import {readFile}from'node:fs/promises';
import {setupMembershipFixture,id,actor}from'./mhelp-shared-membership-fixture.mjs';
export{id,actor};
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
export async function setupDepartureFixture(db,{canary=false}={}){
 await db.exec('reset role;drop schema if exists cos_service_field cascade;');await setupMembershipFixture(db);
 const contracts=JSON.parse(await read('service-original-contracts.json')).functions;
 const columns=JSON.parse(await read('service-schema-contract.json')).columns;
 for(const name of ['morning_checks','service_truck_units','service_truck_sims','service_truck_stock','service_truck_inventory_checks','service_truck_restock_requests','reports','field_escalations']){
  const cols=columns.filter(c=>c.table_name===name).map(c=>'"'+c.column_name+'" '+c.data_type+(c.default_expression?' default '+c.default_expression:'')+(c.not_null?' not null':''));
  await db.exec('create table public.'+name+'('+cols.join(',')+');');
 }
 await db.exec(`alter table public.service_truck_units add unique(service_tech_id,equipment_type);alter table public.service_truck_sims add unique(service_tech_id,slot_no);alter table public.service_truck_stock add unique(service_tech_id);alter table public.service_truck_inventory_checks add unique(service_tech_id,check_date);
 alter table public.unit_returns add service_tech_id uuid,add unit_tag text;
 alter table public.prep_tickets add is_test boolean not null default false;
 alter table public.app_notifications add recipient_user_id uuid,add read_at timestamptz;
 insert into public.prep_tickets(id,ticket_no,status,site) values('${id(200)}','SYN-42','released','Synthetic site');
 update cos_mhelp_intake.work_orders set prep_ticket_id='${id(200)}';update public.job_assignments set prep_ticket_id='${id(200)}',work_type='delivery',requires_it_handoff=true;
 `);
 for(const name of ['ensure_service_truck_baseline_v1','refresh_service_truck_restock_requests_v1','service_departure_readiness_v1','set_my_job_assignment_status','claim_my_department_assignment'])await db.exec(contracts.find(c=>c.name===name).definition);
 if(canary)await db.exec('create schema cos_service_field;create function cos_service_field.unrelated_existing_capability() returns integer language sql as $$select 1$$;grant usage on schema cos_service_field to authenticated;grant execute on function cos_service_field.unrelated_existing_capability() to authenticated;');
 await db.exec(await read('service-departure-witness-proposal.sql'));await db.exec(await read('service-submission-kernel-proposal.sql'));
 // Synthetic transport only: real canonical helpers, new witness and captured
 // genuine readiness + Start run unchanged in one authenticated transaction.
 await db.exec(`create function public.fixture_own_start(p_assignment uuid,p_prep uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare g jsonb;begin
 g:=cos_service_field.capture_departure_start_v1(p_assignment,p_prep);perform public.set_my_job_assignment_status(p_assignment,'started');perform cos_service_field.require_departure_start_v1(p_assignment,p_prep);return g;end$$;
 revoke all on function public.fixture_own_start(uuid,uuid) from public;grant execute on function public.fixture_own_start(uuid,uuid) to authenticated;grant usage on schema auth to authenticated;
 `);
 for(const n of [3,4])await seedReadiness(db,n);
}
export async function seedReadiness(db,n){
 await db.exec(`select public.ensure_service_truck_baseline_v1('${id(n)}');
 update public.service_truck_units set unit_tag='SYN-'||equipment_type,status='assigned' where service_tech_id='${id(n)}';
 update public.service_truck_sims set sim_number='SYN-SIM-'||slot_no,status='assigned' where service_tech_id='${id(n)}';
 update public.service_truck_stock set recon_battery_qty=25,agm_12v_110ah_qty=4,litime_12v_100ah_qty=2,battery_12v_35ah_qty=4 where service_tech_id='${id(n)}';
 insert into public.morning_checks(id,service_tech_id,mhelp_reviewed,truck_checks,taking_trailer,trailer_checks) values('${id(n+300)}','${id(n)}',true,'{"a":true,"b":true,"c":true,"d":true,"e":true,"f":true,"g":true,"h":true}',false,'{}');
 insert into public.service_truck_inventory_checks(id,service_tech_id,check_date,ready) values('${id(n+400)}','${id(n)}',timezone('America/Chicago',now())::date,true);`);
}
export async function start(db,n=3){return actor(db,n,'select public.fixture_own_start($1,$2) value',[id(n+10),id(200)]);}
