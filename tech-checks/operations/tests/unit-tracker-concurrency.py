"""Synthetic PostgreSQL concurrency verification. Never connects to production.
Set COS_POSTGRES_BIN to an existing PostgreSQL 17+ binary directory and optionally
COS_POSTGRES_LIB to its dependency library directory. All data is temporary.
"""
import concurrent.futures, hashlib, json, os, pathlib, re, socket, subprocess, tempfile, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
BIN=pathlib.Path(os.environ['COS_POSTGRES_BIN'])
ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';OWNER='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';IT='d0757b64-9623-4adc-afff-21cc7853e88a'
with socket.socket() as bound: bound.bind(('127.0.0.1',0));PORT=str(bound.getsockname()[1])
BASE=pathlib.Path(tempfile.mkdtemp(prefix='cos-unit-tracker-pg-'));DATA=BASE/'data';server=None
ENV={**os.environ,'PGPASSFILE':str(BASE/'unused-no-credentials')}
if os.environ.get('COS_POSTGRES_LIB'): ENV['LD_LIBRARY_PATH']=os.environ['COS_POSTGRES_LIB']
def q(v):return "'"+str(v).replace("'","''")+"'"
def sql(command,db='review',app='tracker_review'):
 p=subprocess.run([str(BIN/'psql'),'-X','--no-password','-h','127.0.0.1','-p',PORT,'-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=command,text=True,capture_output=True,env={**ENV,'PGAPPNAME':app},timeout=15)
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout.strip()
def obj(command):return json.loads(next(line for line in sql(command).splitlines() if line.startswith(('{','['))))
def add(label='001'):return {'requestId':str(uuid.uuid4()),'kind':'add','identity':{'family':'SOLAR POLES & SKIDS','fullVariant':'Solar Pole 72','unitLabel':label},'changes':{'placement':'SHOP'}}
def enqueue(request,hold=0,actor=OWNER,app='tracker_save',isolation='read committed'):
 command=f"begin isolation level {isolation};set local role service_role;select public.cos_unit_tracker_enqueue({q(actor)},{q(ORG)},{q(json.dumps(request))}::jsonb);select pg_sleep({hold});commit;"
 return json.loads(next(line for line in sql(command,app=app).splitlines() if line.startswith('{')))
def wait(app,event):
 until=time.monotonic()+5
 while time.monotonic()<until:
  if sql(f"select count(*) from pg_stat_activity where application_name={q(app)} and wait_event={q(event)}")=='1':return
  time.sleep(.02)
 raise AssertionError('Did not reach expected wait '+app+'/'+event)
def reject(task,code):
 try: task.result() if hasattr(task,'result') else task()
 except RuntimeError as error: assert code in str(error),str(error);return
 raise AssertionError('Expected rejection '+code)
def count():return int(sql('select count(*) from app_private.cos_unit_tracker_requests'))
try:
 subprocess.run([str(BIN/'initdb'),'-D',str(DATA),'-U','postgres','--auth=trust','--no-locale'],env=ENV,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 log=open(BASE/'postgres.log','w');server=subprocess.Popen([str(BIN/'postgres'),'-D',str(DATA),'-h','127.0.0.1','-p',PORT,'-c','unix_socket_directories='],env=ENV,stdout=log,stderr=log)
 for _ in range(60):
  try:sql('select 1','postgres');break
  except RuntimeError:time.sleep(.05)
 sql("create database review template template0 encoding 'UTF8'",'postgres')
 schema=re.search(r'await db.exec\(`(.*?)`\);',(ROOT/'tests/fixtures/geocode-sources-database-fixture.mjs').read_text(),re.S)[1]
 sql(schema);sql('alter table app_private.vision_tracker_locations add column customer text;')
 for name in ['cos-geocode-sources.sql','cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql']:sql((ROOT/'db'/name).read_text())
 sql('''create table public.user_profiles(user_id uuid primary key,organization_id uuid,department text,active boolean);
 create table public.roles(id uuid primary key,organization_id uuid,code text);create table public.user_roles(user_id uuid,role_id uuid);
 create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $$begin
 if not exists(select 1 from public.user_profiles where user_id=p and organization_id=o and active) then raise exception 'Actor denied' using errcode='42501';end if;end$$;
 create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$select true$$;
 revoke usage on schema app_private from service_role;''')
 for actor,dept,role in [(OWNER,'owner','owner'),(IT,'it','it_technician')]:sql(f'insert into public.user_profiles values({q(actor)},{q(ORG)},{q(dept)},true);insert into public.roles values({q(actor)},{q(ORG)},{q(role)});insert into public.user_roles values({q(actor)},{q(actor)});')
 artifact=(ROOT/'db/cos-unit-tracker-outbox.sql').read_text();sql(artifact);sql('update app_private.cos_unit_tracker_rollout set queue_enabled=true')
 print(sql('select version()'),flush=True);print('Artifact SHA256 '+hashlib.sha256(artifact.encode()).hexdigest(),flush=True)
 with concurrent.futures.ThreadPoolExecutor(3) as pool:
  # Independent keys competing for an exact full identity must not both commit.
  a,b=add('001'),add('001');first=pool.submit(enqueue,a,.5,OWNER,'identity_first');wait('identity_first','PgSleep');second=pool.submit(enqueue,b);first.result();reject(second,'23505')
  assert count()==1;print('PASS concurrent exact-identity add collision commits one request',flush=True)
  # Same key waits, then obtains exactly the original receipt with no new insert.
  a=add('002');first=pool.submit(enqueue,a,.5,OWNER,'retry_first');wait('retry_first','PgSleep');second=pool.submit(enqueue,a,0,OWNER,'retry_second');wait('retry_second','advisory');one,two=first.result(),second.result();assert one['request']==two['request'] and two['created'] is False and count()==2;print('PASS concurrent identical retry returns original author-bound receipt',flush=True)
  # Re-check actor and rollout after waiting on the idempotency key.
  a=add('003');holder=pool.submit(sql,f"begin;select pg_advisory_xact_lock(hashtextextended({q(a['requestId'])},271009));select pg_sleep(.7);commit;",'review','actor_holder');wait('actor_holder','PgSleep');pending=pool.submit(enqueue,a,0,IT,'revoked_actor');wait('revoked_actor','advisory');sql(f'update public.user_profiles set active=false where user_id={q(IT)}');holder.result();reject(pending,'42501');assert count()==2;sql(f'update public.user_profiles set active=true where user_id={q(IT)}');print('PASS actor revoked while waiting cannot persist a request',flush=True)
  a=add('004');holder=pool.submit(sql,f"begin;select pg_advisory_xact_lock(hashtextextended({q(a['requestId'])},271009));select pg_sleep(.7);commit;",'review','rollout_holder');wait('rollout_holder','PgSleep');pending=pool.submit(enqueue,a,0,OWNER,'disabled_queue');wait('disabled_queue','advisory');sql('update app_private.cos_unit_tracker_rollout set queue_enabled=false');holder.result();reject(pending,'55000');assert count()==2;sql('update app_private.cos_unit_tracker_rollout set queue_enabled=true');print('PASS queue disabled while waiting rejects pending new save',flush=True)
  # Existing native writer blocks table admission; save fails promptly, no deadlock.
  holder=pool.submit(sql,'begin;lock table public.equipment_units in row exclusive mode;select pg_sleep(.7);commit;','review','native_writer');wait('native_writer','PgSleep');reject(lambda:enqueue(add('005')),'55P03');holder.result();assert count()==2;print('PASS native writer makes queue fail fast with no ghost receipt',flush=True)
  # Successful queue holds actor authorization until the request transaction commits.
  a=add('006');pending=pool.submit(enqueue,a,.5,IT,'authorized_queue');wait('authorized_queue','PgSleep');revoker=pool.submit(sql,f'update public.user_profiles set active=false where user_id={q(IT)}','review','actor_revoker');wait('actor_revoker','transactionid');pending.result();revoker.result();assert count()==3;sql(f'update public.user_profiles set active=true where user_id={q(IT)}');print('PASS verified actor row remains locked until commit',flush=True)
 for level in ['repeatable read','serializable']:reject(lambda:enqueue(add('007'),isolation=level),'40001')
 print('PASS stale transaction-isolation modes rejected',flush=True)
 own=obj(f"set role service_role;select public.cos_unit_tracker_request_read({q(IT)},{q(ORG)},{q(a['requestId'])});");other=obj(f"set role service_role;select public.cos_unit_tracker_request_read({q(OWNER)},{q(ORG)},{q(a['requestId'])});")
 assert own['ownedByCurrentActor'] is True and other['ownedByCurrentActor'] is False;print('PASS exact readback binds saved author without exposing credentials',flush=True)
 print('ALL 8 PostgreSQL concurrency/readback checks passed',flush=True)
finally:
 if server:server.terminate();server.wait(timeout=10)
