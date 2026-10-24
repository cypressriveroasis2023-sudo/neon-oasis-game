import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const actor='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
test('uninstalled history draft pages >100 exact records, scopes Service and rejects stale/revoked reads without writes',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function app_private.techcheck_transfer_role() returns text language sql stable as $$select nullif(current_setting('test.role',true),'')$$;
 create function app_private.techcheck_transfer_ready_v1() returns boolean language sql stable as $$select coalesce(current_setting('test.ready',true),'true')<>'false'$$;
 create table app_private.techcheck_transfers(id uuid primary key,it_actor uuid,service_actor uuid,it_name text,service_name text,manifest jsonb,state text,revision integer,created_at timestamptz,updated_at timestamptz);
 alter table app_private.techcheck_transfers enable row level security;revoke all on app_private.techcheck_transfers from public,anon,authenticated,service_role;
 insert into app_private.techcheck_transfers select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${actor}',case when i<=130 then '${actor}'::uuid else '${other}'::uuid end,'Synthetic IT','Synthetic Service','[{"equipment_key":"synthetic-only"}]','awaiting_service',1,now(),now() from generate_series(1,205)i;
 grant usage on schema auth to authenticated;`);
 await db.exec(await readFile(new URL('../docs/drafts/cos-custody-history-read-v1.sql',import.meta.url),'utf8'));
 const baseline=(await db.query('select count(*)::int n,sum(revision)::int r from app_private.techcheck_transfers')).rows[0];
 const run=async(role,after=null,token=null,limit=50)=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false),set_config('test.role',$2,false)",[actor,role]);await db.exec('set role authenticated');try{return (await db.query('select public.techcheck_transfer_history_page_v1($1,$2,$3) value',[after,token,limit])).rows[0].value;}finally{await db.exec('reset role');}};
 const seen=new Set();let after=null,token=null,last;
 do{last=await run('it',after,token);token=last.snapshot_token;for(const row of last.items){assert.ok(!seen.has(row.id));seen.add(row.id);assert.equal('snapshot' in row,false);}after=last.next_after_id;}while(after);
 assert.equal(seen.size,205);assert.equal(last.total,205);assert.equal(last.pending_count,205);assert.equal(last.complete,true);
 const service=await run('service');assert.equal(service.total,130);assert.ok(service.items.every(row=>row.service_actor===actor));
 await db.exec("select set_config('test.ready','false',false)");await assert.rejects(run('it'),/held for release review/);await db.exec("select set_config('test.ready','true',false)");
 await assert.rejects(run(''),/Verified transfer role/);await assert.rejects(run('owner'),/Verified transfer role/); // Real helper maps verified Owner to it.
 await assert.rejects(run('it',service.next_after_id,null),/Invalid history page/);
 await assert.rejects(run('it',null,null,101),/Invalid history page/);
 await db.exec('set role anon');await assert.rejects(db.query('select public.techcheck_transfer_history_page_v1()'),/permission denied/);await db.exec('reset role');
 assert.deepEqual((await db.query('select count(*)::int n,sum(revision)::int r from app_private.techcheck_transfers')).rows[0],baseline);
 await db.exec("update app_private.techcheck_transfers set revision=revision+1 where id='10000000-0000-4000-8000-000000000001'");
 await assert.rejects(run('it',last.items[0].id,token),/history changed/);
 }finally{await db.close();}
});
