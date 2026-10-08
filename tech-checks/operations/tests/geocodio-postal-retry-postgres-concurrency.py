#!/usr/bin/env python3
"""Disposable loopback PostgreSQL concurrency test. Synthetic schema/data only; never target production.
Run with explicit --psql and --port, optionally --library-path and --queue-v2-sql.
"""
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, subprocess, time, uuid
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--psql',required=True);p.add_argument('--port',required=True,type=int)
p.add_argument('--library-path',default='');p.add_argument('--queue-v2-sql')
a=p.parse_args();HERE=pathlib.Path(__file__).resolve().parent;DB='cos_postal_synthetic_'+uuid.uuid4().hex[:8]
ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
env={**os.environ,'LD_LIBRARY_PATH':a.library_path,'PGPASSFILE':'/tmp/no-cos-postal-credentials'}
def sql(value,db=DB,app='postal_test'):
 r=subprocess.run([a.psql,'-X','--no-password','-h','127.0.0.1','-p',str(a.port),'-U','agent','-d',db,'-v','ON_ERROR_STOP=1','-qAt'],input=value,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=25)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def q(value):return "'"+str(value).replace("'","''")+"'"
def jsonq(value):return q(json.dumps(value))+'::jsonb'
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def rpc(name,args,hold=0,app='postal_worker'):
 out=sql('begin;set local role service_role;select public.cos_imported_geocode_'+name+'('+','.join([q(ORG)]+args)+');'+(f'select pg_sleep({hold});' if hold else '')+'commit;',app=app)
 return json.loads(next(line for line in out.splitlines() if line.startswith(('{','['))))
def wait_sleep(app):
 until=time.monotonic()+5
 while time.monotonic()<until:
  if sql('select count(*) from pg_stat_activity where application_name='+q(app)+" and wait_event='PgSleep'")=='1':return
  time.sleep(.02)
 raise AssertionError('transaction did not reach held state')
def binding(number):
 address=f'{number} main st, houston, tx 77002-1234'
 return {'schemaVersion':1,'organizationId':ORG,'sourceSystem':'mhelpdesk_product_import','entityKind':'equipment_unit','nativeUnitId':str(uuid.uuid4()),'productId':str(number),'unitNumber':f'SPOTTER {number}','family':'SPOTTER','variant':None,'sourceRevision':str(uuid.uuid4()),'sourceFileSha256':'a'*64,'sourceRowSha256':'b'*64,'addressSha256':digest(address),'nativeGuardSha256':'c'*64,'installation':{'street':f'{number} Main St','city':'Houston','state':'TX','zip':'77002-1234'},'suppliedComponents':{'street':True,'city':True,'state':True,'zip':True},'eligibility':'FIELD','eventId':str(number)}
def seed(rows):
 cursor=rpc('cursor_read',[])
 events=[{'eventId':b['eventId'],'entityKind':b['entityKind'],'nativeUnitId':b['nativeUnitId'],'productId':b['productId'],'sourceRevision':b['sourceRevision'],'source':b} for b in rows]
 rpc('sync',[q(cursor['scanGeneration']),q('0'),jsonq(events),q(rows[-1]['eventId'])])
 for b in rows:
  address=f"{b['installation']['street']}, Houston, TX 77002-1234".lower()
  sql(f"insert into app_private.cos_imported_census_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,geocoded_at) values({q(ORG)},{q(b['addressSha256'])},{q(address)},'no_match','no_match',1,(clock_timestamp() at time zone 'America/New_York')::date,clock_timestamp());insert into app_private.cos_field_geocode_fallback_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,geocoded_at) values({q(ORG)},{q(b['addressSha256'])},{q(address)},'no_match','no_match',1,(clock_timestamp() at time zone 'America/New_York')::date,clock_timestamp());")
def claim(b,hold=0,app='postal_claim'):return rpc('census_claim',[jsonq(b),q(uuid.uuid4())],hold,app)
def census_finish(b,token):return rpc('census_finish',[jsonq(b),q(token),'true',q('no_match'),'null','null','null',q('provider_empty')])
def reserve(b,hold=0,app='postal_reserve'):return rpc('reserve',[jsonq(b),q(uuid.uuid4())],hold,app)
def reset():
 sql("truncate app_private.cos_imported_postal_retry_jobs,app_private.cos_imported_postal_retry_batches;truncate app_private.cos_imported_geocode_jobs,app_private.cos_imported_geocode_events,app_private.cos_imported_census_requests,app_private.cos_imported_census_cache;truncate app_private.cos_field_geocode_fallback_cache,app_private.cos_geocodio_reservations,app_private.cos_geocodio_daily_budget;update app_private.cos_imported_geocode_cursor set event_id=0,scan_generation=gen_random_uuid(),last_page_count=null;")
try:
 sql(f'create database {DB} template template0 encoding '+q('UTF8')+';','postgres')
 schema=re.search(r'const legacySchema=String.raw`(.*?)`;', (HERE/'fixtures/geocodio-database-fixture.mjs').read_text(),re.S).group(1)
 schema=re.sub(r'create role (anon|authenticated);',lambda m:f"do $$ begin if not exists(select 1 from pg_roles where rolname='{m[1]}') then create role {m[1]};end if;end $$;",schema)
 schema=schema.replace('create role service_role bypassrls;',"do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;")
 sql(schema)
 for name in ['geocodio-free-fallback.sql','geocodio-postal-precision-rejections.sql','geocodio-imported-jobs.sql','geocodio-imported-postal-precision-rejections.sql']:
  sql((HERE.parent/'db'/name).read_text())
 if a.queue_v2_sql:sql(pathlib.Path(a.queue_v2_sql).read_text())
 before=sql("select pg_get_functiondef('public.cos_imported_geocode_list_due(uuid,integer)'::regprocedure)")
 migration=(HERE.parent/'db/geocodio-postal-retry-v1.sql').read_text();sql(migration);sql(migration)
 assert sql("select pg_get_functiondef('public.cos_imported_geocode_list_due(uuid,integer)'::regprocedure)")==before
 sql('update app_private.cos_geocodio_control set enabled=true,free_only=true;')
 b=binding(1);seed([b])
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(rpc,'postal_retry_enroll',[jsonq([b])],1,'postal_enroll_held');wait_sleep('postal_enroll_held')
  second=pool.submit(rpc,'postal_retry_enroll',[jsonq([b])]);results=[first.result(),second.result()]
 assert sorted(x['enrolled'] for x in results)==[0,1]
 assert sql('select count(*) from app_private.cos_imported_postal_retry_jobs')=='1'
 assert sql("select status||'|'||attempts::text from app_private.cos_imported_census_cache")=='no_match|1'
 print('PASS concurrent exact enrollment creates one marker and preserves terminal status')
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(claim,b,1,'postal_claim_held');wait_sleep('postal_claim_held');second=pool.submit(claim,b)
  claims=[first.result(),second.result()]
 assert sum(x['claimed'] is True for x in claims)==1
 assert sql('select count(*) from app_private.cos_imported_census_requests')=='1'
 token=next(x['claimToken'] for x in claims if x['claimed']);census_finish(b,token)
 print('PASS concurrent Census claims create one request; old no_match is replaced only by real lease')
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  first=pool.submit(reserve,b,1,'postal_reserve_held');wait_sleep('postal_reserve_held');second=pool.submit(reserve,b)
  reservations=[first.result(),second.result()]
 assert sum(x['reserved'] is True for x in reservations)==1
 assert sql('select sum(credits) from app_private.cos_geocodio_daily_budget')=='1'
 assert sql('select geocodio_claims from app_private.cos_imported_postal_retry_jobs')=='1'
 print('PASS concurrent Geocodio reservations produce one send token and one permanent credit')
 token=next(x['reservationToken'] for x in reservations if x['reserved'])
 sql('update app_private.cos_imported_geocode_jobs set invalidated=true;')
 finished=rpc('finish',[jsonq(b),q(token),'false',q('success'),'29','-95',q('1 Main St, Houston, TX 77002'),q('rooftop'),'1',q('building_centroid')])
 assert finished['accepted'] is False
 assert sql('select sum(credits) from app_private.cos_geocodio_daily_budget')=='1'
 assert sql("select count(*) from app_private.cos_field_geocode_fallback_cache where status='success'")=='0'
 print('PASS changed-source finish cannot publish or refund a charged attempt')
 reset();rows=[binding(1),binding(2)];seed(rows);rpc('postal_retry_enroll',[jsonq(rows)])
 for item in rows:census_finish(item,claim(item)['claimToken'])
 sql("insert into app_private.cos_geocodio_daily_budget values((clock_timestamp() at time zone 'America/New_York')::date,2399)")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  results=list(pool.map(reserve,rows))
 assert sum(x['reserved'] is True for x in results)==1
 assert sql('select sum(credits) from app_private.cos_geocodio_daily_budget')=='2400'
 assert sql("select count(*) from app_private.cos_field_geocode_fallback_cache where status='no_match' and attempts=1")=='1'
 print('PASS final daily credit serialized across two retry hashes; losing row stays historical no_match')
 print('PASS exact optimized list_due remains unchanged after repeated retry migration')
finally:
 try:sql(f'drop database if exists {DB};','postgres')
 except Exception as error:print('Cleanup error:',type(error).__name__)
