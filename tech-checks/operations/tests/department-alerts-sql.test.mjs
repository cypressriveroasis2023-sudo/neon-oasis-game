import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const actors={
 it1:'11111111-1111-4111-8111-111111111111',
 it2:'22222222-2222-4222-8222-222222222222',
 fakeIt:'33333333-3333-4333-8333-333333333333',
 svc1:'44444444-4444-4444-8444-444444444444',
 svc2:'55555555-5555-4555-8555-555555555555',
 fakeSvc:'66666666-6666-4666-8666-666666666666',
 checkout:'77777777-7777-4777-8777-777777777777',
 receipt:'88888888-8888-4888-8888-888888888888',
 returning:'99999999-9999-4999-8999-999999999999',
};
test('real Service and IT departments get mandatory notifications regardless of preferences',async()=>{
 const db=new PGlite();
 try{
  const setup=[
    'create role anon;create role authenticated;create role service_role;',
    'create schema app_private;create schema auth;',
    "create function auth.jwt() returns jsonb language sql as $body$select '{\"role\":\"service_role\"}'::jsonb$body$;",
    'create table public.profiles(user_id uuid primary key,full_name text,role text,active boolean,archived_at timestamptz,notification_email text,email text);',
    'create table public.notification_preferences(user_id uuid primary key,new_assignments boolean,returned_units boolean,equipment_ready_service boolean,owner_actions boolean);',
    'create table public.app_notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid not null,kind text,title text,body text,ticket_no text,unit_tag text,read_at timestamptz,created_at timestamptz default now());',
    'create table app_private.techcheck_transfer_events(id uuid primary key,kind text not null,actor_name text,snapshot jsonb not null);',
    'create table public.unit_returns(id uuid primary key,status text,service_tech_name text,equipment_type text,unit_tag text,ticket_no text);'
  ].join('\n');
  await db.exec(setup);
  for(const [uid,name,role,email] of [
    [actors.it1,'Teddy','it','thopper@camerasonsite.com'],
    [actors.it2,'Victor','it','vgarcia@camerasonsite.com'],
    [actors.fakeIt,'Test IT','it','ittech@cameras-on-site.invalid'],
    [actors.svc1,'Abel','service','acervantes@camerasonsite.com'],
    [actors.svc2,'Josh','service','jmireles@camerasonsite.com'],
    [actors.fakeSvc,'Test Service','service','service@cameras-on-site.invalid']
  ]){
    await db.query('insert into public.profiles(user_id,full_name,role,active,notification_email) values($1,$2,$3,true,$4)',[uid,name,role,email]);
  }
  await db.query('insert into public.notification_preferences(user_id,returned_units,equipment_ready_service) values($1,false,false),($2,false,false),($3,false,false),($4,false,false)',[actors.it1,actors.it2,actors.svc1,actors.svc2]);
  const sql=readFileSync(new URL('../../database-maintenance/techcheck-department-alerts-v1.sql',import.meta.url),'utf8');
  await db.exec(sql);
  await db.exec('create trigger test_return_alert after insert on public.unit_returns for each row execute function public.notify_return_waiting_it();');
  const p=await db.query('select public.notification_enabled($1,$2) ready,public.notification_enabled($3,$4) fake',[actors.it1,'returned_unit',actors.fakeIt,'returned_unit']);
  assert.deepEqual(p.rows,[{ready:true,fake:false}]);
  const signed={expected:[{family:'Spotter',unit_tag:'255'},{family:'Ranger',unit_tag:'028'}],it_name:'Teddy',service_name:'Abel'};
  await db.query('insert into app_private.techcheck_transfer_events(id,kind,actor_name,snapshot) values($1,$2,$3,$4)',[actors.checkout,'checkout','Teddy',JSON.stringify(signed)]);
  await db.query('insert into app_private.techcheck_transfer_events(id,kind,actor_name,snapshot) values($1,$2,$3,$4)',[actors.receipt,'receipt','Abel',JSON.stringify(signed)]);
  await db.query('insert into public.unit_returns(id,status,service_tech_name,equipment_type,unit_tag,ticket_no) values($1,$2,$3,$4,$5,$6)',[actors.returning,'waiting_it','Josh','Spotter','255','M123']);
  const roster=await db.query('select source_kind,recipient_user_id from app_private.techcheck_department_alert_outbox_v1 order by source_kind,recipient_user_id');
  assert.deepEqual(roster.rows.filter(x=>x.source_kind==='it_checkout').map(x=>x.recipient_user_id).sort(),[actors.svc1,actors.svc2].sort());
  assert.deepEqual(roster.rows.filter(x=>x.source_kind==='service_return').map(x=>x.recipient_user_id).sort(),[actors.it1,actors.it2].sort());
  const inbox=await db.query('select kind,count(*)::int n from public.app_notifications group by kind order by kind');
  assert.deepEqual(inbox.rows,[{kind:'equipment_ready_service',n:2},{kind:'returned_unit',n:2}]);
  assert.equal((await db.query('select count(*)::int n from public.unit_returns where status=$1',['waiting_it'])).rows[0].n,1);
  await db.query('select app_private.techcheck_department_alert_enqueue_v1($1,$2,$3,$4,$5,$6,$7,$8)',[
    'service_return',actors.returning,'it','Duplicate','Duplicate','Duplicate','M123','255'
  ]);
  assert.equal((await db.query('select count(*)::int n from public.app_notifications')).rows[0].n,4);
  const claim=await db.query("select public.techcheck_department_alert_delivery_v1('claim') as row");
  const row=claim.rows[0].row;
  assert.ok(row.id&&row.lease_token&&row.recipient_email.endsWith('@camerasonsite.com'));
  await assert.rejects(()=>db.query('select public.techcheck_department_alert_delivery_v1($1,$2,$3,$4)',[
    'sent',row.id,row.lease_token,'g123'
  ]),/Verified provider message ID required/);
  await db.query('select public.techcheck_department_alert_delivery_v1($1,$2,$3,$4)',[
    'begin_send',row.id,row.lease_token,null
  ]);
  await db.query('select public.techcheck_department_alert_delivery_v1($1,$2,$3,$4)',[
    'sent',row.id,row.lease_token,'provider-msg-id'
  ]);
  const done=await db.query('select state,email_state,email_id from app_private.techcheck_department_alert_outbox_v1 where id=$1',[row.id]);
  assert.deepEqual(done.rows,[{state:'sent',email_state:'sent',email_id:'provider-msg-id'}]);
 }finally{await db.close();}
});
