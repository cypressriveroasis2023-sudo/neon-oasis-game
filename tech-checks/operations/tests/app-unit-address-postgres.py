#!/usr/bin/env python3
"""Synthetic local PostgreSQL concurrency regressions; never connects remotely.

Run with an existing trusted PostgreSQL bin directory and a free localhost port.
Every run initializes its own throwaway cluster and leaves its log in work-dir.
"""
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, subprocess, tempfile, time, uuid
parser=argparse.ArgumentParser()
parser.add_argument('--bin-dir',required=True)
parser.add_argument('--port',required=True,type=int)
parser.add_argument('--library-path',default='')
parser.add_argument('--work-dir',default='/tmp')
options=parser.parse_args()
if not 1024 <= options.port <= 65535: raise ValueError('Use a free unprivileged localhost port')

ROOT=pathlib.Path(__file__).resolve().parent.parent
BASE=pathlib.Path(tempfile.mkdtemp(prefix='cos-app-address-pg-',dir=options.work_dir))
BIN=pathlib.Path(options.bin_dir).resolve()
ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';OWNER='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';IT='d0757b64-9623-4adc-afff-21cc7853e88a'
PORT=str(options.port);DB='review';server=None;data=BASE/'data'
env={**os.environ,'LD_LIBRARY_PATH':options.library_path,'PGPASSFILE':str(BASE/'no-credentials')}
def q(v):return "'"+str(v).replace("'","''")+"'"
def h(v):return hashlib.sha256(v.encode()).hexdigest()
def sql(s,db=DB,app='app_review'):
 r=subprocess.run([str(BIN/'psql'),'-X','--no-password','-h','127.0.0.1','-p',PORT,'-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=s,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def js(s):return json.loads(next(x for x in sql(s).splitlines() if x.startswith(('{','['))))
def run_save(args,hold=0,app='app_save',isolation='read committed'):
 command='select public.cos_app_unit_address_save('+','.join(k+'=>'+('null' if v is None else q(json.dumps(v))+'::jsonb' if isinstance(v,(dict,list)) else q(v)) for k,v in args.items())+');'
 output=sql('begin isolation level '+isolation+';set local role service_role;'+command+f'select pg_sleep({hold});commit;',app=app)
 return json.loads(next(x for x in output.splitlines() if x.startswith('{')))
def read(uid,actor=OWNER):return js(f'set role service_role;select public.cos_app_unit_address_read({q(actor)},{q(ORG)},{q(uid)});')
def mapping(uid):return js(f'set role service_role;select public.cos_geocode_sources_map_projection({q(ORG)},{q(json.dumps([dict(entityKind="tracker",nativeUnitId=uid)]))}::jsonb);')
def wait_event(app,event):
 end=time.monotonic()+4
 while time.monotonic()<end:
  if sql(f'select count(*) from pg_stat_activity where application_name={q(app)} and wait_event={q(event)}')=='1':return
  time.sleep(.02)
 raise AssertionError('worker did not reach '+event)
def error(task,fragment):
 try:task.result() if hasattr(task,'result') else task()
 except RuntimeError as e:assert fragment in str(e),str(e);return
 raise AssertionError('Expected '+fragment)
def record(n):
 uid=str(uuid.uuid4());full=f'Solar Pole 72|{n:03}';label=full.replace('|',' ')
 return dict(entityKind='tracker',nativeUnitId=uid,trackerId=uid,sourceSystem='google_sheet_tracker',sourceRecordId=f'google_sheet:synthetic_sheet_123:12:{full}',sourceProvenance=dict(sheetId='synthetic_sheet_123',tabId='12',fullIdentity=full,sourceRange=f'A{n}:L{n}'),createTracker=True,unitNumber=label,trackerUnitNumber=label,family='Solar Pole 72',trackerFamily='SOLAR POLES & SKIDS',variant=None,sourceFileSha256=h('file'),sourceRowSha256=h(str(n)),installation=dict(street='123 Main St',city='Houston',state='TX',zip='77002'),addressSha256=h('123 main st, houston, tx 77002'),previousSourceRevision=None,placement='FIELD',siteLabel=None,customerLabel='Synthetic')
def admit(r):return js(f'select app_private.cos_tracker_sources_admin_import_reviewed({q(ORG)},{q(json.dumps([r]))}::jsonb);')[0]
def args(r,actor=OWNER):return dict(p_actor_user_id=actor,p_organization_id=ORG,p_native_unit_id=r['unitId'],p_expected_source_revision=r['sourceRevision'],p_expected_overlay_revision=r['revision'],p_expected_stable_identity_sha256=r['stableIdentitySha256'],p_expected_placement_revision=r['placementRevision'],p_placement_proof=dict(contract='COS_APP_UNIT_ADDRESS_V1',legacyUnitKey=None,legacyIdentitySha256=h('identity'),legacyPlacementSha256=h('placement')),p_request_id=str(uuid.uuid4()),p_placement='FIELD',p_installation=dict(street='456 Oak St',city='Houston',state='TX',zip='77003'),p_site_label=None,p_effective_before={k:r[k] for k in ['placement','installation','siteLabel']})
def counts():return sql('select (select count(*) from app_private.cos_app_unit_addresses),(select count(*) from app_private.cos_app_unit_address_history)')
try:
 subprocess.run([str(BIN/'initdb'),'-D',str(data),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
 log=open(BASE/'real-postgres.log','a');server=subprocess.Popen([str(BIN/'postgres'),'-D',str(data),'-h','127.0.0.1','-p',PORT,'-c',"unix_socket_directories="],stdout=log,stderr=log,env=env)
 for _ in range(40):
  try:sql('select 1','postgres');break
  except RuntimeError:time.sleep(.05)
 sql("create database review template template0 encoding 'UTF8'",'postgres')
 schema=re.search(r'await db.exec\(`(.*?)`\);',(ROOT/'tests/fixtures/geocode-sources-database-fixture.mjs').read_text(),re.S)[1]
 sql(schema);sql('alter table app_private.vision_tracker_locations add column customer text;')
 for f in ['cos-geocode-sources.sql','cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql','cos-inactive-source-placement.sql','source-precedence-contract.sql','cos-source-precedence.sql']:sql((ROOT/'db'/f).read_text())
 sql('''create table public.user_profiles(user_id uuid primary key,organization_id uuid,department text,active boolean);
 create table public.roles(id uuid primary key,organization_id uuid,code text);create table public.user_roles(user_id uuid,role_id uuid);
 create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $$begin
 if not exists(select 1 from public.user_profiles where user_id=p and organization_id=o and active) then raise exception 'Actor denied' using errcode='42501';end if;end$$;
 create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$select true$$;
 revoke usage on schema app_private from service_role;''')
 for actor,department,role in [(OWNER,'owner','owner'),(IT,'it','it_technician')]:sql(f'insert into public.user_profiles values({q(actor)},{q(ORG)},{q(department)},true);insert into public.roles values({q(actor)},{q(ORG)},{q(role)});insert into public.user_roles values({q(actor)},{q(actor)});')
 native=(ROOT/'db/cos-app-unit-address.sql').read_text();sql(native)
 sql('update app_private.cos_app_unit_address_rollout set enabled=true,native_ready=true,bridge_ready=true,worker_ready=true,queue_ready=true,readers_ready=true,legacy_proof_ready=true')
 print(sql('select version()'),flush=True);print('native SQL SHA256 '+h(native),flush=True)
 # Concurrency between two address editors must yield exactly one event.
 r=record(1);admit(r);a=args(read(r['nativeUnitId']));a2={**a,'p_request_id':str(uuid.uuid4()),'p_installation':{**a['p_installation'],'street':'789 Elm St'}}
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(run_save,a,.6,'save_first');wait_event('save_first','PgSleep');second=pool.submit(run_save,a2);first.result();error(second,'40001')
 assert counts()=='1|1';print('PASS concurrent same-revision saves commit one overlay/history and reject loser',flush=True)
 # A writer already holding native locks must not deadlock the address save.
 r=record(2);admit(r);a=args(read(r['nativeUnitId']))
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  writer=pool.submit(sql,f"begin;update app_private.vision_tracker_locations set address='other' where id={q(r['nativeUnitId'])};select pg_sleep(.6);commit;",DB,'native_writer');wait_event('native_writer','PgSleep');error(lambda:run_save(a),'55P03');writer.result()
 assert counts()=='1|1';print('PASS active native writer makes save fail promptly without audit side effects',flush=True)
 # Save table locks protect absent competing native identities until commit.
 r=record(3);admit(r);a=args(read(r['nativeUnitId']))
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(run_save,a,.6,'save_identity');wait_event('save_identity','PgSleep')
  writer=pool.submit(sql,f"insert into public.equipment_units(id,organization_id,unit_number,status) values({q(str(uuid.uuid4()))},{q(ORG)},{q(r['unitNumber'])},'available')",DB,'competing_identity')
  wait_event('competing_identity','relation');first.result();writer.result()
 assert read(r['nativeUnitId'])['editable']==False;print('PASS absent-identity protection blocks insertion then invalidates app authority after commit',flush=True)
 # A mutable source refresh must not change effective revision/event/cache identity.
 r=record(4);s=admit(r);run_save(args(read(r['nativeUnitId'])));before=mapping(r['nativeUnitId'])[0]
 refreshed={**r,'createTracker':False,'previousSourceRevision':s['sourceRevision'],'nativeGuardSha256':s['nativeGuardSha256'],'sourceRowSha256':h('changed'),'installation':{**r['installation'],'street':'124 Main St'},'addressSha256':h('124 main st, houston, tx 77002')};admit(refreshed)
 after=mapping(r['nativeUnitId'])[0];assert after==before;print('PASS mutable import preserves exact effective source cache binding',flush=True)
 # The role must still be active when a delayed save actually reaches its write.
 r=record(5);admit(r);a=args(read(r['nativeUnitId']),IT)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  holder=pool.submit(sql,f"begin;select pg_advisory_xact_lock(hashtextextended({q(r['nativeUnitId'])},701006));select pg_sleep(.9);commit;",DB,'lock_holder');wait_event('lock_holder','PgSleep')
  pending=pool.submit(run_save,a,0,'revoked_actor');wait_event('revoked_actor','advisory');sql(f'update public.user_profiles set active=false where user_id={q(IT)}');holder.result()
  error(pending,'42501')
 assert sql(f'select count(*) from app_private.cos_app_unit_address_history where native_unit_id={q(r["nativeUnitId"])}')=='0'
 print('PASS actor revoked during advisory wait is rejected without audit',flush=True)
 sql(f'update public.user_profiles set active=true where user_id={q(IT)}')
 # A readiness stop during the wait must also take effect before saving.
 r=record(6);admit(r);a=args(read(r['nativeUnitId']))
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  holder=pool.submit(sql,f"begin;select pg_advisory_xact_lock(hashtextextended({q(r['nativeUnitId'])},701006));select pg_sleep(.9);commit;",DB,'rollout_holder');wait_event('rollout_holder','PgSleep')
  pending=pool.submit(run_save,a,0,'stopped_rollout');wait_event('stopped_rollout','advisory')
  sql('update app_private.cos_app_unit_address_rollout set enabled=false');holder.result();error(pending,'55000')
 assert sql(f'select count(*) from app_private.cos_app_unit_address_history where native_unit_id={q(r["nativeUnitId"])}')=='0'
 print('PASS rollout stopped during advisory wait is rejected without audit',flush=True)
 sql('update app_private.cos_app_unit_address_rollout set enabled=true')
 # A held authorization row cannot form a profile-to-native deadlock graph.
 r=record(7);admit(r);a=args(read(r['nativeUnitId']))
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  holder=pool.submit(sql,f"begin;select user_id from public.user_profiles where user_id={q(OWNER)} for update;select pg_sleep(.6);commit;",DB,'profile_holder');wait_event('profile_holder','PgSleep')
  error(lambda:run_save(a),'55P03');holder.result()
 print('PASS held authorization row causes prompt retry without inverted lock wait',flush=True)
 # Once checked under row locks, revocation is ordered after this save commit.
 r=record(8);admit(r);a=args(read(r['nativeUnitId']),IT)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  saved=pool.submit(run_save,a,.7,'authorized_save');wait_event('authorized_save','PgSleep')
  revoke=pool.submit(sql,f'update public.user_profiles set active=false where user_id={q(IT)}',DB,'late_revocation')
  wait_event('late_revocation','transactionid');saved.result();revoke.result()
 assert sql(f'select count(*) from app_private.cos_app_unit_address_history where native_unit_id={q(r["nativeUnitId"])}')=='1'
 print('PASS actor authorization remains locked until save commit',flush=True)
 # A stale transaction-wide snapshot is never used for authorization.
 r=record(9);admit(r);a=args(read(r['nativeUnitId']))
 for isolation in ['repeatable read','serializable']:
  error(lambda:run_save(a,isolation=isolation),'40001')
 print('PASS non-READ-COMMITTED address transactions are rejected',flush=True)
 print('PASS all native app address PostgreSQL concurrency regressions',flush=True)
 print('Local test log: '+str(BASE/'real-postgres.log'),flush=True)
finally:
 if server:
  server.terminate()
  try:server.wait(timeout=3)
  except subprocess.TimeoutExpired:server.kill();server.wait()
