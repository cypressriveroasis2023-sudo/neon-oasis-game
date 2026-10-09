import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  fixture, asRole, rpc, snapshot, begin, finish, fail, state, registry,
  installation, bootstrapIds, syntheticAccount, syntheticSecret, allowNextAttempt, expireLease,
} from './fixtures/vrm-fleet-database-fixture.mjs';
import { createVrmFleetReader } from '../../supabase/functions/cos-operations-pages/vrmDiscovery.ts';
import { createVrmScheduledHandler } from '../../supabase/functions/cos-vrm-fleet-sync/index.ts';
import { vrmPortalConfig } from '../../supabase/functions/cos-operations-pages/vrm.ts';

let db;
before(async () => { db = await fixture(); });
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });

const signatures = [
  'cos_vrm_fleet_snapshot()', 'cos_vrm_fleet_begin()',
  'cos_vrm_fleet_finish(uuid,bigint,jsonb)', 'cos_vrm_fleet_fail(uuid,text,integer)',
  'cos_vrm_scheduler_authorized(text)',
];
const calls = [
  ['cos_vrm_fleet_snapshot', {}], ['cos_vrm_fleet_begin', {}],
  ['cos_vrm_fleet_finish', { p_lease_id: null, p_user_id: syntheticAccount, p_items: [] }],
  ['cos_vrm_fleet_fail', { p_lease_id: null, p_error_code: 'provider', p_retry_seconds: 60 }],
  ['cos_vrm_scheduler_authorized', { p_secret: syntheticSecret }],
];

async function successful(items = [installation(1001, 'HELIOS 001')]) {
  const lease = await begin(db);
  assert.ok(lease);
  assert.equal(await finish(db, lease, items), true);
  return items;
}

test('the unmodified migration plus synthetic bootstrap fixture exposes only bounded safe snapshot fields', async () => {
  const result = await snapshot(db);
  assert.deepEqual(result.items.map(item => item.installationId).sort(), [...bootstrapIds].sort());
  assert.equal(result.scheduleActive, false);
  assert.equal(result.syncing, false);
  assert.equal(result.lastSuccessAt, null);
  assert.deepEqual(Object.keys(result).sort(), ['items','lastAttemptAt','lastSuccessAt','errorCode','retryAfterAt','syncing','scheduleActive'].sort());
  for (const row of result.items) {
    assert.deepEqual(Object.keys(row).sort(), ['installationId','name','lastSeenAt','available'].sort());
    assert.equal(row.available, true);
    assert.equal(row.lastSeenAt, null);
  }
});

test('all application roles lack private-schema/table access; both private tables enforce RLS', async () => {
  const rows = (await db.query("select relname,relrowsecurity from pg_class where relnamespace='cos_vrm_private'::regnamespace and relkind='r' order by relname")).rows;
  assert.deepEqual(rows, [{ relname:'installations',relrowsecurity:true },{ relname:'sync_state',relrowsecurity:true }]);
  assert.equal((await db.query("select count(*)::int n from pg_policy where polrelid in ('cos_vrm_private.installations'::regclass,'cos_vrm_private.sync_state'::regclass)")).rows[0].n, 0);
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("select has_schema_privilege($1,'cos_vrm_private','USAGE') allowed", [role])).rows[0].allowed, false);
    for (const table of ['installations','sync_state']) {
      for (const operation of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [role,'cos_vrm_private.'+table,operation])).rows[0].allowed, false);
      }
      await assert.rejects(() => asRole(db,role,'select * from cos_vrm_private.'+table), /permission denied/);
    }
    await assert.rejects(() => asRole(db,role,'update cos_vrm_private.installations set name = $1',["Unauthorized rename"]), /permission denied/);
    await assert.rejects(() => asRole(db,role,'select * from vault.decrypted_secrets'), /permission denied/);
  }
});

test('every privileged RPC is service-only with an empty search path and no PUBLIC execute grant', async () => {
  for (const signature of signatures) {
    const fn = (await db.query("select prosecdef,proconfig,not exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') no_public from pg_proc where oid=$1::regprocedure", ['public.'+signature])).rows[0];
    assert.deepEqual(fn, { prosecdef:true,proconfig:['search_path=""'],no_public:true });
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,'public.'+signature])).rows[0].allowed, role === 'service_role');
    }
  }
  for (const role of ['anon','authenticated']) for (const [name,args] of calls) {
    await assert.rejects(() => rpc(db,name,args,role), /permission denied for function/);
  }
  assert.equal(await rpc(db,'cos_vrm_scheduler_authorized',{p_secret:syntheticSecret}), false);
  assert.equal(await finish(db,null,[]),false);
  assert.equal(await fail(db,null),false);
});

test('renames, numbering gaps, duplicate display names and rediscovery keep immutable provider IDs', async () => {
  const first = [installation(1001,'HELIOS 001'),installation(41007,'HELIOS 007'),installation(41099,'HELIOS 099'),installation(51099,'HELIOS 099')];
  await successful(first);
  await db.exec("update cos_vrm_private.installations set last_seen_at = now() - interval '1 day' where installation_id = 41007");
  const missingBefore = (await registry(db)).find(row => row.installation_id === 41007);
  await allowNextAttempt(db);
  const replacement = [installation(1001,'HELIOS renamed <script>'),installation(41099,'HELIOS 099'),installation(51099,'HELIOS 099'),installation(43001,'HELIOS 105')];
  assert.equal(await finish(db,await begin(db),replacement),true);
  const rows = await registry(db);
  assert.equal(rows.find(row => row.installation_id === 1001).name,'HELIOS renamed <script>');
  assert.deepEqual(rows.find(row => row.installation_id === 41007),{...missingBefore,available:false});
  assert.equal(rows.filter(row => row.name === 'HELIOS 099').length,2);
  assert.equal(rows.length,bootstrapIds.length+4);
  await allowNextAttempt(db);
  assert.equal(await finish(db,await begin(db),[installation(41007,'A returning installation')]),true);
  const returned = (await registry(db)).find(row => row.installation_id === 41007);
  assert.equal(returned.available,true);
  assert.equal(returned.name,'A returning installation');
  assert.notEqual(returned.last_seen_at,missingBefore.last_seen_at);
});

test('a complete empty successful snapshot marks all known installations unavailable and retains history', async () => {
  await successful();
  const before = await registry(db);
  await allowNextAttempt(db);
  assert.equal(await finish(db,await begin(db),[]),true);
  assert.deepEqual(await registry(db),before.map(row => ({...row,available:false})));
  const current = await state(db);
  assert.equal(current.source_user_id,syntheticAccount);
  assert.ok(current.last_success_at);
  assert.equal(current.error_code,null);
  assert.equal(current.lease_id,null);
});

for (const error of ['access','rate_limit','provider','invalid_response','account_changed','storage']) {
  test(error + ' failures preserve every stored installation, name, availability and last-seen timestamp', async () => {
    await successful([installation(1001,'Previously verified'),installation(45001,'Known fleet')]);
    const before = await registry(db), previous = await state(db);
    await allowNextAttempt(db);
    assert.equal(await fail(db,await begin(db),error,900),true);
    assert.deepEqual(await registry(db),before);
    const failed = await state(db);
    assert.equal(failed.last_success_at,previous.last_success_at);
    assert.equal(failed.source_user_id,previous.source_user_id);
    assert.equal(failed.error_code,error);
    assert.equal(failed.lease_id,null);
    assert.equal(failed.lease_until,null);
    assert.equal(Date.parse(failed.retry_after_at)-Date.parse(failed.last_attempt_at),900000);
    assert.equal(await begin(db),null);
  });
}

test('provider-account changes cannot rename, merge, remove, or adopt another account fleet', async () => {
  await successful();
  const before = await registry(db);
  await allowNextAttempt(db);
  const lease = await begin(db), held = await state(db);
  assert.equal(await finish(db,lease,[installation(1001,'Wrong-account rename'),installation(66001)],syntheticAccount+1),'account_changed');
  assert.deepEqual(await registry(db),before);
  assert.deepEqual(await state(db),held);
  assert.equal(await fail(db,lease,'account_changed'),true);
  assert.deepEqual(await registry(db),before);
});

test('competing queued begin callers admit one lease and cannot steal it', async () => {
  // PGlite executes a single connection. This verifies competing queued requests,
  // not live PostgreSQL multi-session lock contention or cron worker execution.
  await db.exec('set local role service_role');
  const attempts = await Promise.all(Array.from({length:16},() => db.query('select public.cos_vrm_fleet_begin() value')));
  await db.exec('reset role');
  const leases = attempts.map(result => result.rows[0].value.leaseId);
  assert.equal(leases.filter(Boolean).length,1);
  assert.equal((await state(db)).lease_id,leases.find(Boolean));
  assert.equal((await snapshot(db)).syncing,true);
});

test('lease expiry permits a new claim; old success/failure writers cannot mutate the newer lease', async () => {
  const old = await begin(db);
  await expireLease(db);
  const before = await registry(db);
  assert.equal(await finish(db,old,[installation(77001)]),false);
  assert.deepEqual(await registry(db),before);
  const replacement = await begin(db);
  assert.ok(replacement);
  assert.notEqual(replacement,old);
  const claimed = await state(db);
  for (const stale of [old,randomUUID(),null]) {
    assert.equal(await finish(db,stale,[installation(77001)]),false);
    assert.equal(await fail(db,stale),false);
    assert.deepEqual(await state(db),claimed);
    assert.deepEqual(await registry(db),before);
  }
  assert.equal(await finish(db,replacement,[installation(77002)]),true);
  const completed = await state(db), data = await registry(db);
  assert.equal(await finish(db,replacement,[installation(77003)]),false);
  assert.equal(await fail(db,replacement),false);
  assert.deepEqual(await state(db),completed);
  assert.deepEqual(await registry(db),data);
});

test('an expired failure writer cannot alter state even before a replacement lease is claimed', async () => {
  const lease = await begin(db);
  await expireLease(db);
  const before = await state(db), data = await registry(db);
  assert.equal(await fail(db,lease),false);
  assert.deepEqual(await state(db),before);
  assert.deepEqual(await registry(db),data);
});

test('successful refreshes retain a 30-second cooldown and failed refreshes honor bounded retry windows', async () => {
  await successful();
  assert.equal(await begin(db),null);
  await allowNextAttempt(db);
  const lease = await begin(db);
  assert.ok(lease);
  for (const [code,retry] of [[null,60],['untrusted raw provider message',60],['provider',null],['provider',29],['provider',86401]]) {
    const before = await state(db);
    await assert.rejects(() => fail(db,lease,code,retry), /Invalid failure status/);
    assert.deepEqual(await state(db),before);
  }
  assert.equal(await fail(db,lease,'provider',86400),true);
  assert.equal(await begin(db),null);
  await db.exec("update cos_vrm_private.sync_state set retry_after_at = now() - interval '1 second',last_attempt_at = now() - interval '31 seconds'");
  assert.ok(await begin(db));
});

test('malformed, duplicate or oversized discovery inputs are rejected atomically without releasing the lease', async () => {
  const lease = await begin(db), before = await registry(db), held = await state(db);
  const invalid = [null,{},'not-array',[null],[{}],[installation(0)],[installation(-1)],[installation(1.5)],[installation('100')],
    [installation(9007199254740992)],[installation(1,'')],[installation(1,' padded')],[installation(1,'padded ')],
    [installation(1,'line\nbreak')],[installation(1,'del\x7f')],[installation(1,'a'.repeat(201))],
    [{installationId:1,name:'Synthetic',extra:'must not persist'}],[{installationId:1}],
    [installation(1),installation(1,'Different duplicate name')],Array.from({length:5001},(_,i)=>installation(i+1))];
  for (const items of invalid) {
    await assert.rejects(() => finish(db,lease,items), /Invalid|duplicate|out of range/i);
    assert.deepEqual(await registry(db),before);
    assert.deepEqual(await state(db),held);
  }
  for (const account of [null,0,-1,9007199254740992]) {
    await assert.rejects(() => finish(db,lease,[],account), /Invalid account ID/);
    assert.deepEqual(await registry(db),before);
    assert.deepEqual(await state(db),held);
  }
});

test('the 5000-row cap covers retained history as well as the latest snapshot', async () => {
  const exactly5000 = [...bootstrapIds.map(id=>installation(id)),...Array.from({length:5000-bootstrapIds.length},(_,i)=>installation(10000+i))];
  await successful(exactly5000);
  assert.equal((await registry(db)).length,5000);
  await allowNextAttempt(db);
  const lease = await begin(db), before = await registry(db), held = await state(db);
  await assert.rejects(() => finish(db,lease,[installation(8000001)]), /Registry limit exceeded/);
  assert.deepEqual(await registry(db),before);
  assert.deepEqual(await state(db),held);
  assert.equal(await finish(db,lease,[installation(10000,'Existing at capacity')]),true);
  const rows = await registry(db);
  assert.equal(rows.length,5000);
  assert.equal(rows.filter(row=>row.available).length,1);
});

test('safe integer maximum and the inclusive 200-character name boundary survive database round-trip', async () => {
  await successful([installation(Number.MAX_SAFE_INTEGER,'n'.repeat(200))]);
  assert.deepEqual((await snapshot(db)).items.find(row=>row.installationId===Number.MAX_SAFE_INTEGER), {
    installationId:Number.MAX_SAFE_INTEGER,name:'n'.repeat(200),available:true,lastSeenAt:(await state(db)).last_success_at,
  });
});

test('scheduler credential validation returns booleans only and never emits Vault values in snapshots', async () => {
  await db.query('insert into vault.secrets(name,secret) values($1,$2),($3,$4)', ['cos_vrm_sync_secret',syntheticSecret,'unrelated_fixture_secret','b'.repeat(64)]);
  for (const secret of [null,'',syntheticSecret.toUpperCase(),'b'.repeat(64),'a'.repeat(63),syntheticSecret+'0','not-a-credential',syntheticSecret]) {
    const result = await rpc(db,'cos_vrm_scheduler_authorized',{p_secret:secret});
    assert.equal(typeof result,'boolean');
    assert.equal(result,secret===syntheticSecret);
  }
  assert.equal(JSON.stringify(await snapshot(db)).includes(syntheticSecret),false);
});

test('real reader + real RPCs: complete empty discovery differs from partial/provider failure', async () => {
  let providerMode = 'populated';
  const reader = createVrmFleetReader({
    getAccessToken:()=> 'synthetic-provider-token-never-real', rpc:(name,args)=>rpc(db,name,args),
    fetch:async url => {
      if (String(url).endsWith('/users/me')) return Response.json({success:true,user:{id:syntheticAccount}});
      if (providerMode === 'provider') return Response.json({error:'synthetic failure'}, {status:503});
      if (providerMode === 'partial') return Response.json({success:true,total:2,records:[{idSite:77001,name:'Incomplete replacement'}]});
      if (providerMode === 'limited') return Response.json({}, {status:429,headers:{'retry-after':'1'}});
      return Response.json({success:true,records:providerMode==='empty'?[]:[{idSite:1001,name:'Verified reader result'}]});
    },
  });
  assert.equal((await reader(true)).sync.state,'current');
  const before = await registry(db);
  for (const mode of ['provider','partial','limited']) {
    providerMode=mode;
    await allowNextAttempt(db);
    const result=await reader(true);
    assert.equal(result.sync.state,'stale');
    assert.deepEqual(await registry(db),before);
    assert.equal((await state(db)).lease_id,null);
  }
  providerMode='empty';
  await allowNextAttempt(db);
  assert.equal((await reader(true)).sync.state,'current');
  assert.deepEqual(await registry(db),before.map(row=>({...row,available:false})));
});


test('real scheduled handler authenticates through service-only Vault boolean before any provider access', async () => {
  await db.query('insert into vault.secrets(name,secret) values($1,$2)',['cos_vrm_sync_secret',syntheticSecret]);
  const calls=[];
  let tokenReads=0;
  const handler=createVrmScheduledHandler({
    platformUrl:'https://synthetic-db.example',serviceKey:'synthetic-service-key',
    getAccessToken:()=>{tokenReads++;return 'synthetic-provider-token';},
    fetch:async (url,init)=>{
      calls.push(String(url));
      assert.equal(init.redirect,'error');
      if (String(url).startsWith('https://synthetic-db.example/rest/v1/rpc/')) {
        assert.equal(init.headers.Authorization,'Bearer synthetic-service-key');
        assert.equal(init.headers.apikey,'synthetic-service-key');
        assert.equal(init.headers['X-Authorization'],undefined);
        return Response.json(await rpc(db,String(url).split('/').pop(),JSON.parse(init.body)));
      }
      assert.ok(String(url).startsWith('https://vrmapi.victronenergy.com/v2/'));
      assert.equal(init.headers['X-Authorization'],'Token synthetic-provider-token');
      assert.equal(init.headers.Authorization,undefined);
      assert.equal(init.headers.apikey,undefined);
      return Response.json(String(url).endsWith('/users/me')
        ? {success:true,user:{id:syntheticAccount,email:'synthetic-private@example.test'}}
        : {success:true,records:[{idSite:1001,name:'Private synthetic installation'}]});
    },
  });
  const request=secret=>new Request('https://synthetic-edge.example',{method:'POST',headers:{'x-cos-vrm-sync':secret}});
  const rejected=await handler(request('b'.repeat(64)));
  assert.equal(rejected.status,401);
  assert.equal(tokenReads,0);
  assert.deepEqual(calls,['https://synthetic-db.example/rest/v1/rpc/cos_vrm_scheduler_authorized']);
  assert.equal((await state(db)).lease_id,null);
  const accepted=await handler(request(syntheticSecret));
  assert.equal(accepted.status,200);
  assert.equal(accepted.headers.get('Cache-Control'),'no-store');
  const response=await accepted.json();
  assert.deepEqual(Object.keys(response).sort(),['ok','state','lastSuccessAt'].sort());
  assert.equal(response.ok,true);
  assert.equal(response.state,'current');
  assert.equal(tokenReads,1);
  const serialized=JSON.stringify(response);
  for (const privateValue of [syntheticSecret,'synthetic-service-key','synthetic-provider-token','Private synthetic installation','synthetic-private@example.test',String(syntheticAccount)]) {
    assert.equal(serialized.includes(privateValue),false);
  }
  assert.equal((await registry(db)).find(row=>row.installation_id===1001).name,'Private synthetic installation');
});


test('empty first registry uses existing presentation fallback without seeding; successful empty never restores fallback', async () => {
  await db.exec('truncate cos_vrm_private.installations');
  let token, providerFails=false;
  const reader=createVrmFleetReader({
    getAccessToken:()=>token,rpc:(name,args)=>rpc(db,name,args),
    fetch:async url=>providerFails ? Response.json({}, {status:503}) : Response.json(String(url).endsWith('/users/me')
      ? {success:true,user:{id:syntheticAccount}} : {success:true,records:[]}),
  });
  const initial=await reader();
  // Reuse the pre-existing public presentation contract, never duplicate its
  // fleet records in the migration or these new test fixtures.
  assert.deepEqual(initial.items,vrmPortalConfig().items);
  assert.ok(initial.items.length>0);
  assert.equal(initial.sync.state,'not_configured');
  assert.deepEqual(await registry(db),[]);
  assert.equal((await state(db)).last_success_at,null);
  token='synthetic-provider-token';
  const emptySuccess=await reader(true);
  assert.equal(emptySuccess.sync.state,'current');
  assert.deepEqual(emptySuccess.items,[]);
  assert.deepEqual(await registry(db),[]);
  assert.ok((await state(db)).last_success_at);
  providerFails=true;
  await allowNextAttempt(db);
  const failed=await reader(true);
  assert.equal(failed.sync.state,'stale');
  assert.deepEqual(failed.items,[]);
  token=undefined;
  assert.deepEqual((await reader()).items,[]);
  assert.deepEqual(await registry(db),[]);
});
