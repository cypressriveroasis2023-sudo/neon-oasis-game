#!/usr/bin/env python3
"""Synthetic localhost PostgreSQL tests only. Pass explicit psql path, port, library path."""
import argparse,concurrent.futures,json,pathlib,subprocess,time,uuid
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--port',required=True);p.add_argument('--library-path',default='');a=p.parse_args()
HERE=pathlib.Path(__file__).resolve().parent;DB='cos_identity_synthetic_'+uuid.uuid4().hex[:8];ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';OWNER='11111111-1111-4111-8111-111111111111';IT='22222222-2222-4222-8222-222222222222';SERVICE='33333333-3333-4333-8333-333333333333'
env={'PATH':'/usr/bin:/bin','LD_LIBRARY_PATH':a.library_path,'PGPASSFILE':'/tmp/no-cos-identity-credentials','HOME':'/tmp'}
def sql(q,db=DB,app='identity_test'):
 r=subprocess.run([a.psql,'-X','--no-password','-h','127.0.0.1','-p',str(a.port),'-U','agent','-d',db,'-v','ON_ERROR_STOP=1','-qAt'],input=q,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=20)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def quote(s):return "'"+str(s).replace("'","''")+"'"
def reject(q,contains=None):
 try:sql(q);raise AssertionError('Unexpected success: '+q)
 except RuntimeError as e:
  if contains:assert contains in str(e),str(e)
def snapshot(actor=OWNER):return json.loads(sql(f"set role service_role;select public.cos_owner_identity_snapshot('{actor}','{ORG}');"))
def epoch(key,actor=OWNER):return json.loads(sql(f"set role authenticated;set request.test_actor='{actor}';select public.cos_camera_identity_epochs_v1(array[{quote(key)}]);"))[0]
def unit(label):
 uid=str(uuid.uuid4());sql(f"insert into equipment_units values('{uid}','{ORG}',{quote(label)},null,null,'available',null);");return uid
def claim(uid,key,ids,epoch_value='a'*64):return {'unitId':uid,'unitNumber':sql(f"select unit_number from equipment_units where id='{uid}'"),'unitKey':key,'deviceIds':ids,'resourceEpoch':epoch_value,'nativeEpoch':sql(f"select app_private.cos_owner_identity_native_epoch('{uid}');"),'physicalDigest':'b'*64,'physicalResources':[{'id':i,'source':'synthetic','type':'IPC','externalId':'external'+i,'serial':'serial'+i} for i in ids],'provenance':'owner_confirmation','confirmationText':'I inspected the physical equipment.','evidenceRef':'synthetic fixture'}
def confirm(c,rev=None,actor=OWNER,request=None,hold=0):
 rev=rev or snapshot()['revision'];request=request or str(uuid.uuid4());q=f"select public.cos_owner_identity_confirm('{actor}','{ORG}',{quote(rev)},'{request}',{quote(json.dumps(c))}::jsonb);"
 out=sql('begin;set local role service_role;'+q+f'select pg_sleep({hold});commit;',app='identity_held' if hold else 'identity_test');return json.loads(next(x for x in out.splitlines() if x.startswith('{')))
def wait_sleep(app):
 until=time.monotonic()+5
 while time.monotonic()<until:
  if sql(f"select count(*) from pg_stat_activity where application_name={quote(app)} and wait_event='PgSleep'")=='1':return
  time.sleep(.02)
 raise AssertionError('held transaction not ready')
try:
 sql(f"create database {DB} template template0 encoding 'UTF8';",'postgres')
 sql(f"""
 do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;
 create schema app_private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.test_actor',true),'')::uuid$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz);
 create function app_private.cos_verified_fleet_actor(p uuid) returns boolean language sql as $$select exists(select 1 from public.profiles where user_id=p and role in ('owner','it') and active and archived_at is null)$$;
 create table equipment_units(id uuid primary key,organization_id uuid,unit_number text,model_id uuid,serial_number text,status text,installed_site_id uuid);
 create table vision_vigilant_devices(id uuid primary key,organization_id uuid,source text,external_device_id text,device_type text);
 create table vision_vigilant_unit_matches(id uuid primary key,organization_id uuid,equipment_unit_id uuid,vigilant_device_id uuid);
 create table user_profiles(user_id uuid primary key,organization_id uuid,department text,active boolean);
 create table roles(id uuid primary key,organization_id uuid,code text);
 create table user_roles(user_id uuid,role_id uuid);
 create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $$begin if not exists(select 1 from public.user_profiles where user_id=p and organization_id=o and active) then raise exception 'Actor denied';end if;end$$;
 create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$select current_setting('request.deny_manage',true) is distinct from 'yes' or p<>'equipment.manage'$$;
 create table camera_devices(id bigint primary key,unit_key text,source text,device_type text,external_device_id text,device_serial text,public_ip text,expected_ports jsonb,organization text,source_status text,last_probe_online_at timestamptz);
 insert into profiles values('{OWNER}','owner',true,null),('{IT}','it',true,null),('{SERVICE}','service',true,null);
 insert into user_profiles values('{OWNER}','{ORG}','owner',true),('{IT}','{ORG}','it',true),('{SERVICE}','{ORG}','service',true);
 insert into roles values('{OWNER}','{ORG}','owner'),('{IT}','{ORG}','it_technician'),('{SERVICE}','{ORG}','service_technician');insert into user_roles select user_id,user_id from user_profiles;
 """)
 sql((HERE.parent/'db/owner_identity_crosswalk.sql').read_text());sql((HERE.parent/'db/legacy_owner_identity_epoch.sql').read_text());print(sql('select version()'))
 sql("insert into camera_devices(id,unit_key,source,device_type,external_device_id,device_serial) values(9101,'SOLARSPOTTER 987654','synthetic','IPC','external1','serial1');")
 first=epoch('SOLARSPOTTER 987654');sql("update camera_devices set public_ip='203.0.113.42',expected_ports='[80]',organization='Another site',source_status='online',last_probe_online_at=now();");assert epoch('SOLARSPOTTER 987654')==first
 sql("update camera_devices set device_serial='replacement';update camera_devices set device_serial='serial1';");assert epoch('SOLARSPOTTER 987654')['epoch']!=first['epoch'];print('PASS identity change-restore persists; benign health/IP/site edits preserve epoch')
 first=epoch('SOLARSPOTTER 987654');sql("delete from camera_devices;insert into camera_devices(id,unit_key,source,device_type,external_device_id,device_serial) values(9101,'SOLARSPOTTER 987654','synthetic','IPC','external1','serial1');");assert epoch('SOLARSPOTTER 987654')['epoch']!=first['epoch']
 first=epoch('SOLARSPOTTER 987654');sql("insert into camera_devices(id,unit_key,source,device_type,external_device_id,device_serial) values(9102,'SOLARSPOTTER 987654','synthetic','IPC','external2','serial2');delete from camera_devices where id=9102;");assert epoch('SOLARSPOTTER 987654')['epoch']!=first['epoch'];print('PASS deletion/reused ID and group addition/removal never revive old epochs')
 first=epoch('SOLARSPOTTER 987654');sql('truncate camera_devices;');assert epoch('SOLARSPOTTER 987654')['epoch']!=first['epoch'];assert epoch('SOLARSPOTTER 987654')['deviceIds']==[]
 reject('delete from app_private.cos_camera_identity_events;', 'append-only');reject('truncate app_private.cos_camera_identity_events;', 'append-only');reject(f"set role authenticated;set request.test_actor='{SERVICE}';select cos_camera_identity_epochs_v1(array['SOLARSPOTTER 987654']);",'Verified fleet');print('PASS epoch history immutable and Service denied')
 uid=unit('Spotter987654HDC2');c=claim(uid,'SOLARSPOTTER 987654',['9101']);r=confirm(c);cid=r['claimId'];assert snapshot()['claims'][0]['provenance']=='owner_confirmation';assert 'confirmation_text' not in snapshot()['claims'][0];assert snapshot(IT)['claims'][0]['id']==cid
 for actor in [IT,SERVICE]:
  try:confirm(claim(unit('Separate '+actor),'RAW '+actor,['9991']),actor=actor);raise AssertionError('role admitted')
  except RuntimeError:pass
 reject(f"set role service_role;select public.cos_owner_identity_snapshot('{SERVICE}','{ORG}');",'fleet access');reject(f"set role authenticated;select public.cos_owner_identity_snapshot('{OWNER}','{ORG}');",'permission denied');print('PASS existing Owner approval versus IT read and Service denial')
 stale=snapshot()['revision'];confirm(claim(unit('Other'),'RAW OTHER',['9201']))
 try:confirm(claim(unit('Stale'),'RAW STALE',['9301']),rev=stale);raise AssertionError('stale admitted')
 except RuntimeError as e:assert 'Identity review changed' in str(e)
 for duplicate in [claim(unit('Duplicate key'),'SOLARSPOTTER 987654',['9401']),claim(unit('Duplicate resource'),'RAW SECOND',['9101'])]:
  try:confirm(duplicate);raise AssertionError('duplicate admitted')
  except RuntimeError as e:assert 'duplicate key' in str(e)
 print('PASS stale CAS and duplicate raw-key/resource reservations')
 sql(f"update equipment_units set unit_number='changed' where id='{uid}';update equipment_units set unit_number='Spotter987654HDC2' where id='{uid}';");assert next(x for x in snapshot()['claims'] if x['id']==cid)['status']=='revoked'
 reject(f"delete from app_private.cos_owner_identity_revocations where claim_id='{cid}';",'immutable');reject(f"update app_private.cos_owner_identity_claims set native_unit_label='changed' where id='{cid}';",'immutable')
 try:confirm(c);raise AssertionError('revoked mapping reactivated')
 except RuntimeError as e:assert 'duplicate key' in str(e) or 'Native identity changed' in str(e)
 print('PASS native change-restore revokes permanently with immutable evidence/reservations')
 uid2=unit('Revocation fixture');r2=confirm(claim(uid2,'RAW REVOKE',['9501']));rid=str(uuid.uuid4())
 sql(f"set role service_role;select cos_owner_identity_revoke('{OWNER}','{ORG}','{r2['claimId']}','1','{rid}','Owner corrected identity');")
 assert next(x for x in snapshot()['claims'] if x['id']==r2['claimId'])['status']=='revoked'
 reject(f"set role service_role;select cos_owner_identity_revoke('{OWNER}','{ORG}','{r2['claimId']}','1','{uuid.uuid4()}','again');",'already revoked');print('PASS explicit deny-only revocation CAS')
 # Two independent resources can commit out of sequence. A late lower event changes COUNT.
 sql("insert into camera_devices(id,unit_key,source,device_type) values(9601,'RAW CONCURRENT','synthetic','IPC'),(9602,'RAW CONCURRENT','synthetic','IPC');")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(sql,"begin;update camera_devices set device_serial='one' where id=9601;select pg_sleep(.7);commit;",DB,'epoch_held');wait_sleep('epoch_held')
  two=pool.submit(sql,"update camera_devices set device_serial='two' where id=9602;");two.result();mid=epoch('RAW CONCURRENT');one.result();after=epoch('RAW CONCURRENT');assert mid['epoch']!=after['epoch']
 print('PASS independent identity events do not globally lock; late lower-ID commit changes epoch')
 # Confirm serializes with native mutation without a global clock lock.
 uid3=unit('Concurrent native');c3=claim(uid3,'RAW CONCURRENT NATIVE',['9701'])
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(confirm,c3,None,OWNER,None,.7);wait_sleep('identity_held');two=pool.submit(sql,f"update equipment_units set unit_number='new label' where id='{uid3}';");res=one.result();two.result()
 assert next(x for x in snapshot()['claims'] if x['id']==res['claimId'])['status']=='revoked';print('PASS concurrent native mutation revokes newly confirmed association atomically')

 # Benign native placement changes preserve approval, retirement does not.
 uid4=unit('Lifecycle fixture');res4=confirm(claim(uid4,'RAW LIFE',['9801']))
 sql(f"update equipment_units set status='installed',installed_site_id='{uuid.uuid4()}' where id='{uid4}';")
 assert next(x for x in snapshot()['claims'] if x['id']==res4['claimId'])['status']=='active'
 sql(f"update equipment_units set status='retired' where id='{uid4}';update equipment_units set status='available' where id='{uid4}';")
 assert next(x for x in snapshot()['claims'] if x['id']==res4['claimId'])['status']=='revoked'
 uid5=unit('Deleted fixture');sql(f"update equipment_units set status='deleted' where id='{uid5}';")
 try:confirm(claim(uid5,'RAW DELETED',['9802']));raise AssertionError('deleted unit admitted')
 except RuntimeError as e:assert 'Native identity changed' in str(e)
 print('PASS benign native placement preserves link; retirement/restore revokes and deleted units cannot confirm')
 # A later association to another UUID sharing the same physical resource revokes.
 uid6=unit('Provider fixture');res6=confirm(claim(uid6,'RAW PROVIDER',['9901']));provider=str(uuid.uuid4());mapping=str(uuid.uuid4());other=unit('Other provider target')
 sql(f"insert into vision_vigilant_devices values('{provider}','{ORG}','synthetic','external9901','IPC');insert into vision_vigilant_unit_matches values('{mapping}','{ORG}','{other}','{provider}');delete from vision_vigilant_unit_matches where id='{mapping}';")
 assert next(x for x in snapshot()['claims'] if x['id']==res6['claimId'])['status']=='revoked'
 print('PASS provider claim to a different native UUID and removal permanently revoke prior Owner confirmation')
 # A provider external ID changing into an already confirmed resource is also terminal.
 uid7=unit('Provider source change');res7=confirm(claim(uid7,'RAW PROVIDER CHANGE',['9902']));provider2=str(uuid.uuid4());mapping2=str(uuid.uuid4())
 sql(f"insert into vision_vigilant_devices values('{provider2}','{ORG}','synthetic','unrelated','IPC');insert into vision_vigilant_unit_matches values('{mapping2}','{ORG}','{other}','{provider2}');update vision_vigilant_devices set external_device_id='external9902' where id='{provider2}';update vision_vigilant_devices set external_device_id='unrelated' where id='{provider2}';")
 assert next(x for x in snapshot()['claims'] if x['id']==res7['claimId'])['status']=='revoked'
 print('PASS provider source change/restore cannot revive Owner confirmation')

 # Before any claim exists, native hardware change/restore stales the reviewed epoch.
 uid8=unit('Unclaimed native incarnation');c8=claim(uid8,'RAW INCARNATION',['9911']);prior=snapshot()['revision']
 sql(f"update equipment_units set serial_number='replacement' where id='{uid8}';update equipment_units set serial_number=null where id='{uid8}';")
 try:confirm(c8,rev=prior);raise AssertionError('old native incarnation admitted')
 except RuntimeError as e:assert 'Native identity changed' in str(e)
 c8=claim(uid8,'RAW INCARNATION',['9911']);sql(f"delete from equipment_units where id='{uid8}';insert into equipment_units values('{uid8}','{ORG}','Unclaimed native incarnation',null,null,'available',null);")
 try:confirm(c8);raise AssertionError('deleted/reused native incarnation admitted')
 except RuntimeError as e:assert 'Native identity changed' in str(e)
 print('PASS pre-confirmation native change/restore and delete/reuse invalidate review incarnation')
 # Provider add/remove while the new claim is uncommitted cannot miss the history.
 uid9=unit('Held Owner confirmation');c9=claim(uid9,'RAW HELD',['9912']);provider3=str(uuid.uuid4());mapping3=str(uuid.uuid4())
 sql(f"insert into vision_vigilant_devices values('{provider3}','{ORG}','synthetic','external9912','IPC');")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  one=pool.submit(confirm,c9,None,OWNER,None,.7);wait_sleep('identity_held')
  sql(f"insert into vision_vigilant_unit_matches values('{mapping3}','{ORG}','{other}','{provider3}');delete from vision_vigilant_unit_matches where id='{mapping3}';")
  res9=one.result()
 assert next(x for x in snapshot()['claims'] if x['id']==res9['claimId'])['status']=='revoked'
 print('PASS provider add/remove while claim is uncommitted permanently denies via append-only epoch')
 print('ALL SYNTHETIC SQL CHECKS PASSED')
finally:
 sql(f'drop database if exists {DB};','postgres')
