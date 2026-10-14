import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const owner='00000000-0000-4000-8000-000000000001';
const tech='00000000-0000-4000-8000-000000000002';
const conflict='TV settings changed on another computer. Refresh before saving.';
const signature='public.cos_tv_board_settings_save_v2(uuid,uuid,text[],integer,integer)';
const readSql=name=>readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8');
const migration=await readSql('tech-check-tv-revision-conflict.sql');

async function fixture({legacy=true}={}){
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema app_private;
   create role anon;create role authenticated;create role service_role bypassrls;
   create table auth.users(id uuid primary key);create table public.organizations(id uuid primary key);
   create table public.user_profiles(user_id uuid,organization_id uuid,active boolean,department text);
   create table public.roles(id uuid,organization_id uuid,code text);
   create table public.user_roles(user_id uuid,role_id uuid);
   create table public.role_permissions(role_id uuid,permission_code text);
   insert into auth.users values('${owner}'),('${tech}');insert into organizations values('${org}');
   insert into user_profiles values('${owner}','${org}',true,'owner'),('${tech}','${org}',true,'it');
   insert into roles values('${owner}','${org}','owner'),('${tech}','${org}','it_technician');
   insert into user_roles values('${owner}','${owner}'),('${tech}','${tech}');
   insert into role_permissions values('${owner}','job.override');
   grant select on user_profiles,user_roles,roles,role_permissions to service_role;`);
  for(const name of ['tech-check-tv-settings.sql','tech-check-tv-display-settings.sql','tech-check-tv-timing-compatibility.sql']){
   const source=await readSql(name);
   await db.exec(legacy?source.replaceAll("errcode='PT409'","errcode='40001'"):source);
  }
  return db;
 }catch(error){await db.close();throw error;}
}
async function call(db,name,args,role='service_role'){
 await db.exec('set role '+role);
 try{return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;}
 finally{await db.exec('reset role');}
}
const save=(db,revision,sections=['map'],seconds=30,actor=owner)=>call(db,'cos_tv_board_settings_save_v2',[actor,org,sections,revision,seconds]);
const compatibleSave=(db,revision,sections=['camera'])=>call(db,'cos_tv_board_settings_save',[owner,org,sections,revision]);
const snapshot=async db=>({
 settings:(await db.query('select * from app_private.cos_tv_board_settings order by organization_id')).rows,
 history:(await db.query('select * from app_private.cos_tv_board_settings_history order by organization_id,revision')).rows,
});
const catalog=async db=>(await db.query(`select p.proname,to_jsonb(p) attributes,pg_get_functiondef(p.oid) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname like 'cos_tv_board_settings_%')
 or (n.nspname='app_private' and p.proname='cos_tv_board_assert_owner') order by p.proname`)).rows;
const tables=async db=>(await db.query(`select c.relname,to_jsonb(c) attributes
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='app_private' and c.relname like 'cos_tv_board_settings%' order by c.relname`)).rows;
const code=expected=>error=>{assert.equal(error.code,expected);return true;};
const stale=error=>{assert.equal(error.code,'PT409');assert.equal(error.message,conflict);return true;};

test('guarded repair changes only the reviewed conflict code and is idempotent',async()=>{
 const db=await fixture();
 try{
  await save(db,0);
  const before=await catalog(db),beforeTables=await tables(db),beforeState=await snapshot(db);
  assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash,'8521ac1766ee9c51014eee8a568575a5');
  await db.exec(migration);
  const after=await catalog(db);
  const expected=before.map(row=>row.proname==='cos_tv_board_settings_save_v2'?{
   ...row,attributes:{...row.attributes,prosrc:row.attributes.prosrc.replace("errcode='40001'","errcode='PT409'")},
   definition:row.definition.replace("errcode='40001'","errcode='PT409'"),
  }:row);
  assert.deepEqual(after,expected,'owner, ACL, security, search path, OID and other functions are unchanged');
  assert.deepEqual(await tables(db),beforeTables,'table definitions, ACLs and RLS are unchanged');
  assert.deepEqual(await snapshot(db),beforeState,'repair does not write settings or history');
  await db.exec(migration);
  assert.deepEqual(await catalog(db),after);
  assert.deepEqual(await snapshot(db),beforeState);
 }finally{await db.close();}
});

test('stale direct and compatibility saves return PT409 without settings or history writes',async()=>{
 const db=await fixture();
 try{
  await db.exec(migration);
  const empty=await snapshot(db);
  await assert.rejects(save(db,7),stale);
  assert.deepEqual(await snapshot(db),empty,'failed first save rolls back its initial settings insert');
  const saved=await save(db,0,['camera','map'],45);
  assert.equal(saved.revision,1);assert.equal(saved.rotationSeconds,45);
  assert.deepEqual(saved.sections,['camera','map']);
  const before=await snapshot(db);
  for(let i=0;i<5;i++)await assert.rejects(save(db,0,['today'],60),stale);
  await assert.rejects(compatibleSave(db,0),stale);
  await assert.rejects(compatibleSave(db,1000000030),stale);
  assert.deepEqual(await snapshot(db),before);
  const next=await compatibleSave(db,1000001060,['today']);
  assert.equal(next.revision,2);assert.equal(next.rotationSeconds,60);assert.deepEqual(next.sections,['today']);
  const state=await snapshot(db);
  assert.equal(state.settings.length,1);assert.equal(state.history.length,2);
  for(const key of ['organization_id','revision','sections','rotation_seconds','updated_at','updated_by'])
   assert.deepEqual(state.history[1][key],state.settings[0][key],key+' is atomic across current state and history');
 }finally{await db.close();}
});

test('history failure rolls back the entire valid save; validation and permission boundaries are preserved',async()=>{
 const db=await fixture();
 try{
  await db.exec(migration);await save(db,0);
  const before=await snapshot(db);
  await db.exec(`create function app_private.fixture_reject_history() returns trigger language plpgsql as $$begin
   raise exception 'Synthetic history failure' using errcode='P0001';end$$;
   create trigger fixture_reject_history before insert on app_private.cos_tv_board_settings_history
   for each row execute function app_private.fixture_reject_history();`);
  await assert.rejects(save(db,1,['today'],60),code('P0001'));
  assert.deepEqual(await snapshot(db),before);
  await db.exec('drop trigger fixture_reject_history on app_private.cos_tv_board_settings_history');
  for(const seconds of [4,301,null])await assert.rejects(save(db,1,['today'],seconds),code('22023'));
  for(const sections of [null,['secret'],['map','map'],['map',null]])await assert.rejects(save(db,1,sections),code('22023'));
  await assert.rejects(save(db,-1),code('22023'));await assert.rejects(save(db,null),code('22023'));
  await assert.rejects(save(db,1,['today'],60,tech),code('42501'));
  for(const role of ['anon','authenticated']){
   await assert.rejects(call(db,'cos_tv_board_settings_save_v2',[owner,org,['map'],1,30],role),code('42501'));
   await assert.rejects(call(db,'cos_tv_board_settings_save',[owner,org,['map'],1],role),code('42501'));
   await assert.rejects(call(db,'cos_tv_board_settings_snapshot',[owner,org],role),code('42501'));
   await db.exec('set role '+role);
   try{await assert.rejects(db.query('select * from app_private.cos_tv_board_settings'),code('42501'));}
   finally{await db.exec('reset role');}
  }
  assert.deepEqual(await snapshot(db),before);
  assert.equal((await save(db,1,['today'],60)).revision,2,'valid service-role Owner save still works');
 }finally{await db.close();}
});

test('guard refuses an unreviewed or missing definition and leaves all other state untouched',async()=>{
 const db=await fixture();
 try{
  await db.exec(`alter function ${signature} security definer`);
  const before=await catalog(db),state=await snapshot(db);
  await assert.rejects(db.exec(migration),error=>{
   assert.equal(error.code,'P0001');assert.match(error.message,/changed; refresh the reviewed migration/);return true;
  });
  await db.exec('rollback');
  assert.deepEqual(await catalog(db),before);assert.deepEqual(await snapshot(db),state);
  await db.exec(`drop function ${signature}`);
  const missing=await catalog(db);
  await assert.rejects(db.exec(migration),error=>{
   assert.equal(error.code,'P0001');assert.match(error.message,/is missing; refresh the reviewed migration/);return true;
  });
  await db.exec('rollback');
  assert.deepEqual(await catalog(db),missing);assert.deepEqual(await snapshot(db),state);
 }finally{await db.close();}
});

test('canonical fresh installation already uses the repaired definition',async()=>{
 const db=await fixture({legacy:false});
 try{
  const before=await catalog(db);
  await db.exec(migration);
  assert.deepEqual(await catalog(db),before);
  await assert.rejects(save(db,1),stale);
  for(const name of ['tech-check-tv-settings.sql','tech-check-tv-display-settings.sql']){
   const sql=await readSql(name);assert.match(sql,/errcode='PT409'/);assert.doesNotMatch(sql,/errcode='40001'/);
  }
 }finally{await db.close();}
});

test('existing TV API forwards one PT409 conflict without retrying the save',async()=>{
 let writes=0;
 // Use the gateway's existing reviewed identity mapping, with synthetic replies.
 const gatewayOwner='e4abc521-1ef3-45a6-9829-b87faff78210',gatewayActor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
 const handler=createOperationsHandler({serviceKey:'synthetic-service-only',platformUrl:'https://fixture.invalid',fetch:async(url)=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:gatewayOwner});
  if(url.includes('/profiles?'))return Response.json([{user_id:gatewayOwner,role:'owner',active:true,archived_at:null}]);
  if(url.includes('/user_profiles?'))return Response.json([{user_id:gatewayActor,department:'owner',active:true}]);
  if(url.includes('/user_roles?'))return Response.json([{role_id:gatewayActor,roles:{code:'owner',organization_id:org}}]);
  if(url.endsWith('/rpc/cos_tv_board_settings_save')){writes++;return Response.json({code:'PT409',message:conflict},{status:409});}
  throw Error('Unexpected request '+url);
 }});
 const response=await handler(new Request('https://fixture.invalid/functions/v1/cos-operations-pages',{
  method:'POST',headers:{authorization:'Bearer synthetic-owner','content-type':'application/json'},
  body:JSON.stringify({path:'/api/tv-board/settings',method:'POST',body:{sections:['map'],expectedRevision:0}}),
 }));
 assert.equal(response.status,409);assert.equal(writes,1);assert.match(JSON.stringify(await response.json()),/TV settings changed on another computer/);
});
