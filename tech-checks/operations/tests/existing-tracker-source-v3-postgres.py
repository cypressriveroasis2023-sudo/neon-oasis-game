#!/usr/bin/env python3
"""Local synthetic PostgreSQL V3 upgrade/ACL/concurrency regression. Starts its own localhost-only disposable server, no credentials or production calls."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, socket, subprocess, tempfile, time, uuid
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--bin-dir',required=True,type=pathlib.Path);p.add_argument('--performance',action='store_true',help='Check bounded guard calls on mixed 470 V1/V2 + 29 V3 and 250 V3 stress cohorts');p.add_argument('--library-path',default='');p.add_argument('--repo',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]);a=p.parse_args();ROOT=a.repo;ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
env={**os.environ,'LD_LIBRARY_PATH':a.library_path,'PGPASSFILE':'/tmp/no-v3-test-credentials'};directory=pathlib.Path(tempfile.mkdtemp(prefix='cos-existing-tracker-v3-pg-'));server=None
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
def q(x):return "'"+str(x).replace("'","''")+"'"
def h(x):return hashlib.sha256(x.encode()).hexdigest()
def sql(s,db='native',app='v3_test'):
 r=subprocess.run([str(a.bin_dir/'psql'),'-X','--no-password','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-qAt'],input=s,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=20)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def data(s,db='native'):return json.loads(sql(s,db))
executed_migrations={}
def migrate(name,db='native'):
 statement=(ROOT/'db'/name).read_text();executed_migrations[db+'/'+name]=h(statement);sql(statement,db)
def roles(s):return re.sub(r'create role (anon|authenticated|service_role)( bypassrls)?;',lambda m:f"do $$ begin if not exists(select 1 from pg_roles where rolname='{m[1]}') then {m[0]} end if;end $$;",s)
def props(db='native'):return data("select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private');",db)
def snapshot(db='native'):return data("select jsonb_object_agg(n.nspname||'.'||c.relname,c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relkind in ('r','S');",db)
def same_existing(old,new):
 by={(x['schema'],x['name'],x['args']):x for x in new}
 for x in old:assert by[x['schema'],x['name'],x['args']]==x,x

def record(n=1,kind='equipment_unit'):
 uid,tid=str(uuid.uuid4()),str(uuid.uuid4());label=f'Spotter {n:03}';full=f'Spotter|{n:03}'
 sql(f"insert into equipment_units(id,organization_id,unit_number,status) values({q(uid)},{q(ORG)},{q(label)},'available');insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement) values({q(tid)},{q(ORG)},{q(label)},'Spotter','FIELD');")
 r={'entityKind':kind,'nativeUnitId':uid,'trackerId':tid,'sourceSystem':'google_sheet_tracker','sourceRecordId':f'google_sheet:synthetic_sheet_123:12:{full}','sourceProvenance':{'sheetId':'synthetic_sheet_123','tabId':'12','fullIdentity':full,'sourceRange':f'A{n}:L{n}','sourceRangeSha256':h('synthetic range'+str(n))},'unitNumber':label,'trackerUnitNumber':label,'family':'Spotter','variant':None,'sourceFileSha256':h('synthetic file'),'sourceRowSha256':h(str(n)),'installation':{'street':'123 Main St','city':'Houston','state':'TX','zip':'77002'},'addressSha256':h('123 main st, houston, tx 77002'),'previousSourceRevision':None,'placement':'FIELD'}
 r['nativeGuardSha256']=sql(f"select app_private.cos_existing_tracker_source_guard({q(uid)},{q(tid)},{q(label)},{q(label)});");return r

def command(r):return f'select app_private.cos_existing_tracker_sources_admin_import_reviewed({q(ORG)},{q(json.dumps([r]))}::jsonb);'
def admit(r,hold=0,app='v3_admit'):
 raw=sql('begin;'+command(r)+f'select pg_sleep({hold});commit;',app=app);return json.loads(next(x for x in raw.splitlines() if x.startswith('[')))[0]
def deny(task,fragment):
 try:task.result() if hasattr(task,'result') else task()
 except RuntimeError as e:assert fragment in str(e),str(e);return
 raise AssertionError('expected '+fragment)
def wait_sleep(app):
 end=time.monotonic()+5
 while time.monotonic()<end:
  if sql(f"select count(*) from pg_stat_activity where application_name={q(app)} and wait_event='PgSleep';")=='1':return
  time.sleep(.02)
 raise AssertionError('worker did not sleep')
try:
 subprocess.run([str(a.bin_dir/'initdb'),'-D',str(directory),'-U','postgres','--no-locale','--encoding=UTF8','-A','trust'],env=env,check=True,capture_output=True)
 log=(directory/'server.log').open('w');server=subprocess.Popen([str(a.bin_dir/'postgres'),'-D',str(directory),'-p',str(port),'-c','listen_addresses=127.0.0.1','-c','unix_socket_directories=','-c','fsync=off'],env=env,stdout=log,stderr=log)
 for _ in range(100):
  if subprocess.run([str(a.bin_dir/'pg_isready'),'-h','127.0.0.1','-p',str(port)],env=env,capture_output=True).returncode==0:break
  time.sleep(.05)
 else:raise RuntimeError('server startup failed')
 for db in ['native','legacy']:sql(f'create database {db};','postgres')
 native_schema=re.search(r'await db.exec\(`(.*?)`\);',(ROOT/'tests/fixtures/geocode-sources-database-fixture.mjs').read_text(),re.S)[1]
 extra_schema=re.search(r'export const extraSchema=`(.*?)`;', (ROOT/'tests/fixtures/existing-tracker-source-v3-fixture.mjs').read_text(),re.S)[1]
 sql(roles(native_schema));sql(extra_schema)
 for f in ['cos-geocode-sources.sql','cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql','source-precedence-contract.sql','cos-source-precedence.sql']:migrate(f)
 sql('revoke usage on schema app_private from service_role;')
 old_props,old_tables=props(),snapshot()
 # Seed an old mHelp source before upgrade, then prove exact row and DTO preservation.
 uid,tid=str(uuid.uuid4()),str(uuid.uuid4());sql(f"insert into equipment_units(id,organization_id,unit_number,status) values('{uid}','{ORG}','HELIOS 099HDC4','available');insert into app_private.vision_tracker_locations(id,organization_id,unit_number,placement) values('{tid}','{ORG}','HELIOS 099HDC4','FIELD');")
 old_record={'entityKind':'equipment_unit','nativeUnitId':uid,'trackerId':tid,'productId':'12345','unitNumber':'HELIOS 099HDC4','trackerUnitNumber':'HELIOS 099HDC4','family':'HELIOS','variant':'HDC4','sourceFileSha256':h('file'),'sourceRowSha256':h('row'),'installation':{'street':'123 Main St','city':'Houston','state':'TX','zip':'77002'},'addressSha256':h('123 main st, houston, tx 77002'),'nativeGuardSha256':sql(f"select app_private.cos_source_native_guard('equipment_unit','{uid}','{tid}','HELIOS 099HDC4','HELIOS 099HDC4');"),'previousSourceRevision':None,'placement':'FIELD'}
 old_source=data(f"select app_private.cos_geocode_sources_admin_import_reviewed('{ORG}',{q(json.dumps([old_record]))}::jsonb);")[0]
 tracker_id=str(uuid.uuid4());tracker={**old_record,'entityKind':'tracker','nativeUnitId':tracker_id,'trackerId':tracker_id,'unitNumber':'Solar Pole 72 003','trackerUnitNumber':'Solar Pole 72 003','family':'Solar Pole 72','trackerFamily':'SOLAR POLES & SKIDS','variant':None,'sourceSystem':'google_sheet_tracker','sourceRecordId':'google_sheet:synthetic_sheet_123:12:Solar Pole 72|003','sourceProvenance':{'sheetId':'synthetic_sheet_123','tabId':'12','fullIdentity':'Solar Pole 72|003','sourceRange':'A3:L3'},'createTracker':True};del tracker['productId'];del tracker['nativeGuardSha256']
 old_tracker=data(f"select app_private.cos_tracker_sources_admin_import_reviewed('{ORG}',{q(json.dumps([tracker]))}::jsonb);")[0]
 protected_before=sql("select jsonb_build_object('native',(select jsonb_agg(to_jsonb(u) order by id) from equipment_units u),'tracker',(select jsonb_agg(to_jsonb(t) order by id) from app_private.vision_tracker_locations t));")
 old_rows=sql("select jsonb_agg(to_jsonb(s)||jsonb_build_object('dto',app_private.cos_source_record(s)) order by native_unit_id) from app_private.cos_geocode_sources s;")
 migrate('cos-existing-tracker-source-v3.sql');same_existing(old_props,props());assert snapshot()==old_tables
 assert sql("select jsonb_agg(to_jsonb(s)||jsonb_build_object('dto',app_private.cos_source_record(s)) order by native_unit_id) from app_private.cos_geocode_sources s;")==old_rows
 assert data(f"select app_private.cos_geocode_sources_admin_import_reviewed('{ORG}',{q(json.dumps([{**old_record,'previousSourceRevision':old_source['sourceRevision']}]))}::jsonb);")[0]==old_source
 assert data(f"select app_private.cos_tracker_sources_admin_import_reviewed('{ORG}',{q(json.dumps([{**tracker,'createTracker':False,'nativeGuardSha256':old_tracker['nativeGuardSha256'],'previousSourceRevision':old_tracker['sourceRevision']}]))}::jsonb);")[0]==old_tracker
 assert sql("select jsonb_build_object('native',(select jsonb_agg(to_jsonb(u) order by id) from equipment_units u),'tracker',(select jsonb_agg(to_jsonb(t) order by id) from app_private.vision_tracker_locations t));")==protected_before
 print('PASS real PostgreSQL upgrade preserves V1/V2 rows, DTOs, both old import no-ops, native/property epochs, and all ACL/owners/definer/search_path properties')
 for role in ['anon','authenticated','service_role']:
  assert sql(f"select has_function_privilege('{role}','app_private.cos_existing_tracker_sources_admin_import_reviewed(uuid,jsonb)','EXECUTE');")=='f'
  deny(lambda:sql(f"set role {role};select app_private.cos_existing_tracker_sources_admin_import_reviewed('{ORG}','[]');"),'42501')
 sql("create role v3_synthetic_caller;grant usage on schema app_private to v3_synthetic_caller;grant execute on function app_private.cos_existing_tracker_sources_admin_import_reviewed(uuid,jsonb) to v3_synthetic_caller;")
 deny(lambda:sql(f"set role v3_synthetic_caller;select app_private.cos_existing_tracker_sources_admin_import_reviewed('{ORG}','[]');"),'Existing SQL administrator required')
 assert sql("select has_schema_privilege('service_role','app_private','USAGE');")=='f'
 r=record();s=admit(r);assert s['schemaVersion']==3 and 'productId' not in s
 key={k:s[k] for k in ['entityKind','nativeUnitId','sourceSystem','sourceRecordId','sourceRevision']}
 assert data(f"set role service_role;select public.cos_geocode_sources_read_current_batch('{ORG}',{q(json.dumps([key]))}::jsonb);")['sources']==[s]
 print('PASS real postgres-only invoker and service bounded read with private-schema USAGE=false')
 next_record={**r,'previousSourceRevision':s['sourceRevision'],'installation':{**r['installation'],'street':'124 Main St'},'addressSha256':h('124 main st, houston, tx 77002')}
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(admit,next_record,.4,'v3_cas_hold');wait_sleep('v3_cas_hold');two=pool.submit(admit,next_record);new=one.result();deny(two,'40001')
 assert sql('select count(*) from app_private.cos_geocode_source_events;')=='4'
 print('PASS concurrent same-revision admission has one winner, no phantom event')
 r2=record(2)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  writer=pool.submit(sql,f"begin;update app_private.vision_tracker_locations set address='new address' where id={q(r2['trackerId'])};select pg_sleep(.4);update equipment_units set status='available' where id={q(r2['nativeUnitId'])};commit;",'native','v3_native_writer');wait_sleep('v3_native_writer');deny(lambda:admit(r2),'55P03');writer.result()
 print('PASS admission fails fast behind operational writer; writer commits')
 if a.performance:
  v1_template=data("select to_jsonb(s) from app_private.cos_geocode_sources s where source_system='mhelpdesk_product_import' limit 1;")
  v2_template=data("select to_jsonb(s) from app_private.cos_geocode_sources s where source_system='google_sheet_tracker' and entity_kind='tracker' limit 1;")
  for cohort,v1_count,v2_count,v3_count,inventory_size in [('mixed',235,235,29,800),('stress',1,1,250,1052)]:
   sql('truncate app_private.cos_source_precedence_decisions,app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations,public.mhelpdesk_equipment_catalog,app_private.vision_source_inventory_v1;')
   source_rows=[];v1=[];v2=[];units=[];trackers=[]
   for n in range(v1_count):
    nid,tid=str(uuid.uuid4()),str(uuid.uuid4());label='Helios '+str(20000+n)+'HDC4'
    units.append({'id':nid,'organization_id':ORG,'unit_number':label,'status':'available'})
    trackers.append({'id':tid,'organization_id':ORG,'unit_number':label,'family':'Helios','placement':'FIELD'})
    source_rows.append({**v1_template,'native_unit_id':nid,'tracker_id':tid,'unit_number':label,'tracker_unit_number':label,'product_id':str(600000+n),'family':'Helios'})
    v1.append({'entityKind':'equipment_unit','nativeUnitId':nid})
   for n in range(v2_count):
    tid=str(uuid.uuid4());number=str(30000+n);full='Solar Pole 72|'+number;label=full.replace('|',' ')
    trackers.append({'id':tid,'organization_id':ORG,'unit_number':label,'family':'SOLAR POLES & SKIDS','placement':'FIELD'})
    source_rows.append({**v2_template,'native_unit_id':tid,'tracker_id':tid,'unit_number':label,'tracker_unit_number':label,'source_record_id':'google_sheet:synthetic_sheet_123:12:'+full,'source_provenance':{'sheetId':'synthetic_sheet_123','tabId':'12','fullIdentity':full,'sourceRange':f'A{n+1}:L{n+1}'}})
    v2.append({'entityKind':'tracker','nativeUnitId':tid})
   sql(f"insert into equipment_units select * from jsonb_populate_recordset(null::equipment_units,{q(json.dumps(units))}::jsonb);insert into app_private.vision_tracker_locations select * from jsonb_populate_recordset(null::app_private.vision_tracker_locations,{q(json.dumps(trackers))}::jsonb);")
   bench_records=[record(1000+n) for n in range(v3_count)]
   sql(f"insert into equipment_units(id,organization_id,unit_number,status) select gen_random_uuid(),'{ORG}','Other '||n,'available' from generate_series(1,{inventory_size-v1_count-v3_count}) n;insert into app_private.vision_tracker_locations(id,organization_id,unit_number,placement) select gen_random_uuid(),'{ORG}','Other '||n,'FIELD' from generate_series(1,{inventory_size-v1_count-v2_count-v3_count}) n;")
   sql(f"insert into equipment_unit_location_history(organization_id,equipment_unit_id) select '{ORG}',gen_random_uuid() from generate_series(1,1000);insert into app_private.cos_owner_identity_claims(organization_id,native_unit_id,native_unit_label) select '{ORG}',gen_random_uuid(),'Unrelated '||n from generate_series(1,1000) n;insert into mhelpdesk_equipment_catalog(organization_id,product_id,product_model) select '{ORG}',n,'Unrelated '||n from generate_series(1,2000) n;insert into app_private.vision_source_inventory_v1(organization_id,registered_unit_id,unit_label,source_record_id) select '{ORG}',gen_random_uuid(),'Unrelated '||n,'other:'||n from generate_series(1,2000) n;")
   source_rows=data(f"select jsonb_agg(x||jsonb_build_object('native_guard_sha256',app_private.cos_source_native_guard(x->>'entity_kind',(x->>'native_unit_id')::uuid,(x->>'tracker_id')::uuid,x->>'unit_number',x->>'tracker_unit_number'))) from jsonb_array_elements({q(json.dumps(source_rows))}::jsonb) x;")
   sql(f"insert into app_private.cos_geocode_sources select * from jsonb_populate_recordset(null::app_private.cos_geocode_sources,{q(json.dumps(source_rows))}::jsonb);")
   sql(f'select jsonb_array_length(app_private.cos_existing_tracker_sources_admin_import_reviewed({q(ORG)},{q(json.dumps(bench_records))}::jsonb));')
   print('PERFORMANCE COHORT '+json.dumps({'cohort':cohort,'v1':v1_count,'v2':v2_count,'v3':v3_count,'nativeInventory':inventory_size,'trackerInventory':inventory_size,'history':1000,'OwnerClaims':1000,'mHelpCatalog':2000,'sourceInventory':2000,'migrationSha256':executed_migrations['native/cos-existing-tracker-source-v3.sql']}),flush=True)
   v3=[{'entityKind':'equipment_unit','nativeUnitId':r['nativeUnitId']} for r in bench_records]
   batches=[('one_v1',v1[:1],0),('one_v3',v3[:1],1),('ten_v3',v3[:10],min(10,v3_count)),('all_v3',v3,v3_count),('mixed_250',(v1+v2+v3)[:250],max(0,min(v3_count,250-v1_count-v2_count)))]
   for label,keys,expected_v3 in batches:
    for reader in ['read_many','map_projection']:
     sql('select pg_stat_reset();')
     query=f"set track_functions='all';set role service_role;with started as materialized(select clock_timestamp() t), done as materialized(select public.cos_geocode_sources_{reader}('{ORG}',{q(json.dumps(keys))}::jsonb) result from started) select jsonb_build_object('cohort',{q(cohort)},'batch',{q(label)},'reader',{q(reader)},'rows',jsonb_array_length(result),'ms',extract(epoch from (clock_timestamp()-t))*1000) from started,done;"
     timing=data(query)
     counts=data("select coalesce(jsonb_object_agg(funcname,calls),'{}') from pg_stat_user_functions where schemaname='app_private' and calls>0;")
     assert timing['rows']==len(keys),(timing,len(keys))
     assert counts.get('cos_source_current_guard',0)==len(keys),(timing,counts)
     assert counts.get('cos_existing_tracker_source_guard',0)==expected_v3,(timing,counts)
     print('PERFORMANCE '+json.dumps({**timing,'guardCalls':counts.get('cos_source_current_guard',0),'v3GuardCalls':counts.get('cos_existing_tracker_source_guard',0),'labelCalls':counts.get('cos_source_label',0)}),flush=True)
   for write_kind,statement,expected in [
    ('unrelated_native',"update equipment_units set health_last_seen=clock_timestamp() where unit_number='Other 1'",0),
    ('unrelated_tracker',"update app_private.vision_tracker_locations set address='Unrelated address' where unit_number='Other 1'",0),
    ('related_health',f"update equipment_units set health_last_seen=clock_timestamp() where id={q(bench_records[1]['nativeUnitId'])}",1)]:
    preserved=sql("select jsonb_agg(to_jsonb(s) order by native_unit_id) from app_private.cos_geocode_sources s;")
    sql('select pg_stat_reset();')
    plan=data(f"set track_functions='all';explain (analyze,format json) {statement} returning id;")[0]
    result={'rows':plan['Plan']['Actual Rows'],'ms':plan['Execution Time']}
    counts=data("select coalesce(jsonb_object_agg(funcname,calls),'{}') from pg_stat_user_functions where schemaname='app_private' and calls>0;")
    assert counts.get('cos_source_current_guard',0)==expected,(write_kind,counts)
    assert counts.get('cos_existing_tracker_source_guard',0)==expected,(write_kind,counts)
    assert sql("select jsonb_agg(to_jsonb(s) order by native_unit_id) from app_private.cos_geocode_sources s;")==preserved
    print('TRIGGER PERFORMANCE '+json.dumps({**result,'cohort':cohort,'write':write_kind,'guardCalls':counts.get('cos_source_current_guard',0),'v3GuardCalls':counts.get('cos_existing_tracker_source_guard',0),'labelCalls':counts.get('cos_source_label',0),'sourceEpochsUnchanged':True}),flush=True)
   sql('select pg_stat_reset();')
   target_customer=bench_records[1];sql(f"set track_functions='all';update app_private.vision_tracker_locations set customer='Changed synthetic customer' where id={q(target_customer['trackerId'])};")
   counts=data("select coalesce(jsonb_object_agg(funcname,calls),'{}') from pg_stat_user_functions where schemaname='app_private' and calls>0;")
   assert counts.get('cos_source_current_guard',0)==1 and counts.get('cos_existing_tracker_source_guard',0)==1,counts
   assert sql(f"select active from app_private.cos_geocode_sources where native_unit_id={q(target_customer['nativeUnitId'])};")=='f'
   print('PASS '+cohort+' exact tracker customer edit invalidates its source with one guard',flush=True)
   # A competitor OUTSIDE the requested subset must still invalidate its target.
   target=bench_records[0];sql(f"insert into app_private.vision_tracker_locations(id,organization_id,unit_number,placement) values(gen_random_uuid(),'{ORG}',{q(target['unitNumber'])},'FIELD');")
   for reader in ['read_many','map_projection']:
    assert data(f"set role service_role;select public.cos_geocode_sources_{reader}('{ORG}',{q(json.dumps(v3[:1]))}::jsonb);")==[]
   print('PASS '+cohort+' competitors outside requested identities still hold the target',flush=True)
 legacy_text=(ROOT/'tests/fixtures/geocodio-database-fixture.mjs').read_text();schema=re.search(r'const legacySchema=String.raw`(.*?)`;',legacy_text,re.S)[1];sql(roles(schema),'legacy')
 for f in ['geocodio-free-fallback.sql','geocodio-postal-precision-rejections.sql','geocodio-imported-jobs.sql','geocodio-imported-list-due-v2.sql','geocodio-imported-postal-precision-rejections.sql','geocodio-postal-retry-v1.sql','geocodio-tracker-source-v2.sql']:migrate(f,'legacy')
 sql('alter table public.camera_inventory_audit add column created_at timestamptz,add column request_id uuid;','legacy')
 for f in ['source-precedence-contract.sql','geocodio-source-precedence.sql']:migrate(f,'legacy')
 lp,lt=props('legacy'),snapshot('legacy');migrate('geocodio-existing-tracker-source-v3.sql','legacy');same_existing(lp,props('legacy'));assert snapshot('legacy')==lt
 sql(f"set role service_role;select app_private.cos_imported_assert_binding('{ORG}',{q(json.dumps(new))}::jsonb);",'legacy')
 for bad in [{**new,'schemaVersion':2},{**new,'entityKind':'tracker'},{**new,'unitNumber':'Spotter 1'},{**new,'productId':'12345'},{**new,'variant':'HDC4'}]:deny(lambda:sql(f"set role service_role;select app_private.cos_imported_assert_binding('{ORG}',{q(json.dumps(bad))}::jsonb);",'legacy'),'22023')
 print('PASS real legacy V3 binding validates; V1/V2 schema-kind/identity confusion denied; every existing ACL/wrapper unchanged')
 print(sql('select version();'));print('nativeMigrationSha256='+executed_migrations['native/cos-existing-tracker-source-v3.sql']);print('legacyMigrationSha256='+executed_migrations['legacy/geocodio-existing-tracker-source-v3.sql'])
finally:
 if server:server.terminate();server.wait(timeout=10);log.close()
