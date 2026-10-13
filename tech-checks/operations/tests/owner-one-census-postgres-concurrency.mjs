// Actual PostgreSQL transactions against a synthetic, disposable loopback DB only.
// No provider HTTP, production writes, or project credentials. The pg dependency
// is already pinned by legacy/tests/recon-ordering; install that package for CI.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require = createRequire(new URL('../legacy/tests/recon-ordering/package.json', import.meta.url));
const pg = process.env.COS_OWNER_PG_MODULE ? (await import(pathToFileURL(process.env.COS_OWNER_PG_MODULE).href)).default : require('pg');
const raw = process.env.COS_OWNER_TEST_DATABASE_URL;
if (!raw) throw Error('Set COS_OWNER_TEST_DATABASE_URL to a disposable loopback cos_owner_one_census_test_* database.');
const url = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/cos_owner_one_census_test_[a-z0-9_]+$/.test(url.pathname)) throw Error('Refusing anything except a loopback cos_owner_one_census_test_* database without connection overrides.');
const database = url.pathname.slice(1), adminUrl = new URL(url); adminUrl.pathname = '/postgres';
const admin = new pg.Client({connectionString: adminUrl.href});
const clients = [];
const ORG = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const OWNER = '00000000-0000-4000-8000-000000000001';
const hash = value => createHash('sha256').update(value).digest('hex');
// Optional local verification also executes the exact reviewed private operator
// body. CI uses only the synthetic enrollment fixture below, never private inputs.
const operatorSource = process.env.COS_OWNER_ENROLLMENT_PROPOSAL ? await readFile(process.env.COS_OWNER_ENROLLMENT_PROPOSAL,'utf8') : null;
const operatorBody = operatorSource?.match(/do \$\$[\s\S]*?end \$\$;/i)?.[0];
if(operatorSource && !operatorBody) throw Error('Reviewed operator proposal has no expected DO body.');
const operatorReadback = operatorSource?.match(/-- BEGIN SANITIZED READBACK\n([\s\S]*?)-- END SANITIZED READBACK/)?.[1];
if(operatorSource && !operatorReadback) throw Error('Reviewed operator proposal has no sanitized readback.');
const preparationSource=process.env.COS_OWNER_PREPARATION_PROPOSAL?await readFile(process.env.COS_OWNER_PREPARATION_PROPOSAL,'utf8'):null;
const preparationBody=preparationSource?.match(/do \$\$[\s\S]*?end \$\$;/i)?.[0];
const preparationReadback=preparationSource?.match(/-- BEGIN SANITIZED READBACK\n([\s\S]*?)-- END SANITIZED READBACK/)?.[1];
if(preparationSource&&(!preparationBody||!preparationReadback))throw Error('Reviewed preparation proposal is incomplete.');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = async (client, sql, values = []) => (await client.query(sql, values)).rows[0];
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";

async function connect(name) {
  const client = new pg.Client({connectionString: url.href, application_name: 'owner_one_census_' + name});
  await client.connect(); clients.push(client);
  await client.query("SET statement_timeout='12s'; SET lock_timeout='8s'; SET time zone 'UTC'");
  return client;
}
async function rpc(client, name, args, role = 'service_role') {
  await client.query('SET ROLE ' + role);
  try { return (await result(client, 'SELECT public.' + name + '(' + Object.keys(args).map((key, index) => key + '=>$' + (index + 1)).join(',') + ') AS result', Object.entries(args).map(([key,value])=>key==='p_events'?JSON.stringify(value):value))).result; }
  finally { await client.query('RESET ROLE'); }
}
let db, left, right, observer, created = false;
const passes = [];
async function test(name, fn) { await fn(); passes.push(name); console.log('PASS ' + name); }
async function waitBlocked(client) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const state = await result(observer, 'SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [client.processID]);
    if (state?.wait_event_type === 'Lock') return state;
    await delay(15);
  }
  throw Error('Expected a real PostgreSQL lock wait, not merely concurrent promises.');
}
async function snapshot() {
  return (await db.query(`SELECT * FROM (
   SELECT 'function' kind,p.oid::regprocedure::text name,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef::text extra,proconfig::text config FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app_private','public')
   UNION ALL SELECT 'table',c.oid::regclass::text,pg_get_userbyid(relowner),relacl::text,relrowsecurity::text,null FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app_private','public') AND relkind='r'
   UNION ALL SELECT 'schema',nspname,pg_get_userbyid(nspowner),nspacl::text,null,null FROM pg_namespace WHERE nspname IN ('app_private','auth','public')
  ) x ORDER BY kind,name`)).rows;
}
async function seed(id, address = `${id} main st, houston, tx 77002`, status = 'invalid_address') {
  const unit = `OWNER SYNTHETIC ${id}`, sha = hash(address);
  await db.query('INSERT INTO public.camera_devices(id,unit_key) VALUES($1,$2)', [id,unit]);
  await db.query("INSERT INTO public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) VALUES($1,$2,'MOVE_TO_FIELD',$3,$4,$5)", [id,OWNER,unit,[id],{placement_contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',street_address:address}]);
  await db.query(`INSERT INTO app_private.cos_field_geocode_cache(organization_id,audit_id,unit_key,address,address_sha256,status,reason,attempts,claim_token,geocoded_at,latitude,longitude,matched_address)
   VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,clock_timestamp(),$9,$10,$11)`, [ORG,String(id),unit,address,sha,status,status==='success'?null:status,randomUUID(),status==='success'?29.1:null,status==='success'?-95.1:null,status==='success'?address:null]);
  return {p_organization_id: ORG,p_audit_id:String(id),p_unit_key:unit,p_address:address,p_address_sha256:sha};
}
const targeted = key => ({...key,p_audit_id:'owner_one_census_v1:' + key.p_audit_id});
const claim = (client,key,target = true) => rpc(client,'cos_field_geocode_claim',target?targeted(key):key);
const finish = (client,key,token,status='no_match',reason=null) => rpc(client,'cos_field_geocode_finish',{...key,p_claim_token:token,p_status:status,p_latitude:status==='success'?29.2:null,p_longitude:status==='success'?-95.2:null,p_matched_address:status==='success'?key.p_address:null,p_reason:reason});
const reserve = (client,key) => rpc(client,'cos_field_geocode_fallback_reserve',{...key,p_request_id:randomUUID()});
const ownerRow = key => result(db,'SELECT * FROM app_private.cos_field_geocode_cache WHERE organization_id=$1 AND audit_id=$2',[ORG,key.p_audit_id]);
const counts = async () => (await result(db,`SELECT (SELECT count(*) FROM app_private.cos_geocodio_reservations)::int reservations,(SELECT coalesce(sum(credits),0) FROM app_private.cos_geocodio_daily_budget)::int credits,(SELECT count(*) FROM app_private.cos_imported_census_requests)::int imported_requests`));
const policy = async () => (await result(db,'SELECT owner_one_census_v1 AS value FROM app_private.cos_geocodio_account_state')).value;
async function enrollmentEvidence(key) {
 const c = await result(db,'SELECT to_jsonb(c) AS value FROM app_private.cos_field_geocode_cache c WHERE audit_id=$1',[key.p_audit_id]);
 const a = await result(db,"SELECT to_jsonb(a) AS value,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') AS sha FROM camera_inventory_audit a WHERE id=$1",[key.p_audit_id]);
 return {policyVersion:'owner_one_census_v1',binding:{organizationId:ORG,auditId:key.p_audit_id,unitKey:key.p_unit_key,address:key.p_address,addressSha256:key.p_address_sha256,nativeUnitId:randomUUID(),nativeGuardSha256:hash('synthetic-native-guard'),nativeSourceSha256:hash('synthetic-native-source'),auditSha256:a.sha,deviceIds:a.value.device_ids},approvalReference:'synthetic-concurrency-approval',enrolledAt:new Date().toISOString(),censusBefore:c.value,claimToken:null,consumedAt:null};
}
function preparationEvidence(evidence){const b=evidence.binding;return {policyVersion:'owner_census_preparation_v1',binding:{organizationId:b.organizationId,auditId:b.auditId,unitKey:b.unitKey,addressSha256:b.addressSha256,nativeUnitId:b.nativeUnitId,authorizingLegacyOwnerId:OWNER},auditSha256:b.auditSha256,deviceIds:b.deviceIds,censusBefore:evidence.censusBefore,approvalReference:'synthetic-preparation',preparedAt:'1900-01-01T00:00:00Z'};}
async function prepare(client,key,evidence){
 await client.query('SELECT app_private.cos_geocode_lock_current($1,$2,$3)',[key.p_audit_id,key.p_unit_key,key.p_address]);
 await client.query('SELECT 1 FROM app_private.cos_field_geocode_cache WHERE audit_id=$1 FOR UPDATE',[key.p_audit_id]);
 await client.query('SELECT 1 FROM app_private.cos_geocodio_account_state WHERE singleton FOR UPDATE');
 return client.query('UPDATE app_private.cos_geocodio_account_state SET owner_census_preparation_v1=$1 WHERE singleton AND owner_census_preparation_v1 IS NULL',[preparationEvidence(evidence)]);
}
// Mirrors the reviewed operator's order, including the source lock before either
// shared row. The real lock-wait tests below distinguish each acquisition stage.
async function matureSynthetic(client) {
 // Synthetic time only: never part of deployment/operator SQL.
 await client.query(`RESET ROLE;ALTER TABLE app_private.cos_geocodio_account_state DISABLE TRIGGER cos_diagnostic_recovery_immutable;
 UPDATE app_private.cos_geocodio_account_state SET owner_one_census_v1=jsonb_set(owner_one_census_v1,'{enrolledAt}',to_jsonb(clock_timestamp()-interval '481 seconds'));
 ALTER TABLE app_private.cos_geocodio_account_state ENABLE TRIGGER cos_diagnostic_recovery_immutable;SET LOCAL ROLE service_role`);
}
async function enroll(client,key,evidence,keepOpen=false,mature=true) {
 await client.query('BEGIN; SET LOCAL ROLE service_role');
 try {
  if(operatorBody) {
   await prepare(client,key,evidence);
   await client.query("SELECT set_config('cos.reviewed_owner_policy',$1,true)",[JSON.stringify(evidence)]);
   await client.query(operatorBody);
   const receipt = (await client.query(operatorReadback)).rows[0];
   assert.deepEqual(Object.keys(receipt).sort(),['address_sha256','allowance_consumed','consumed_at','current_audit_roster_match','enrolled_audit_sha256','enrolled_execution_sha256','enrolled_source_sha256','not_before','original_census_unchanged','policy_version']);
   assert.equal(receipt.allowance_consumed,false);assert.equal(receipt.current_audit_roster_match,true);assert.equal(receipt.original_census_unchanged,true);
   if(mature)await matureSynthetic(client);
   if(!keepOpen) await client.query('COMMIT');
   return 1;
  }
  assert.equal((await result(client,'SELECT app_private.cos_geocode_lock_current($1,$2,$3) AS valid',[key.p_audit_id,key.p_unit_key,key.p_address])).valid,true);
  await client.query('SELECT 1 FROM app_private.cos_field_geocode_cache WHERE organization_id=$1 AND audit_id=$2 FOR UPDATE',[ORG,key.p_audit_id]);
  await client.query('SELECT 1 FROM app_private.cos_geocodio_account_state WHERE singleton FOR UPDATE');
  const changed = await client.query('UPDATE app_private.cos_geocodio_account_state SET owner_one_census_v1=$1 WHERE singleton AND owner_one_census_v1 IS NULL',[evidence]);
  if(mature&&changed.rowCount)await matureSynthetic(client);
  if (!keepOpen) await client.query('COMMIT');
  return changed.rowCount;
 } catch(error) { await client.query('ROLLBACK'); throw error; }
}
async function reset() {
 // Whole synthetic rows are recreated between independent scenarios. Production
 // code never removes/disables the immutable guard or resets its allowance.
 await db.query(`TRUNCATE app_private.cos_geocodio_account_state,
 app_private.cos_imported_postal_retry_jobs,app_private.cos_imported_postal_retry_batches,
 app_private.cos_imported_geocode_jobs,app_private.cos_imported_geocode_events,
 app_private.cos_imported_census_requests,app_private.cos_imported_census_cache,
 app_private.cos_field_geocode_fallback_rejections,app_private.cos_field_geocode_fallback_cache,
 app_private.cos_geocodio_reservations,app_private.cos_geocodio_daily_budget,
 app_private.cos_field_geocode_cache,public.camera_inventory_audit,public.camera_devices;
 INSERT INTO app_private.cos_geocodio_account_state(singleton) VALUES(true);
 UPDATE app_private.cos_geocodio_control SET enabled=true,free_only=true;
 UPDATE app_private.cos_imported_geocode_cursor SET event_id=0,scan_generation=gen_random_uuid(),last_page_count=null;`);
}
async function noFallback(key) {
 assert.equal((await reserve(db,key)).reserved,false);
 assert.deepEqual(await counts(),{reservations:0,credits:0,imported_requests:0});
 for(const name of ['cos_field_geocode_list_due','cos_field_geocode_fallback_list_due']) {
  const due = await rpc(db,name,{p_organization_id:ORG});
  assert.ok(!due.some(row=>row.addressSha256===key.p_address_sha256));
 }
}
async function seedImported(address) {
 const match = /^(.*), houston, tx (\d{5})$/.exec(address);
 const b = {schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:'90001',unitNumber:'SPOTTER 90001',family:'SPOTTER',variant:null,sourceRevision:randomUUID(),sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:hash(address),nativeGuardSha256:'c'.repeat(64),installation:{street:match[1],city:'Houston',state:'TX',zip:match[2]},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 const cursor = await rpc(db,'cos_imported_geocode_cursor_read',{p_organization_id:ORG});
 await rpc(db,'cos_imported_geocode_sync',{p_organization_id:ORG,p_scan_generation:cursor.scanGeneration,p_after_event_id:cursor.eventId,p_events:[{eventId:b.eventId,entityKind:b.entityKind,nativeUnitId:b.nativeUnitId,productId:b.productId,sourceRevision:b.sourceRevision,source:b}],p_next_event_id:b.eventId});
 return b;
}
try {
 await admin.connect();
 // No DROP/reuse of an existing database: each invocation must provide a fresh name.
 await admin.query('CREATE DATABASE "' + database + '" TEMPLATE template0 ENCODING \'UTF8\''); created = true;
 [db,left,right,observer] = await Promise.all(['db','left','right','observer'].map(connect));
 const version = (await result(db,'SHOW server_version_num')).server_version_num;
 assert.ok(Number(version) >= 170000, 'requires PostgreSQL 17 or newer');
 let schema = (await readFile(new URL('fixtures/geocodio-database-fixture.mjs',import.meta.url),'utf8')).match(/const legacySchema=String.raw`([\s\S]*?)`;/)[1];
 schema = schema.replace(/create role (anon|authenticated);/g, (_,role)=>`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$;`).replace('create role service_role bypassrls;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;");
 await db.query(schema);
 await db.query(await readFile(new URL('fixtures/owner-census-baseline.sql',import.meta.url),'utf8'));
 for (const [name,args] of [['claim','uuid,text,text,text,text'],['finish','uuid,text,text,text,text,uuid,text,double precision,double precision,text,text'],['list_due','uuid,integer,text,text']]) await db.query(`REVOKE ALL ON FUNCTION public.cos_field_geocode_${name}(${args}) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.cos_field_geocode_${name}(${args}) TO service_role;`);
 await db.query('REVOKE ALL ON FUNCTION public.cos_field_geocode_read_many(uuid,text[]) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.cos_field_geocode_read_many(uuid,text[]) TO authenticated,service_role');
 for (const file of ['geocodio-free-fallback.sql','geocodio-postal-precision-rejections.sql','geocodio-imported-jobs.sql','geocodio-imported-postal-precision-rejections.sql','geocodio-imported-list-due-v2.sql','geocodio-postal-retry-v1.sql','geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql','geocodio-diagnostic-recovery-v1.sql']) await db.query(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
 await db.query("INSERT INTO profiles(user_id,role,active) VALUES($1,'owner',true)",[OWNER]);
 await db.query('GRANT SELECT ON public.profiles TO service_role'); // Model existing live SELECT before catalog snapshot.
 const before = await snapshot();
 const rolesBefore = (await db.query('SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles ORDER BY rolname')).rows;
 const membershipsBefore = (await db.query('SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member,grantor')).rows;
 const patch = await readFile(new URL('../db/owner-one-census-v1.sql',import.meta.url),'utf8');
 await db.query(patch); await db.query(patch);
 await test('repeated migration preserves existing ACLs, owners, invoker modes, RLS, search paths and roles',async()=>{
  const after = await snapshot(); for (const row of before) assert.deepEqual(after.find(item=>item.kind===row.kind&&item.name===row.name),row);
  assert.deepEqual((await db.query('SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles ORDER BY rolname')).rows,rolesBefore);
  assert.deepEqual((await db.query('SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member,grantor')).rows,membershipsBefore);
 });
 const leasePatch=await readFile(new URL('../db/owner-one-census-lease-budget-v1.sql',import.meta.url),'utf8');
 const leaseBody=leasePatch.match(/do \$lease_budget\$[\s\S]*?end \$lease_budget\$;/)?.[0];assert.ok(leaseBody);
 const claimDef=async()=> (await result(db,"SELECT pg_get_functiondef('public.cos_field_geocode_claim(uuid,text,text,text,text)'::regprocedure) value")).value;
 const accountJson=async()=> (await result(db,'SELECT to_jsonb(g) value FROM app_private.cos_geocodio_account_state g')).value;
 async function oldLeaseFixture(){const d=await claimDef();assert.equal(d.split("lease_until=v_now+interval '220 seconds'").length,2);await db.query(d.replace("lease_until=v_now+interval '220 seconds'","lease_until=v_now+interval '120 seconds'"));}
 await test('supplemental exact-hash120 to220 patch preserves complete prepared account/cache and security catalog',async()=>{
  await reset();const key=await seed(60),e=await enrollmentEvidence(key);await db.query('BEGIN;SET LOCAL ROLE service_role');await prepare(db,key,e);await db.query('COMMIT');
  await oldLeaseFixture();const prior=await claimDef(),account=await accountJson(),cache=await ownerRow(key),security=await snapshot();
  const functions=(await db.query("SELECT oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'app_private'::regnamespace) ORDER BY oid")).rows;
  await db.query(leasePatch);await db.query(leasePatch);
  assert.equal(await claimDef(),prior.replace("lease_until=v_now+interval '120 seconds'","lease_until=v_now+interval '220 seconds'"));assert.deepEqual(await accountJson(),account);assert.deepEqual(await ownerRow(key),cache);assert.deepEqual(await snapshot(),security);
  const after=(await db.query("SELECT oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'app_private'::regnamespace) ORDER BY oid")).rows;
  assert.deepEqual(after.filter(x=>!x.identity.startsWith('cos_field_geocode_claim(')),functions.filter(x=>!x.identity.startsWith('cos_field_geocode_claim(')));
 });
 await test('supplemental patch waits for an unrelated ordinary claim without deadlock and keeps60s',async()=>{
  await reset();await oldLeaseFixture();const ordinary=await seed(61);await db.query("UPDATE app_private.cos_field_geocode_cache SET status='pending',reason=null,attempts=0,claim_token=null,geocoded_at=null WHERE audit_id=$1",[ordinary.p_audit_id]);
  await left.query('BEGIN');const c=await claim(left,ordinary,false);assert.equal(c.claimed,true);assert.equal(Date.parse(c.record.leaseUntil)-Date.parse(c.record.updatedAt),60000);
  await right.query('BEGIN');const pending=right.query(leaseBody);await waitBlocked(right);await left.query('COMMIT');await pending;await right.query('COMMIT');
  assert.ok((await claimDef()).includes("lease_until=v_now+interval '220 seconds'"));assert.equal((await finish(db,ordinary,c.claimToken)).accepted,true);
 });
 await test('replacement completes while an old ordinary function invocation waits on its account lock',async()=>{
  await reset();await oldLeaseFixture();const key=await seed(66);await db.query("UPDATE app_private.cos_field_geocode_cache SET status='pending',reason=null,attempts=0,claim_token=null,geocoded_at=null WHERE audit_id=$1",[key.p_audit_id]);
  await left.query('BEGIN');await left.query('SELECT 1 FROM app_private.cos_geocodio_account_state WHERE singleton FOR UPDATE');
  const waiting=claim(right,key,false);await waitBlocked(right);await left.query(leaseBody);await left.query('COMMIT');const c=await waiting;
  assert.equal(c.claimed,true);assert.equal(Date.parse(c.record.leaseUntil)-Date.parse(c.record.updatedAt),60000);assert.ok((await claimDef()).includes("lease_until=v_now+interval '220 seconds'"));assert.equal((await finish(db,key,c.claimToken)).accepted,true);
 });
 await test('migration-first concurrent enrollment waits for account and claims only revised220s',async()=>{
  await reset();await oldLeaseFixture();const key=await seed(62),e=await enrollmentEvidence(key);
  await left.query('BEGIN');await left.query(leaseBody);const pending=enroll(right,key,e);await waitBlocked(right);assert.equal(await policy(),null);await left.query('COMMIT');assert.equal(await pending,1);
  const c=await claim(db,key);assert.equal(c.claimed,true);assert.equal(Date.parse(c.record.leaseUntil)-Date.parse(c.record.updatedAt),220000);await noFallback(key);
 });
 await test('enrollment-first concurrent migration waits then refuses any function or policy change',async()=>{
  await reset();await oldLeaseFixture();const key=await seed(63),e=await enrollmentEvidence(key),old=await claimDef();await enroll(left,key,e,true,false);
  await right.query('BEGIN');const pending=right.query(leaseBody);const rejection=assert.rejects(pending,error=>error.code==='40001');await waitBlocked(right);await left.query('COMMIT');await rejection;await right.query('ROLLBACK');
  assert.equal(await claimDef(),old);assert.equal((await policy()).claimToken,null);assert.equal((await ownerRow(key)).attempts,1);
  await reset();await db.query(leasePatch);
 });
 await test('supplemental migration rejects definition and ACL drift atomically',async()=>{
  await reset();await oldLeaseFixture();const old=await claimDef();await db.query(old.replace('declare r app_private','declare  r app_private'));const drift=await claimDef();
  await assert.rejects(db.query(leasePatch),e=>e.code==='40001');await db.query('ROLLBACK');assert.equal(await claimDef(),drift);await db.query(old);
  await db.query('GRANT EXECUTE ON FUNCTION public.cos_field_geocode_claim(uuid,text,text,text,text) TO authenticated');
  await assert.rejects(db.query(leasePatch),e=>e.code==='40001');await db.query('ROLLBACK');assert.equal(await claimDef(),old);
  await db.query('REVOKE EXECUTE ON FUNCTION public.cos_field_geocode_claim(uuid,text,text,text,text) FROM authenticated');await db.query(leasePatch);
 });
 await test('220s clock-relative completion boundary and expired claim never rearm',async()=>{
  // Synthetic relative clock cases avoid sleeping221s or changing the host clock.
  for(const expired of [false,true]){await reset();const key=await seed(expired?65:64);await enroll(db,key,await enrollmentEvidence(key));const c=await claim(db,key);assert.equal(c.claimed,true);assert.equal(Date.parse(c.record.leaseUntil)-Date.parse(c.record.updatedAt),220000);
   await db.query("UPDATE app_private.cos_field_geocode_cache SET updated_at=clock_timestamp()-interval '121 seconds',lease_until=clock_timestamp()+($2::int*interval '1 second') WHERE audit_id=$1",[key.p_audit_id,expired?-1:99]);
   assert.equal((await finish(db,key,c.claimToken)).accepted,!expired);assert.equal((await claim(db,key)).claimed,false);assert.equal((await ownerRow(key)).attempts,2);await noFallback(key);}
 });
 await reset();
 await test('exact reviewed preparation proposal preserves original evidence and returns only sanitized facts',async()=>{
  await reset();const key=await seed(39),evidence=await enrollmentEvidence(key),beforeRow=await ownerRow(key);
  await db.query('BEGIN;SET LOCAL ROLE service_role');
  if(preparationBody){await db.query("SELECT set_config('cos.reviewed_owner_preparation',$1,true)",[JSON.stringify(preparationEvidence(evidence))]);await db.query(preparationBody);
   const receipt=(await db.query(preparationReadback)).rows[0];assert.deepEqual(Object.keys(receipt).sort(),['allowance_exists','audit_sha256','original_census_unchanged','preparation_version','prepared_at']);assert.equal(receipt.allowance_exists,false);assert.equal(receipt.original_census_unchanged,true);
  }else assert.equal((await prepare(db,key,evidence)).rowCount,1);
  await db.query('COMMIT');assert.equal(await policy(),null);assert.deepEqual(await ownerRow(key),beforeRow);
 });
 await test('concurrent preparation CAS yields one immutable exact Owner marker and no provider allowance',async()=>{
  await reset();const key=await seed(40),evidence=await enrollmentEvidence(key),beforeRow=await ownerRow(key);
  await left.query('BEGIN;SET LOCAL ROLE service_role');assert.equal((await prepare(left,key,evidence)).rowCount,1);
  await right.query('BEGIN;SET LOCAL ROLE service_role');const pending=prepare(right,key,{...evidence,binding:{...evidence.binding,nativeUnitId:randomUUID()}});await waitBlocked(right);
  await left.query('COMMIT');assert.equal((await pending).rowCount,0);await right.query('COMMIT');
  assert.equal(await policy(),null);assert.deepEqual(await ownerRow(key),beforeRow);assert.equal((await claim(db,key)).claimed,false);assert.equal((await claim(db,key,false)).claimed,false);assert.equal((await reserve(db,key)).reserved,false);
  const marker=(await result(db,'SELECT owner_census_preparation_v1 value FROM app_private.cos_geocodio_account_state')).value;
  assert.equal(marker.binding.nativeUnitId,evidence.binding.nativeUnitId);assert.ok(Date.parse(marker.preparedAt)>Date.parse('2020-01-01'));
  await db.query("SELECT set_config('test.actor',$1,false)",[OWNER]);
  const args={p_organization_id:ORG,p_audit_ids:[key.p_audit_id]};assert.deepEqual((await rpc(db,'cos_field_geocode_read_many',args,'authenticated'))[0].censusPreparation,{nativeUnitId:evidence.binding.nativeUnitId});
  assert.equal((await rpc(db,'cos_field_geocode_read_many',args))[0].censusPreparation,undefined);
  await db.query('BEGIN;SET LOCAL ROLE service_role');await assert.rejects(db.query('UPDATE app_private.cos_geocodio_account_state SET owner_census_preparation_v1=null'),e=>e.code==='22023');await db.query('ROLLBACK');
  assert.deepEqual(await counts(),{reservations:0,credits:0,imported_requests:0});
 });
 await test('server-clock enrollment cannot be backdated and blocks all claims during the 480-second drain',async()=>{
  await reset();const key=await seed(41,undefined,'invalid_address'),evidence=await enrollmentEvidence(key);evidence.enrolledAt='1900-01-01T00:00:00Z';
  const started=(await result(db,'SELECT clock_timestamp() AS t')).t;await enroll(db,key,evidence,false,false);
  const held=await policy();assert.ok(Date.parse(held.enrolledAt)>=started.getTime());assert.equal(held.claimToken,null);
  const rows=await rpc(db,'cos_field_geocode_list_due',{p_organization_id:ORG,p_audit_id:key.p_audit_id,p_unit_key:key.p_unit_key});
  assert.equal(rows[0].censusOnlyState,'draining');assert.equal(Date.parse(rows[0].censusOnlyNotBefore)-Date.parse(held.enrolledAt),480000);
  await left.query('BEGIN');assert.equal((await claim(left,key)).claimed,false);const second=claim(right,key);await waitBlocked(right);await left.query('COMMIT');assert.equal((await second).claimed,false);
  assert.equal((await policy()).claimToken,null);assert.equal((await ownerRow(key)).attempts,1);await noFallback(key);
  await db.query('BEGIN');await matureSynthetic(db);await db.query('COMMIT');assert.equal((await claim(db,key)).claimed,true);
 });
 await test('simultaneous enrollment creates one immutable marker without rewriting historical Census evidence',async()=>{
  await reset();const key=await seed(1);const evidence=await enrollmentEvidence(key);const beforeRow=await ownerRow(key);
  assert.equal(await enroll(left,key,evidence,true),1);
  const pending=enroll(right,key,evidence).catch(error=>{assert.match(error.message,/Owner one-Census policy already enrolled/);return 0;});await waitBlocked(right);
  assert.deepEqual(await ownerRow(key),beforeRow);await left.query('COMMIT');
  assert.equal(await pending,0);assert.deepEqual({...await policy(),enrolledAt:evidence.enrolledAt},evidence);assert.deepEqual(await ownerRow(key),beforeRow);
  assert.deepEqual(await counts(),{reservations:0,credits:0,imported_requests:0});
 });
 await test('enrollment acquires source, then Owner Census, then account locks without inverted waiting',async()=>{
  for(const stage of ['source','census','account']) {
   await reset();const key=await seed(2);const evidence=await enrollmentEvidence(key);
   await left.query('BEGIN');
   if(stage==='source') await left.query('SELECT app_private.cos_geocode_lock_current($1,$2,$3)',[key.p_audit_id,key.p_unit_key,key.p_address]);
   if(stage==='census') await left.query('SELECT 1 FROM app_private.cos_field_geocode_cache WHERE audit_id=$1 FOR UPDATE',[key.p_audit_id]);
   if(stage==='account') await left.query('SELECT 1 FROM app_private.cos_geocodio_account_state FOR UPDATE');
   const pending=enroll(right,key,evidence);await waitBlocked(right);
   if(stage!=='account') {
    await observer.query('BEGIN');await observer.query('SELECT 1 FROM app_private.cos_geocodio_account_state FOR UPDATE NOWAIT');await observer.query('ROLLBACK');
   }
   if(stage==='source') {
    await observer.query('BEGIN');await observer.query('SELECT 1 FROM app_private.cos_field_geocode_cache WHERE audit_id=$1 FOR UPDATE NOWAIT',[key.p_audit_id]);await observer.query('ROLLBACK');
   }
   if(stage==='account') {
    await observer.query('BEGIN');await assert.rejects(observer.query('SELECT 1 FROM app_private.cos_field_geocode_cache WHERE audit_id=$1 FOR UPDATE NOWAIT',[key.p_audit_id]),error=>error.code==='55P03');await observer.query('ROLLBACK');
    const locks=(await observer.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted",[right.processID])).rows[0];assert.ok(locks.n>0);
   }
   await left.query('COMMIT');assert.equal(await pending,1);
  }
 });
 await test('a stale ordinary claim already holding source/cache locks cannot consume the later enrollment',async()=>{
  await reset();const key=await seed(20,undefined,'invalid_address');const evidence=await enrollmentEvidence(key);const beforeRow=await ownerRow(key);
  const premature=await claim(db,key);assert.equal(premature.claimed,false);assert.equal(premature.reason,'owner_one_census_not_enrolled');
  await left.query('BEGIN');assert.equal((await claim(left,key,false)).claimed,false);
  const pending=enroll(right,key,evidence);await waitBlocked(right);assert.equal(await policy(),null);await left.query('COMMIT');assert.equal(await pending,1);
  assert.equal((await policy()).claimToken,null);assert.deepEqual(await ownerRow(key),beforeRow);
  assert.equal((await claim(db,key,false)).claimed,false);assert.equal((await claim(db,key)).claimed,true);assert.equal((await ownerRow(key)).attempts,2);
 });
 await test('ordinary stale-cron claim and fallback reserve cannot spend a ready targeted allowance',async()=>{
  await reset();const key=await seed(3);const evidence=await enrollmentEvidence(key);await enroll(db,key,evidence);const beforeRow=await ownerRow(key);
  const ordinary=await claim(db,key,false);assert.equal(ordinary.claimed,false);assert.equal(ordinary.reason,'owner_one_census_hold');
  await noFallback(key);assert.equal((await policy()).claimToken,null);assert.deepEqual(await ownerRow(key),beforeRow);
  const due=await rpc(db,'cos_field_geocode_list_due',{p_organization_id:ORG,p_audit_id:key.p_audit_id,p_unit_key:key.p_unit_key});
  assert.equal(due.length,1);assert.equal(due[0].censusOnly,true);assert.equal(due[0].censusOnlyState,'ready');
  assert.deepEqual(due[0].censusOnlyGuard,{nativeUnitId:evidence.binding.nativeUnitId,nativeGuardSha256:evidence.binding.nativeGuardSha256});
  assert.equal(Object.hasOwn(due[0],'censusOnlySourceSha256'),false);
 });
 await test('two real simultaneous targeted claims yield exactly one token and one increment',async()=>{
  await reset();const key=await seed(4);await enroll(db,key,await enrollmentEvidence(key));
  await left.query('BEGIN');const first=await claim(left,key);assert.equal(first.claimed,true);assert.equal(Date.parse(first.record.leaseUntil)-Date.parse(first.record.updatedAt),220000);
  const pending=claim(right,key);await waitBlocked(right);await left.query('COMMIT');const second=await pending;
  assert.equal(second.claimed,false);assert.equal(second.reason,'owner_one_census_hold');assert.equal((await ownerRow(key)).attempts,2);
  assert.equal((await policy()).claimToken,first.claimToken);assert.equal(first.censusOnly,true);
  assert.equal((await finish(db,key,first.claimToken)).accepted,true);assert.equal((await finish(db,key,first.claimToken)).accepted,true);
  assert.equal((await finish(db,key,randomUUID())).accepted,false);await noFallback(key);
 });
 await test('a queued stale cron request loses to the targeted claim and never receives a send token',async()=>{
  await reset();const key=await seed(5);await enroll(db,key,await enrollmentEvidence(key));
  await left.query('BEGIN');const first=await claim(left,key);const pending=claim(right,key,false);await waitBlocked(right);await left.query('COMMIT');
  assert.equal((await pending).claimed,false);assert.equal((await policy()).claimToken,first.claimToken);assert.equal((await ownerRow(key)).attempts,2);
 });
 await test('uncertain crash, expired lease, provider error, no-match and success all remain permanently exhausted',async()=>{
  for(const status of ['crash','provider_error','no_match','success']) {
   await reset();const key=await seed(6,undefined,'invalid_address');await enroll(db,key,await enrollmentEvidence(key));const acquired=await claim(db,key);
   if(status!=='crash') assert.equal((await finish(db,key,acquired.claimToken,status,status==='provider_error'?'provider_timeout':null)).accepted,true);
   else await db.query("UPDATE app_private.cos_field_geocode_cache SET lease_until=clock_timestamp()-interval '2 days' WHERE audit_id=$1",[key.p_audit_id]);
   if(status==='provider_error') await db.query("UPDATE app_private.cos_field_geocode_cache SET next_attempt_at=clock_timestamp()-interval '2 days' WHERE audit_id=$1",[key.p_audit_id]);
   // Changing the free-budget accounting day or session timezone must never reset
   // an allowance. Owner Census itself deliberately has no daily reset column.
   await db.query("INSERT INTO app_private.cos_geocodio_daily_budget(budget_day,credits) VALUES((clock_timestamp() at time zone 'America/New_York')::date-2,0),((clock_timestamp() at time zone 'America/New_York')::date,0)");
   for(const zone of ['Pacific/Kiritimati','Pacific/Honolulu']) {
    await db.query('SET time zone '+literal(zone));assert.equal((await claim(db,key)).claimed,false,status);assert.equal((await claim(db,key,false)).claimed,false,status);
   }
   await db.query("SET time zone 'UTC'");assert.equal((await policy()).claimToken,acquired.claimToken);assert.equal((await ownerRow(key)).attempts,2);await noFallback(key);
   const due=await rpc(db,'cos_field_geocode_list_due',{p_organization_id:ORG,p_audit_id:key.p_audit_id,p_unit_key:key.p_unit_key});assert.equal(due[0].censusOnlyState,'consumed',status);
   if(status==='crash') assert.equal((await finish(db,key,acquired.claimToken,'success')).accepted,false);
  }
 });
 await test('post-enrollment shared Owner and imported addresses cannot bypass the permanent provider hold',async()=>{
  await reset();const key=await seed(7);await enroll(db,key,await enrollmentEvidence(key));const shared=await seed(8,key.p_address,'no_match');
  assert.equal((await claim(db,shared,false)).claimed,false);assert.equal((await claim(db,shared)).claimed,false);assert.equal((await reserve(db,shared)).reason,'owner_one_census_hold');
  const binding=await seedImported(key.p_address);
  for(const phase of ['ready','consumed']) {
   if(phase==='consumed') {const token=(await claim(db,key)).claimToken;assert.ok(token);assert.equal((await finish(db,key,token,'no_match')).accepted,true);}
   for(const name of ['census_claim','reserve']) {
    const response=await rpc(db,'cos_imported_geocode_'+name,{p_organization_id:ORG,p_binding:binding,p_request_id:randomUUID()});
    assert.equal(response[name==='reserve'?'reserved':'claimed'],false);assert.equal(response.reason,'owner_one_census_hold');
   }
   assert.equal((await reserve(db,shared)).reason,'owner_one_census_hold');await noFallback(key);
  }
  assert.ok((await policy()).claimToken);
 });
 await test('rollback before commit restores the unspent allowance and the next committed claim is unique',async()=>{
  await reset();const key=await seed(9);await enroll(db,key,await enrollmentEvidence(key));await left.query('BEGIN');const rolledBack=await claim(left,key);assert.equal(rolledBack.claimed,true);await left.query('ROLLBACK');
  assert.equal((await policy()).claimToken,null);assert.equal((await ownerRow(key)).attempts,1);
  const committed=await claim(db,key);assert.equal(committed.claimed,true);assert.notEqual(committed.claimToken,rolledBack.claimToken);assert.equal((await claim(db,key)).claimed,false);
 });
 await test('Owner-gated read-many exposes exact ready/consumed metadata and withholds guarded success after audit or roster drift',async()=>{
  await reset();const key=await seed(21,undefined,'invalid_address');const evidence=await enrollmentEvidence(key);await enroll(db,key,evidence);
  const args={p_organization_id:ORG,p_audit_ids:[key.p_audit_id]};
  await db.query("SELECT set_config('test.actor',$1,false)",[OWNER]);
  let rows=await rpc(db,'cos_field_geocode_read_many',args,'authenticated');assert.equal(rows.length,1);assert.equal(rows[0].censusOnlyState,'ready');assert.equal(rows[0].censusOnly,true);
  assert.deepEqual(rows[0].censusOnlyGuard,{nativeUnitId:evidence.binding.nativeUnitId,nativeGuardSha256:evidence.binding.nativeGuardSha256});
  assert.equal(rows[0].censusOnlySourceSha256,evidence.binding.nativeSourceSha256);
  for(const field of ['approvalReference','censusBefore','enrolledAt','consumedAt']) assert.equal(Object.hasOwn(rows[0],field),false);
  const acquired=await claim(db,key);assert.equal((await finish(db,key,acquired.claimToken,'success')).accepted,true);
  rows=await rpc(db,'cos_field_geocode_read_many',args,'authenticated');assert.equal(rows[0].censusOnlyState,'consumed');assert.equal(rows[0].status,'success');assert.equal(rows[0].latitude,29.2);
  await db.query("SELECT set_config('test.actor',$1,false)",[randomUUID()]);
  await assert.rejects(rpc(db,'cos_field_geocode_read_many',args,'authenticated'),error=>error.code==='42501');
  await assert.rejects(rpc(db,'cos_field_geocode_read_many',args,'anon'),error=>error.code==='42501');
  await db.query("SELECT set_config('test.actor',$1,false)",[OWNER]);
  await db.query("UPDATE camera_inventory_audit SET after_state=after_state||'{\"note\":\"changed after enrollment\"}'::jsonb WHERE id=$1",[key.p_audit_id]);
  assert.deepEqual(await rpc(db,'cos_field_geocode_read_many',args,'authenticated'),[]);
  // The historical successful cache still exists; only its now-stale projection
  // is withheld so its coordinates cannot leak out as an unmarked ordinary row.
  assert.equal((await ownerRow(key)).status,'success');assert.equal((await ownerRow(key)).latitude,29.2);
  await db.query("UPDATE camera_inventory_audit SET after_state=after_state-'note' WHERE id=$1",[key.p_audit_id]);
  assert.equal((await rpc(db,'cos_field_geocode_read_many',args,'authenticated'))[0].status,'success');
  await db.query('INSERT INTO camera_devices(id,unit_key) VALUES(22001,$1)',[key.p_unit_key]);
  assert.deepEqual(await rpc(db,'cos_field_geocode_read_many',args,'authenticated'),[]);
 });
 await test('ordinary Census remains independent of missing, null-policy, or unrelated account state',async()=>{
  for(const mode of ['null','unrelated','missing']) {
   await reset();
   if(mode==='unrelated') {const held=await seed(21,undefined,'invalid_address');await enroll(db,held,await enrollmentEvidence(held));}
   if(mode==='missing') await db.query('DELETE FROM app_private.cos_geocodio_account_state');
   const key=await seed(22,undefined,'invalid_address');
   await db.query("UPDATE app_private.cos_field_geocode_cache SET status='pending',reason=null,attempts=0,claim_token=null,geocoded_at=null WHERE audit_id=$1",[key.p_audit_id]);
   assert.ok((await rpc(db,'cos_field_geocode_list_due',{p_organization_id:ORG})).some(r=>r.auditId===key.p_audit_id));
   assert.equal((await claim(db,key,true)).claimed,false);
   const c=await claim(db,key,false);assert.equal(c.claimed,true);assert.equal(c.record.attempts,1);assert.equal(Date.parse(c.record.leaseUntil)-Date.parse(c.record.updatedAt),60000);assert.equal((await finish(db,key,c.claimToken)).accepted,true);
  }
 });
 await test('unrelated ordinary claims serialize behind account without deadlock or consuming held target',async()=>{
  await reset();const held=await seed(23,undefined,'invalid_address');await enroll(db,held,await enrollmentEvidence(held));
  const a=await seed(24,undefined,'invalid_address'),b=await seed(25,undefined,'invalid_address');
  await db.query("UPDATE app_private.cos_field_geocode_cache SET status='pending',reason=null,attempts=0,claim_token=null,geocoded_at=null WHERE audit_id=any($1)",[[a.p_audit_id,b.p_audit_id]]);
  await observer.query('BEGIN');await observer.query('SELECT 1 FROM app_private.cos_geocodio_account_state FOR UPDATE');
  const first=claim(left,a,false),second=claim(right,b,false);await waitBlocked(left);await waitBlocked(right);await observer.query('COMMIT');
  const cs=await Promise.all([first,second]);assert.ok(cs.every(c=>c.claimed));assert.equal((await policy()).claimToken,null);
  for(const [i,k] of [a,b].entries())assert.equal((await finish(db,k,cs[i].claimToken)).accepted,true);
 });
 await test('enrollment refuses outstanding imported or superseded Owner Census permits',async()=>{
  await reset();const target=await seed(26,undefined,'invalid_address'),old=await seed(27,target.p_address,'invalid_address');
  await db.query("UPDATE app_private.cos_field_geocode_cache SET status='pending',reason=null,geocoded_at=null,lease_until=clock_timestamp()-interval '1 day' WHERE audit_id=$1",[old.p_audit_id]);
  await db.query("INSERT INTO camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) SELECT 28,actor_id,action,unit_key,device_ids,after_state||'{\"street_address\":\"28 main st, houston, tx 77002\"}' FROM camera_inventory_audit WHERE id=27");
  await assert.rejects(enroll(db,target,await enrollmentEvidence(target)),e=>e.code==='40001');assert.equal(await policy(),null);
  await reset();const key=await seed(29,undefined,'invalid_address');const imported=await seedImported(key.p_address);
  const permit=await rpc(db,'cos_imported_geocode_census_claim',{p_organization_id:ORG,p_binding:imported,p_request_id:randomUUID()});assert.equal(permit.claimed,true);
  await db.query('UPDATE app_private.cos_imported_geocode_jobs SET invalidated=true');
  await assert.rejects(enroll(db,key,await enrollmentEvidence(key)),e=>e.code==='40001');assert.equal(await policy(),null);
  // Restore the final test's independently spent fixture.
  await reset();const last=await seed(30);await enroll(db,last,await enrollmentEvidence(last));await claim(db,last);
 });
 await test('service role cannot erase/rebind spent evidence; ordinary anon/authenticated access remains denied',async()=>{
  const saved=await policy();
  for(const value of [null,{...saved,claimToken:null,consumedAt:null},{...saved,approvalReference:'changed'}]) {
   await db.query('SET ROLE service_role');await assert.rejects(db.query('UPDATE app_private.cos_geocodio_account_state SET owner_one_census_v1=$1',[value]),error=>error.code==='22023');await db.query('RESET ROLE');assert.deepEqual(await policy(),saved);
  }
  for(const role of ['anon','authenticated']) await assert.rejects(rpc(db,'cos_field_geocode_list_due',{p_organization_id:ORG},role),error=>error.code==='42501');
 });
 const receipt={postgresVersion:(await result(db,'SELECT version() AS value')).value,passed:passes.length,checks:passes,schemaSha256:hash(patch),supplementalLeaseSha256:hash(leasePatch),guardedLeaseSeconds:220,ordinaryLeaseSeconds:60,actualConcurrentClients:4,enrollmentImplementation:operatorBody?'reviewed_operator_template':'synthetic_equivalent_fixture',enrollmentProposalSha256:operatorSource?hash(operatorSource):null,preparationProposalSha256:preparationSource?hash(preparationSource):null,providerCalls:0,productionWrites:0,existingCatalogSecurityPreserved:true};
 if(process.env.COS_OWNER_TEST_RECEIPT) await writeFile(process.env.COS_OWNER_TEST_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
 console.log(`ALL ${passes.length} OWNER ONE-CENSUS REAL POSTGRES CHECKS PASSED`);
} finally {
 await Promise.all(clients.map(async client=>{await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}));
 if (created) await admin.query('DROP DATABASE "' + database + '"');
 await admin.end();
}
