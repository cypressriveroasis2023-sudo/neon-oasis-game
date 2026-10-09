#!/usr/bin/env python3
"""Synthetic local PostgreSQL regression. Uses an existing localhost-only server; creates/drops its own database. No production calls or credentials."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, subprocess, time, uuid
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--psql',required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--library-path',default='');p.add_argument('--user',default='postgres');p.add_argument('--repo',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1])
a=p.parse_args();ROOT=a.repo;DB='cos_tracker_v2_test_'+uuid.uuid4().hex[:10];ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
env={**os.environ,'LD_LIBRARY_PATH':a.library_path,'PGPASSFILE':'/tmp/no-tracker-v2-credentials'}
def sql(s,db=DB,app='tracker_v2_test'):
 r=subprocess.run([a.psql,'-X','--no-password','-h','127.0.0.1','-p',str(a.port),'-U',a.user,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-qAt'],input=s,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=12)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def q(v):return "'"+str(v).replace("'","''")+"'"
def h(v):return hashlib.sha256(v.encode()).hexdigest()
def new_record(n):
 uid=str(uuid.uuid4());full=f'Solar Pole 72|{n:03}';label=full.replace('|',' ')
 return {'entityKind':'tracker','nativeUnitId':uid,'trackerId':uid,'sourceSystem':'google_sheet_tracker','sourceRecordId':f'google_sheet:synthetic_sheet_123:12:{full}','sourceProvenance':{'sheetId':'synthetic_sheet_123','tabId':'12','fullIdentity':full,'sourceRange':f'A{n}:L{n}'},'createTracker':True,'unitNumber':label,'trackerUnitNumber':label,'family':'Solar Pole 72','trackerFamily':'SOLAR POLES & SKIDS','variant':None,'sourceFileSha256':h('synthetic file'),'sourceRowSha256':h(str(n)),'installation':{'street':'123 Main St','city':'Houston','state':'TX','zip':'77002'},'addressSha256':h('123 main st, houston, tx 77002'),'previousSourceRevision':None,'placement':'FIELD','siteLabel':'Synthetic site','customerLabel':'Synthetic customer'}
def identity(s):return {k:s[k] for k in ['entityKind','nativeUnitId','sourceSystem','sourceRecordId','sourceRevision']}
def command(kind,rows):return f'select app_private.cos_tracker_sources_admin_{kind}({q(ORG)},{q(json.dumps(rows))}::jsonb);'
def action(kind,rows,hold=0,app='tracker_v2_action',rollback=False):
 raw=sql('begin;'+command(kind,rows)+f'select pg_sleep({hold});'+('rollback;' if rollback else 'commit;'),app=app)
 return json.loads(next(x for x in raw.splitlines() if x.startswith('[')))
def wait_sleep(app):
 end=time.monotonic()+4
 while time.monotonic()<end:
  if sql(f"select count(*) from pg_stat_activity where application_name={q(app)} and wait_event='PgSleep'")=='1':return
  time.sleep(.02)
 raise AssertionError('held worker did not start')
def expected_error(task,fragment):
 try:task.result() if hasattr(task,'result') else task()
 except RuntimeError as e:assert fragment in str(e),str(e);return
 raise AssertionError('expected rejection: '+fragment)
def count(table):return int(sql('select count(*) from '+table))
def revised(r,s):return {**r,'createTracker':False,'previousSourceRevision':s['sourceRevision'],'nativeGuardSha256':s['nativeGuardSha256'],'installation':{**r['installation'],'street':'124 Main St'},'addressSha256':h('124 main st, houston, tx 77002')}
try:
 sql(f'create database {DB} template template0 encoding \'UTF8\';','postgres')
 schema=re.search(r'await db.exec\(`(.*?)`\);',(ROOT/'tests/fixtures/geocode-sources-database-fixture.mjs').read_text(),re.S)[1]
 schema=re.sub(r'create role (anon|authenticated);',lambda m:f"do $$ begin if not exists(select 1 from pg_roles where rolname='{m[1]}') then create role {m[1]};end if;end $$;",schema)
 schema=schema.replace('create role service_role bypassrls;',"do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;")
 sql(schema);sql('alter table app_private.vision_tracker_locations add column if not exists customer text;')
 for f in ['cos-geocode-sources.sql','cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql']:sql((ROOT/'db'/f).read_text())
 sql('revoke usage on schema app_private from service_role;')
 print(sql('select version();'))
 print('Migration SHA256:',h((ROOT/'db/cos-tracker-source-v2.sql').read_text()))
 # An opposite-order native writer must not be aborted by V2 membership locks.
 uid,tid=str(uuid.uuid4()),str(uuid.uuid4())
 sql(f"insert into equipment_units(id,organization_id,unit_number,status) values('{uid}','{ORG}','HELIOS 099','available');insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement) values('{tid}','{ORG}','HELIOS 099','HELIOS','FIELD');")
 r=new_record(1)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  writer=pool.submit(sql,f"begin;set local deadlock_timeout='100ms';update app_private.vision_tracker_locations set address='Synthetic address' where id='{tid}';select pg_sleep(.6);update equipment_units set status='available' where id='{uid}';commit;",DB,'tracker_v2_native_writer')
  wait_sleep('tracker_v2_native_writer');admit=pool.submit(action,'import_reviewed',[r]);expected_error(admit,'55P03');writer.result()
 assert count('app_private.cos_geocode_sources')==0
 print('PASS creation fails fast with 55P03; opposite-order native writer commits')
 # A retry after rollback succeeds, and two creators never create duplicate identities.
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(action,'import_reviewed',[r],.5,'tracker_v2_creator');wait_sleep('tracker_v2_creator')
  second=pool.submit(action,'import_reviewed',[r]);expected_error(second,'55P03');s=first.result()[0]
 assert count('app_private.cos_geocode_sources')==1 and count('app_private.cos_geocode_source_events')==1
 print('PASS creation retry succeeds and competing creator leaves no duplicate or phantom event')
 # Re-import wins before a stale revoke: stale revocation must not cancel the new revision.
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  update=pool.submit(action,'import_reviewed',[revised(r,s)],.5,'tracker_v2_reimport');wait_sleep('tracker_v2_reimport')
  revoke=pool.submit(action,'revoke_reviewed',[identity(s)]);s2=update.result()[0];expected_error(revoke,'40001')
 assert sql(f"select active from app_private.cos_geocode_sources where native_unit_id='{r['nativeUnitId']}'")=='t'
 print('PASS concurrent stale revoke cannot cancel a newer admitted revision')
 # Revoke wins before a stale re-import: old reviewed data cannot resurrect it.
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  revoke=pool.submit(action,'revoke_reviewed',[identity(s2)],.5,'tracker_v2_revoke');wait_sleep('tracker_v2_revoke')
  update=pool.submit(action,'import_reviewed',[revised(r,s2)]);revoke.result();expected_error(update,'40001')
 assert sql(f"select active from app_private.cos_geocode_sources where native_unit_id='{r['nativeUnitId']}'")=='f'
 print('PASS concurrent stale re-import cannot resurrect a revoked revision')
 # A new tracker must also be distinct from every registered equipment UUID.
 collision=new_record(2)
 sql(f"insert into equipment_units(id,organization_id,unit_number,status) values('{collision['nativeUnitId']}','{ORG}','HELIOS 100','available');")
 expected_error(lambda:action('import_reviewed',[collision]),'already exists')
 assert sql(f"select count(*) from app_private.vision_tracker_locations where id='{collision['nativeUnitId']}'")=='0'
 print('PASS creation rejects unrelated registered equipment with the same native UUID')
 # A transaction rollback creates no asset, source, or event.
 rollback=new_record(3);before=(count('app_private.vision_tracker_locations'),count('app_private.cos_geocode_sources'),count('app_private.cos_geocode_source_events'))
 action('import_reviewed',[rollback],rollback=True)
 assert before==(count('app_private.vision_tracker_locations'),count('app_private.cos_geocode_sources'),count('app_private.cos_geocode_source_events'))
 print('PASS transaction rollback leaves no new tracker, source, or event')
finally:
 sql(f'drop database if exists {DB};','postgres')
