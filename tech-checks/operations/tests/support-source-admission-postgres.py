#!/usr/bin/env python3
"""Isolated localhost PostgreSQL concurrency tests. Never accepts a remote host.
Start a disposable cluster with existing superuser postgres and pass its port.
"""
import argparse,json,os,pathlib,re,subprocess,time,uuid,hashlib,datetime
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--port',required=True);p.add_argument('--library-path',default='');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];db='support_admission_test_'+uuid.uuid4().hex
args=[a.psql,'-X','--no-password','-h','127.0.0.1','-p',a.port,'-U','postgres','-v','ON_ERROR_STOP=1','-qAt']
env={**os.environ,'LD_LIBRARY_PATH':a.library_path or os.environ.get('LD_LIBRARY_PATH','')}
def sql(query,database=db,ok=True,app='support-test'):
 r=subprocess.run(args+['-d',database],input=query,text=True,capture_output=True,env={**env,'PGAPPNAME':app},timeout=25)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r

def start(query,app):
 proc=subprocess.Popen(args+['-d',db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**env,'PGAPPNAME':app});proc.stdin.write(query);proc.stdin.close();proc.stdin=None;return proc

def sleeping(app):
 until=time.monotonic()+10
 while time.monotonic()<until:
  if sql("select count(*) from pg_stat_activity where application_name='"+app+"' and wait_event='PgSleep'").stdout.strip()=='1':return
  time.sleep(.03)
 raise RuntimeError('Background session did not reach controlled wait')
sha=lambda x:hashlib.sha256(x.encode()).hexdigest()
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
row={'productId':'9000001','sourceLabel':'ST 901','kind':'stand','number':'901','capacity':None,'sourceCategory':'Stand','sourceFileSha256':sha('synthetic-source-file'),'sourceRowSha256':sha('synthetic-row'),'sourceObservedAt':'2026-01-01T00:00:00Z','installation':{'street':'123 Example Rd','city':'Example City','state':'TX','zip':'77002'},'normalization':'none','customer':'Synthetic Customer','siteLabel':'Synthetic Site'}
row['originalInstallation']=row['installation'].copy()
review={'reviewedAt':now,'manifestSha256':sha('synthetic-manifest'),'sourceFileSha256':row['sourceFileSha256'],'classifierVerified':True,'inventories':[{'kind':k,'sha256':sha(k),'readAt':now,'rowCount':100,'complete':True,'conflicts':[]}for k in ['mhelp','tracker','archive','legacy']]}
org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
call="select app_private.cos_support_admit_reviewed('"+org+"',$r$"+json.dumps([row])+"$r$,$j$"+json.dumps(review)+"$j$,true);"
report=[]
try:
 sql('create database '+db+" template template0 encoding 'UTF8';",'postgres')
 # Use the same synthetic schema as the fast PostgreSQL test suite.
 source=(root/'tests/fixtures/geocode-sources-database-fixture.mjs').read_text();base=re.search(r'await db.exec\(`(.*?)`\);',source,re.S).group(1)
 base=re.sub(r'create role (anon|authenticated|service_role)( bypassrls)?;',lambda m: "do $$ begin if not exists(select 1 from pg_roles where rolname='"+m[1]+"') then create role "+m[1]+(m[2] or '')+"; end if; end $$;",base)
 sql(base)
 sql((root/'db/cos-geocode-sources.sql').read_text())
 support=(root/'tests/fixtures/support-admission-fixture.mjs').read_text();extra=re.search(r'await db.exec\(`(.*?)`\);',support,re.S).group(1);sql(extra)
 sql((root/'db/geocodio_reviewed_estimates.sql').read_text().split('CREATE OR REPLACE FUNCTION public.appdeploy_field_map_snapshot')[0])
 for f in ['cos-geocode-sources-admin-import.sql','support-source-admission.sql']:sql((root/'db'/f).read_text())
 for role in ['anon','authenticated','service_role']:
  r=sql('set role '+role+';'+call,ok=False);assert r.returncode and 'permission denied' in r.stderr
 report.append('actual postgres/anon/authenticated/service_role permissions')
 r=sql('begin isolation level repeatable read;'+call,ok=False);assert r.returncode and 'READ COMMITTED' in r.stderr
 report.append('repeatable-read stale snapshot refused')
 # A native writer commits while the import is waiting for the table lock.
 writer=start("begin;insert into public.equipment_units(id,organization_id,unit_number,status)values(gen_random_uuid(),'"+org+"','STAND 901','retired');select pg_sleep(.8);commit;",'support-native-writer');sleeping('support-native-writer')
 r=sql("set lock_timeout='3s';"+call,ok=False);assert r.returncode and 'could not obtain lock' in r.stderr;writer.wait(timeout=5);r=sql(call,ok=False);assert r.returncode and 'Existing identity' in r.stderr;assert sql('select count(*) from app_private.cos_support_admissions').stdout.strip()=='0'
 report.append('busy writer refuses admission; fresh retry sees committed collision')
 sql('truncate public.equipment_units;')
 holder=start("begin;select app_private.cos_support_lock_inventory();select pg_sleep(.8);rollback;",'support-lock-holder');sleeping('support-lock-holder')
 r=sql("set lock_timeout='100ms';insert into public.equipment_units(id,organization_id,unit_number)values(gen_random_uuid(),'"+org+"','ST901');",ok=False);assert r.returncode and 'lock timeout' in r.stderr
 r=sql(call,ok=False);assert r.returncode and 'Another support import is active' in r.stderr;holder.wait(timeout=5)
 report.append('inventory lock excludes non-cooperating writers and parallel imports')
 # No target becomes observable until its source and admission receipt commit.
 importer=start('begin;'+call+'select pg_sleep(.8);commit;','support-importer');sleeping('support-importer');assert sql('select count(*) from app_private.vision_tracker_locations').stdout.strip()=='0';importer.wait(timeout=5)
 first=json.loads(sql(call).stdout);assert first['records'][0]['status']=='already_admitted';assert sql('select count(*) from app_private.cos_geocode_source_events').stdout.strip()=='1'
 report.append('atomic visibility and post-commit idempotency')

 target=first['records'][0]
 reservation={k:target[k]for k in ['productId','trackerId','sourceRevision']}
 withdrawal="select app_private.cos_support_withdraw_reviewed('"+org+"',$j$"+json.dumps([reservation])+"$j$);"
 holder=start("begin;select pg_advisory_xact_lock(hashtextextended('"+target['trackerId']+"',701006));select pg_sleep(.8);rollback;",'support-source-id-holder');sleeping('support-source-id-holder')
 r=sql(withdrawal,ok=False);assert r.returncode and 'Source target is busy' in r.stderr;holder.wait(timeout=5)
 assert sql('select count(*) from app_private.vision_tracker_locations').stdout.strip()=='1'
 assert json.loads(sql(withdrawal).stdout)[0]['status']=='withdrawn'
 assert json.loads(sql(withdrawal).stdout)[0]['status']=='already_withdrawn'
 assert sql("select count(*) from app_private.cos_geocode_sources where not active and eligibility='tombstone'").stdout.strip()=='1'
 report.append('withdrawal acquires existing source-ID locks first and retains tombstones')

 for role in ['anon','authenticated','service_role']:
  assert sql("select has_table_privilege('"+role+"','app_private.cos_support_admissions','SELECT,INSERT,UPDATE,DELETE')").stdout.strip()=='f'
 report.append('private RLS ledger has no application role grants')
 print(json.dumps({'status':'passed','database':'disposable localhost PostgreSQL','checks':report},indent=2))
finally:
 sql('drop database if exists '+db+' with (force);','postgres')
