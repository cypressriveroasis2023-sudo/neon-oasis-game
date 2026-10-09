#!/usr/bin/env python3
"""Synthetic localhost-only PostgreSQL integration and concurrency checks. No provider traffic."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, subprocess, time, uuid
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--psql',required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--library-path',default='');p.add_argument('--user',default='agent');p.add_argument('--receipt',type=pathlib.Path)
a=p.parse_args();ROOT=pathlib.Path(__file__).resolve().parents[1];DB='cos_diagnostic_test_'+uuid.uuid4().hex[:10];ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';STAMP='2026-10-08T22:00:00Z'
env={**os.environ,'LD_LIBRARY_PATH':a.library_path,'PGPASSFILE':'/tmp/no-diagnostic-credentials'}
def sql(s,db=DB,app='diagnostic_test'):
 r=subprocess.run([a.psql,'-X','--no-password','-h','127.0.0.1','-p',str(a.port),'-U',a.user,'-d',db,'-v','ON_ERROR_STOP=1','-qAt'],input=('set role postgres;' if db==DB else '')+s,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=25)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def q(x):return "'"+str(x).replace("'","''")+"'"
def jq(x):return q(json.dumps(x))+'::jsonb'
def h(s):return hashlib.sha256(s.encode()).hexdigest()
def rpc(name,args,hold=0,app='diagnostic_worker'):
 raw=sql("begin;set local time zone 'UTC';set local role service_role;select public.cos_imported_geocode_"+name+'('+','.join([q(ORG)]+args)+');'+(f'select pg_sleep({hold});' if hold else '')+'commit;',app=app)
 return json.loads(next(s for s in raw.splitlines() if s.startswith(('{','['))))
def wait_sleep(app):
 until=time.monotonic()+5
 while time.monotonic()<until:
  if sql('select count(*) from pg_stat_activity where application_name='+q(app)+" and wait_event='PgSleep'")=='1':return
  time.sleep(.02)
 raise AssertionError('held transaction did not start')
def bad(call,fragment):
 try:call()
 except RuntimeError as e:assert fragment in str(e),str(e);return
 raise AssertionError('expected rejection: '+fragment)
def binding(n,address_n=None):
 address_n=address_n or n;address=f'{address_n} main st, houston, tx 77002'
 return {'schemaVersion':1,'organizationId':ORG,'sourceSystem':'mhelpdesk_product_import','entityKind':'equipment_unit','nativeUnitId':str(uuid.uuid4()),'productId':str(n),'unitNumber':f'SPOTTER {n}','family':'SPOTTER','variant':None,'sourceRevision':str(uuid.uuid4()),'sourceFileSha256':'a'*64,'sourceRowSha256':'b'*64,'addressSha256':h(address),'nativeGuardSha256':'c'*64,'installation':{'street':f'{address_n} Main St','city':'Houston','state':'TX','zip':'77002'},'suppliedComponents':{'street':True,'city':True,'state':True,'zip':True},'eligibility':'FIELD','eventId':str(n)}
def seed(rows):
 cur=rpc('cursor_read',[])
 events=[{'eventId':b['eventId'],'entityKind':b['entityKind'],'nativeUnitId':b['nativeUnitId'],'productId':b['productId'],'sourceRevision':b['sourceRevision'],'source':b} for b in rows]
 rpc('sync',[q(cur['scanGeneration']),q(cur['eventId']),jq(events),q(rows[-1]['eventId'])])
 for b in rows:
  address=f"{b['installation']['street']}, Houston, TX 77002".lower()
  sql(f"insert into app_private.cos_imported_census_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,geocoded_at,updated_at) values({q(ORG)},{q(b['addressSha256'])},{q(address)},'no_match','no_match',1,'2026-10-08',{q(STAMP)},{q(STAMP)}) on conflict do nothing;insert into app_private.cos_field_geocode_fallback_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,geocoded_at,updated_at) values({q(ORG)},{q(b['addressSha256'])},{q(address)},'no_match','no_match',1,'2026-10-08',{q(STAMP)},{q(STAMP)}) on conflict do nothing;")
operator=(ROOT/'db/geocodio-diagnostic-recovery-v1-operator.sql').read_text()
operator_body=operator[operator.index('do $$'):operator.index('\nselect diagnostic_recovery_v1')]
def enroll(rows,hold=0,app='diagnostic_enroll'):
 manifest=[{'binding':b,'censusUpdatedAt':STAMP,'geocodioUpdatedAt':STAMP} for b in rows]
 return sql("begin;set local time zone 'America/Chicago';set local role service_role;set local lock_timeout='2s';select set_config('cos.reviewed_diagnostic_manifest',"+q(json.dumps(manifest))+',true);'+operator_body+(f'select pg_sleep({hold});' if hold else '')+'commit;',app=app)
def claim(b,hold=0,app='diagnostic_claim'):return rpc('census_claim',[jq(b),q(uuid.uuid4())],hold,app)
def finish_census(b,token,status='no_match',reason='provider_empty',current=True):
 vals=[jq(b),q(token),str(current).lower(),q(status),'29' if status=='success' else 'null','-95' if status=='success' else 'null',q(f"{b['installation']['street']}, Houston, TX 77002") if status=='success' else 'null','null' if status=='success' else q(reason)]
 return rpc('census_finish',vals)
def reserve(b,hold=0,app='diagnostic_reserve'):return rpc('reserve',[jq(b),q(uuid.uuid4())],hold,app)
def finish_geo(b,token,status='success',reason=None,current=True):
 yes=status=='success'
 return rpc('finish',[jq(b),q(token),str(current).lower(),q(status),'29' if yes else 'null','-95' if yes else 'null',q(f"{b['installation']['street']}, Houston, TX 77002") if yes else 'null',q('rooftop') if yes else 'null','1' if yes else 'null',q('building_centroid') if yes else 'null',q(reason) if reason else 'null'])
def where(b):return 'organization_id='+q(ORG)+' and address_sha256='+q(b['addressSha256'])
def due():return rpc('postal_ordinary_list_due',['80'])
def caches():return sql("select jsonb_agg(to_jsonb(c) order by address_sha256) from app_private.cos_imported_census_cache c;")+sql("select jsonb_agg(to_jsonb(c) order by address_sha256) from app_private.cos_field_geocode_fallback_cache c;")
def acl_snapshot():return sql("select jsonb_agg(x order by kind,name) from (select 'function' kind,p.oid::regprocedure::text name,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef::text extra,proconfig::text config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app_private','public') union all select 'table',c.oid::regclass::text,pg_get_userbyid(relowner),relacl::text,relrowsecurity::text,null from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app_private','public') and relkind='r' union all select 'schema',nspname,pg_get_userbyid(nspowner),nspacl::text,null,null from pg_namespace where nspname='app_private') x;")
try:
 sql("do $$ begin if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres superuser;end if;end $$;",'postgres')
 sql(f'create database {DB} owner postgres template template0 encoding \'UTF8\';','postgres')
 schema=re.search(r'const legacySchema=String.raw`(.*?)`;', (ROOT/'tests/fixtures/geocodio-database-fixture.mjs').read_text(),re.S)[1]
 schema=re.sub(r'create role (anon|authenticated);',lambda m:f"do $$ begin if not exists(select 1 from pg_roles where rolname='{m[1]}') then create role {m[1]};end if;end $$;",schema)
 schema=schema.replace('create role service_role bypassrls;',"do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;")
 sql(schema)
 for f in ['geocodio-free-fallback.sql','geocodio-postal-precision-rejections.sql','geocodio-imported-jobs.sql','geocodio-imported-postal-precision-rejections.sql','geocodio-imported-list-due-v2.sql','geocodio-postal-retry-v1.sql','geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql']:
  sql((ROOT/'db'/f).read_text())
 before=json.loads(acl_snapshot())
 signatures=["public.cos_imported_geocode_postal_ordinary_list_due(uuid,integer)","public.cos_imported_geocode_census_claim(uuid,jsonb,uuid)","public.cos_imported_geocode_reserve(uuid,jsonb,uuid)","public.cos_field_geocode_fallback_reserve(uuid,text,text,text,text,uuid)"]
 function_before={name:sql('select pg_get_functiondef('+q(name)+'::regprocedure)') for name in signatures}
 columns_before=sql("select string_agg(attname,',' order by attnum) from pg_attribute where attrelid='app_private.cos_geocodio_account_state'::regclass and attnum>0 and not attisdropped")
 postal_before=sql("select pg_get_functiondef('public.cos_imported_geocode_postal_retry_list_due(uuid,integer)'::regprocedure);")
 patch=(ROOT/'db/geocodio-diagnostic-recovery-v1.sql').read_text();sql(patch);sql(patch)
 after=json.loads(acl_snapshot());assert all(x in after for x in before)
 assert sql("select has_function_privilege('service_role','app_private.cos_diagnostic_recovery_immutable()','execute')")=='f'
 assert sql("select pg_get_functiondef('public.cos_imported_geocode_postal_retry_list_due(uuid,integer)'::regprocedure);")==postal_before
 print('PASS repeated schema application preserves every existing owner, ACL, invoker flag, search_path, RLS flag and private-schema permission')
 sql('update app_private.cos_geocodio_control set enabled=true,free_only=true;')
 rows=[binding(n) for n in range(1,37)];shared=binding(37,1);seed(rows+[shared])
 before=caches()
 bad(lambda:enroll(rows),'1 through 35')
 bad(lambda:enroll([rows[0],rows[0]]),'deduplicate')
 assert caches()==before
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(enroll,rows[:35],.5,'diagnostic_enroll_held');wait_sleep('diagnostic_enroll_held');two=pool.submit(enroll,rows[:35]);one.result();two.result()
 assert caches()==before
 started=time.perf_counter();assert len(due())==35;empty_queue_seconds=time.perf_counter()-started
 # Unrelated roster evidence exercises the real deny-only precedence scans while
 # preserving every enrolled unit's exact guard. These are synthetic records.
 sql("insert into camera_devices(id,unit_key) select 100000+n,'PERF FIXTURE '||n from generate_series(1,3000) n;insert into camera_inventory_audit(id,action,unit_key,after_state) select 100000+n,'MOVE_TO_FIELD','PERF FIXTURE '||n,'{}'::jsonb from generate_series(1,5000) n;")
 started=time.perf_counter();assert len(due())==35;populated_queue_seconds=time.perf_counter()-started
 sql('delete from camera_inventory_audit where id>100000;delete from camera_devices where id>100000;')
 queue_benchmark={'historicalSyntheticAddresses':35,'unrelatedLegacyDevices':3000,'unrelatedLegacyAudits':5000,'emptyRosterWallSeconds':empty_queue_seconds,'populatedRosterWallSeconds':populated_queue_seconds,'includesPsqlStartup':True}
 print('PASS 35-address queue benchmark:',json.dumps(queue_benchmark))
 print('PASS simultaneous exact enrollment freezes 35 hashes without changing any historical cache, requests, budget or postal cohort')
 bad(lambda:enroll(rows[1:36]),'frozen')
 bad(lambda:sql("set role service_role;update app_private.cos_geocodio_account_state set diagnostic_recovery_v1=null;"),'Invalid bounded')
 assert claim(rows[35])['claimed'] is False
 assert claim(shared)['reason']=='diagnostic_bound_elsewhere'
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(claim,rows[0],.5,'diagnostic_claim_held');wait_sleep('diagnostic_claim_held');two=pool.submit(claim,rows[0]);results=[one.result(),two.result()]
 assert sum(r['claimed'] for r in results)==1
 token=next(r['claimToken'] for r in results if r['claimed']);assert finish_census(rows[0],token)['accepted']
 assert finish_census(rows[0],token)['accepted']
 assert claim(rows[0])['reason']=='diagnostic_spent'
 assert reserve(rows[1])['reason']=='census_required'
 print('PASS concurrent Census claims deduplicate shared addresses; only enrolled exact revisions can reconsider terminal historical rejection')
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(reserve,rows[0],.5,'diagnostic_reserve_held');wait_sleep('diagnostic_reserve_held');two=pool.submit(reserve,rows[0]);results=[one.result(),two.result()]
 assert sum(r['reserved'] for r in results)==1
 token=next(r['reservationToken'] for r in results if r['reserved']);assert finish_geo(rows[0],token)['accepted'];assert finish_geo(rows[0],token)['accepted']
 assert reserve(rows[0])['reason']=='diagnostic_spent'
 assert sql('select status from app_private.cos_field_geocode_fallback_cache where '+where(rows[0]))=='success'
 assert sql('select sum(credits) from app_private.cos_geocodio_daily_budget')=='1'
 print('PASS one permanent fallback credit and idempotent real completion enter the existing automatic cache projection')
 # Census success ends this address; no fallback charge is possible.
 b=rows[1];r=claim(b);assert finish_census(b,r['claimToken'],'success')['accepted'];assert reserve(b)['reason']=='census_required'
 assert b['addressSha256'] not in [d['binding']['addressSha256'] for d in due()]
 # Failure is final for the exact diagnostic revision, across ordinary queue paths.
 b=rows[2];r=claim(b);assert finish_census(b,r['claimToken'],'provider_error','provider_unavailable')['accepted']
 sql('update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval \'1 day\' where '+where(b))
 assert claim(b)['reason']=='diagnostic_spent';assert b['addressSha256'] not in [d['binding']['addressSha256'] for d in due()]
 print('PASS Census success needs no fallback; a provider error does not trigger a second diagnostic or ordinary attempt')
 # Expired uncertain lease remains spent; cleanup records timeout and does not send.
 b=rows[3];r=claim(b)
 sql('update app_private.cos_imported_census_cache set lease_until=clock_timestamp()-interval \'1 second\' where '+where(b))
 assert claim(b)['reason']=='provider_timeout';assert claim(b)['reason']=='diagnostic_spent'
 assert sql("select outcome->>'reason' from app_private.cos_imported_census_requests where claim_token="+q(r['claimToken']))=='lease_expired'
 print('PASS uncertain expired Census lease records terminal diagnostic and cannot be resent')
 # Source drift at finish cannot publish or consume another request.
 b=rows[4];r=claim(b);sql('update app_private.cos_imported_geocode_jobs set invalidated=true where native_unit_id='+q(b['nativeUnitId']))
 assert finish_census(b,r['claimToken'],'success',current=False)['accepted'] is False
 assert claim(b)['reason']=='superseded'
 # A new Owner manual placement holds the unchanged imported revision.
 b=rows[5];sql("insert into camera_inventory_audit(id,action,unit_key,after_state) values(500,'MOVE_TO_SHOP',"+q(b['unitNumber'])+",'{\"placement\":\"SHOP\"}')")
 assert claim(b)['reason']=='superseded'
 print('PASS source drift and newer Owner decisions cannot publish recovered coordinates or acquire a diagnostic request')
 # Preserve accepted data that appeared after enrollment.
 b=rows[6];sql("update app_private.cos_field_geocode_fallback_cache set status='success',reason=null,latitude=29,longitude=-95,matched_address='7 Main St, Houston, TX 77002',accuracy_type='rooftop',provider_accuracy=1,provider_match_type='building_centroid',geocoded_at=clock_timestamp() where "+where(b))
 accepted=caches();assert claim(b)['reason']=='diagnostic_cache_changed';assert caches()==accepted
 print('PASS an accepted result arriving after enrollment is preserved byte-for-byte')
 # A separate Owner audit sharing the hash cannot bypass the diagnostic barrier.
 b=rows[9];address=f"{b['installation']['street']}, Houston, TX 77002".lower();owner='00000000-0000-4000-8000-000000000001'
 sql("insert into profiles(user_id,role,active) values("+q(owner)+",'owner',true);insert into camera_devices(id,unit_key) values(600,'OWNER TEST 600');insert into camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) values(600,"+q(owner)+",'MOVE_TO_FIELD','OWNER TEST 600','{600}',"+jq({'placement_contract':'COS_CAMERA_PLACEMENT_V2','placement':'FIELD','street_address':address})+");insert into app_private.cos_field_geocode_cache(organization_id,audit_id,unit_key,address,address_sha256,status,reason,attempts,geocoded_at,claim_token) values("+','.join([q(ORG),q('600'),q('OWNER TEST 600'),q(address),q(b['addressSha256']),q('no_match'),q('no_match'),'1','clock_timestamp()','gen_random_uuid()'])+");")
 def owner_reserve():return json.loads(sql("set role service_role;select public.cos_field_geocode_fallback_reserve("+','.join([q(ORG),q('600'),q('OWNER TEST 600'),q(address),q(b['addressSha256']),q(uuid.uuid4())])+");"))
 assert owner_reserve()['reason']=='diagnostic_address_hold'
 sql("update app_private.cos_field_geocode_cache set status='success',reason=null,latitude=30,longitude=-96,matched_address=address where audit_id='600'")
 assert claim(b)['reason']=='diagnostic_cache_changed'
 sql("update app_private.cos_field_geocode_cache set status='no_match',reason='no_match',latitude=null,longitude=null,matched_address=null where audit_id='600'")
 # A newer authoritative Owner decision suppresses the imported cohort, so the
 # ordinary Owner path retains precedence (its existing terminal cache still wins).
 sql("insert into camera_inventory_audit(id,action,unit_key,after_state) values(601,'MOVE_TO_SHOP',"+q(b['unitNumber'])+",'{\"placement\":\"SHOP\"}')")
 assert owner_reserve()['reason']=='cache_hit'
 print('PASS shared-address Owner fallback cannot bypass recovery; a newer Owner decision keeps its ordinary precedence')
 # An unrelated normal job still goes through the exact deployed ordinary selector.
 b=rows[35];sql("delete from app_private.cos_imported_census_cache where "+where(b)+";delete from app_private.cos_field_geocode_fallback_cache where "+where(b))
 assert b['addressSha256'] in [d['binding']['addressSha256'] for d in due()]
 assert claim(b)['claimed']
 print('PASS unrelated ordinary queue and claims still work with the full live precedence-aware baseline')

 # Two eligible hashes race for the final shared free-tier credit.
 for b in rows[7:9]:r=claim(b);finish_census(b,r['claimToken'])
 sql('update app_private.cos_geocodio_daily_budget set credits=2399;')
 with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(reserve,rows[7:9]))
 assert sum(r['reserved'] for r in results)==1;assert sql('select sum(credits) from app_private.cos_geocodio_daily_budget')=='2400'
 losing=rows[7:9][next(i for i,r in enumerate(results) if not r['reserved'])]
 assert sql('select status from app_private.cos_field_geocode_fallback_cache where '+where(losing))=='no_match'
 assert reserve(losing)['reason']=='budget_exhausted'
 print('PASS concurrent diagnostic reservations cannot exceed the unchanged 2400-credit budget; budget deferral preserves historical rejection')
 # Every before-image remains immutable after real request completion.
 bad(lambda:sql("set role service_role;update app_private.cos_geocodio_account_state set diagnostic_recovery_v1=jsonb_set(diagnostic_recovery_v1,array['jobs',"+q(rows[0]['addressSha256'])+",'censusRequestId'],'null'::jsonb)"),'immutable')
 assert sql('select count(*) from app_private.cos_imported_postal_retry_jobs')=='0'
 assert sql("select count(*) from app_private.cos_geocodio_reservations where job_kind<>'native_import'")=='0'
 print('PASS spent IDs cannot reset; postal tables and Owner reservations remain untouched')
 report=sql((ROOT/'db/geocodio-diagnostic-recovery-v1-report.sql').read_text());assert len(report.splitlines())==35 and 'main st' not in report.lower()
 print('PASS read-only receipt reports each exact attempt and result without addresses or source bindings')
 if a.receipt:
  trigger=json.loads(sql("select jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'securityDefiner',prosecdef,'config',proconfig) from pg_proc where oid='app_private.cos_diagnostic_recovery_immutable()'::regprocedure"))
  column=json.loads(sql("select jsonb_build_object('type',format_type(atttypid,atttypmod),'notNull',attnotnull,'acl',attacl::text,'hasDefault',atthasdef) from pg_attribute where attrelid='app_private.cos_geocodio_account_state'::regclass and attname='diagnostic_recovery_v1'"))
  receipt={'postgresVersion':sql('select version()'),'passed':True,'allExistingCatalogSecurityPreserved':True,'trigger':trigger,'column':column,'columnsBefore':columns_before,'columnsAfter':sql("select string_agg(attname,',' order by attnum) from pg_attribute where attrelid='app_private.cos_geocodio_account_state'::regclass and attnum>0 and not attisdropped"),'schemaSha256':h(patch),'baselineDefinitions':{k:{'sha256':h(v),'definition':v} for k,v in function_before.items()},'candidateDefinitions':{k:{'sha256':h(sql('select pg_get_functiondef('+q(k)+'::regprocedure)'))} for k in signatures},'providerCalls':0,'productionWrites':0,'crossSessionTimezoneTest':{'enrollment':'America/Chicago','worker':'UTC'},'queueBenchmark':queue_benchmark}
  a.receipt.write_text(json.dumps(receipt,indent=2)+'\n')
 print('ALL DIAGNOSTIC RECOVERY POSTGRES CHECKS PASSED')
finally:
 sql(f'drop database if exists {DB};','postgres')
