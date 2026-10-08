#!/usr/bin/env python3
"""Disposable localhost PostgreSQL concurrency proof. No network service, credentials or production data.
Run explicitly with --psql, --port, and (if needed) --library-path. CI canonical tests use PGlite.
"""
import argparse, concurrent.futures, hashlib, json, pathlib, re, subprocess, time, uuid
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--psql',required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--library-path',default='')
a=p.parse_args(); HERE=pathlib.Path(__file__).resolve().parent; ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';DB='cos_sources_synthetic_'+uuid.uuid4().hex[:8]
env={'PATH':'/usr/bin:/bin','LD_LIBRARY_PATH':a.library_path,'PGPASSFILE':'/tmp/no-cos-source-credentials','HOME':'/tmp'}
def sql(value,db=DB,app='cos_source_test'):
 r=subprocess.run([a.psql,'-X','--no-password','-h','127.0.0.1','-p',str(a.port),'-U','agent','-d',db,'-v','ON_ERROR_STOP=1','-qAt'],input=value,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=20)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
def quote(v):return "'"+str(v).replace("'","''")+"'"
def digest(v):return hashlib.sha256(v.encode()).hexdigest()
def rpc(r):return f"select public.cos_geocode_sources_import_reviewed('{ORG}',{quote(json.dumps([r]))}::jsonb);"
def install(r,hold=0,rollback=False,app='cos_source_worker'):
 out=sql('begin;set local role service_role;'+rpc(r)+f'select pg_sleep({hold});'+('rollback;' if rollback else 'commit;'),app=app)
 return json.loads(next(s for s in out.splitlines() if s.startswith('[')))
def count():return int(sql('select count(*) from app_private.cos_geocode_source_events'))
def reset():sql('truncate app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units;alter sequence app_private.cos_geocode_source_event_id_seq restart with 1;')
def seed(number):
 uid=str(uuid.uuid4());tid=str(uuid.uuid4());label=f'HELIOS {number}HDC4'
 sql(f"insert into public.equipment_units(id,organization_id,unit_number,status) values('{uid}','{ORG}','{label}','available');insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement,address,source_name,imported_at) values('{tid}','{ORG}','{label}','HELIOS','FIELD','1 Historical Ave','Synthetic tracker',now());")
 guard=sql(f"select app_private.cos_source_native_guard('equipment_unit','{uid}','{tid}','{label}','{label}');")
 return {'entityKind':'equipment_unit','nativeUnitId':uid,'trackerId':tid,'productId':str(number),'unitNumber':label,'trackerUnitNumber':label,'family':'HELIOS','variant':'HDC4','sourceFileSha256':digest('file'),'sourceRowSha256':digest(str(number)),'installation':{'street':'123 Main St','city':'Houston','state':'TX','zip':'77002'},'addressSha256':digest('123 main st, houston, tx 77002'),'nativeGuardSha256':guard,'previousSourceRevision':None,'placement':'FIELD'}
def wait_sleep(app):
 until=time.monotonic()+5
 while time.monotonic()<until:
  if sql(f"select count(*) from pg_stat_activity where application_name={quote(app)} and wait_event='PgSleep'")=='1':return
  time.sleep(.02)
 raise AssertionError('worker did not reach held transaction')
try:
 sql(f"create database {DB} template template0 encoding 'UTF8';",'postgres')
 schema=re.search(r'await db.exec\(`(.*?)`\);',(HERE/'fixtures/geocode-sources-database-fixture.mjs').read_text(),re.S).group(1)
 schema=re.sub(r'create role (anon|authenticated);',lambda m:f"do $$ begin if not exists(select 1 from pg_roles where rolname='{m[1]}') then create role {m[1]};end if;end $$;",schema)
 schema=schema.replace('create role service_role bypassrls;',"do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;")
 sql(schema);sql((HERE.parent/'db/cos-geocode-sources.sql').read_text());print(sql('select version()'));print('SQL SHA256:',hashlib.sha256((HERE.parent/'db/cos-geocode-sources.sql').read_bytes()).hexdigest())
 # Later committed ID can be scanned first; a full next pass recovers late IDs.
 one,two=seed(1),seed(2)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(install,one,1.0,False,'cos_source_held');wait_sleep('cos_source_held')
  second=pool.submit(install,two,0,False,'cos_source_waiter');time.sleep(.1)
  second.result();assert count()==1,'later independent writer unexpectedly blocked'
  page=json.loads(sql(f"set role service_role;select public.cos_geocode_sources_list_changes('{ORG}','0',100);"));assert [e['eventId'] for e in page['events']]==['2']
  first.result()
 assert json.loads(sql(f"set role service_role;select public.cos_geocode_sources_list_changes('{ORG}','2',100);"))['events']==[]
 assert [e['eventId'] for e in json.loads(sql(f"set role service_role;select public.cos_geocode_sources_list_changes('{ORG}','0',100);"))['events']]==['1','2']
 assert sql('select string_agg(event_id::text,\',\' order by event_id) from app_private.cos_geocode_source_events')=='1,2'
 print('PASS nonblocking IDs plus complete reconciliation recover late commits')
 # Same identity has one accepted import; stale initial import cannot overwrite it.
 reset();record=seed(3)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(install,record,1.0,False,'cos_source_held');wait_sleep('cos_source_held');second=pool.submit(install,record)
  first.result()
  try:second.result();raise AssertionError('stale import accepted')
  except RuntimeError as e:assert 'Source revision changed' in str(e)
 assert count()==1;print('PASS concurrent duplicate import has no phantom event or lost update')
 # Native physical edits serialize with admitted source and invalidate in their transaction.
 reset();record=seed(4)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(install,record,1.0,False,'cos_source_held');wait_sleep('cos_source_held')
  edit=pool.submit(sql,f"update public.equipment_units set current_location_type='shop' where id='{record['nativeUnitId']}';")
  first.result();edit.result()
 assert sql('select eligibility from app_private.cos_geocode_sources')=='tombstone';assert count()==2
 print('PASS concurrent native Shop edit invalidates admitted source atomically')
 reset();record=seed(5);install(record,rollback=True);assert count()==0
 print('PASS rollback leaves no source or audit event; sequence gaps are harmless')
 # Existing native multi-statement writers must not acquire a shared global lock.
 reset();one,two=seed(6),seed(7);install(one);install(two)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(sql,f"begin;set local deadlock_timeout='100ms';update public.equipment_units set current_location_type='shop' where id='{one['nativeUnitId']}';select pg_sleep(.5);update public.equipment_units set current_location_type='shop' where id='{two['nativeUnitId']}';commit;",DB,'cos_source_held');wait_sleep('cos_source_held')
  second=pool.submit(sql,f"begin;select id from public.equipment_units where id='{two['nativeUnitId']}' for update;select pg_sleep(.1);update public.equipment_units set current_location_type='shop' where id='{two['nativeUnitId']}';commit;")
  first.result();second.result()
 assert sql("select count(*) from app_private.cos_geocode_sources where eligibility='tombstone'")=='2'
 print('PASS native multi-statement writers have no source-global-lock deadlock')
finally:
 sql(f'drop database if exists {DB};','postgres')
