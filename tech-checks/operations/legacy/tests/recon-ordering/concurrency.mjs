// For a disposable local PostgreSQL 17.6 test DB only, after schema.sql,
// migration-proposal.sql, and integration.sql are loaded. Never production.
// Run with RECON_TEST_DATABASE_URL=postgresql://.../recon_ordering_test_... .
import assert from 'node:assert/strict';
import pg from 'pg';
const raw=process.env.RECON_TEST_DATABASE_URL;
if(!raw)throw Error('Set RECON_TEST_DATABASE_URL for a disposable local test database.');
const url=new URL(raw);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/recon_ordering_test_'))throw Error('Refusing anything except a loopback recon_ordering_test_* database.');
const clients=await Promise.all(Array.from({length:3},async()=>{const c=new pg.Client({connectionString:raw});await c.connect();return c}));
const [admin,a,b]=clients;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const one=async(c,sql,args)=>(await c.query(sql,args)).rows[0];
const apply=async(c,id)=>one(c,'SELECT public.test_apply($1) AS result',[id]);
const ev=async(device,type,time,key)=>(await one(admin,'SELECT public.test_event($1,$2,$3,$4) AS id',[device,type,time,key])).id;
const seed=async n=>admin.query('SELECT public.test_seed($1)',[n]);
async function waitBlocked(pid){
 const end=Date.now()+10000;
 while(Date.now()<end){const row=await one(admin,'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(row?.wait_event_type==='Lock')return;await delay(20)}
 throw Error('Expected second real PostgreSQL client to block on camera row lock.');
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name)}
try{
 assert.equal((await one(admin,'SHOW server_version_num')).server_version_num,'170006');
 const pid=(await one(b,'SELECT pg_backend_pid() AS pid')).pid;
 for(const [device,firstKind,secondKind,expected] of [[1001,'new','old','older'],[1002,'old','new','applied']]){
  await test(`${firstKind}-then-${secondKind} concurrent arrival cannot regress`,async()=>{
   await seed(device);
   const old=await ev(device,'RP','2026-10-12T14:06:22Z',`${device}-old`),newer=await ev(device,'YC','2026-10-12T14:07:12Z',`${device}-new`);
   await a.query('BEGIN');await a.query('SET LOCAL ROLE service_role');await a.query('SELECT id FROM public.camera_devices WHERE id=$1 FOR UPDATE',[device]);
   await b.query('SET ROLE service_role');
   const pending=apply(b,secondKind==='old'?old:newer);
   await waitBlocked(pid);
   await apply(a,firstKind==='old'?old:newer);
   const before=await one(admin,'SELECT source_last_seen_at FROM public.camera_devices WHERE id=$1',[device]);assert.equal(before.source_last_seen_at,null);
   await a.query('COMMIT');
   const result=await pending;assert.equal(result.result.outcome,expected);
   const row=await one(admin,'SELECT d.source_last_seen_at,h.checked_at,h.overall_status FROM public.camera_devices d JOIN public.camera_health_current h ON h.camera_device_id=d.id WHERE d.id=$1',[device]);
   assert.equal(row.source_last_seen_at.toISOString(),'2026-10-12T14:07:12.000Z');assert.equal(row.checked_at.toISOString(),row.source_last_seen_at.toISOString());assert.equal(row.overall_status,'offline');
  });
 }
 await test('concurrent duplicate redeliveries produce one failure/history/notification',async()=>{
  const device=1003;await seed(device);
  const first=await ev(device,'YC','2026-10-12T14:07:12Z','concurrent-same-guid'),duplicate=await ev(device,'YC','2026-10-12T14:07:12Z','concurrent-same-guid');
  await a.query('BEGIN');await a.query('SET LOCAL ROLE service_role');await a.query('SELECT id FROM public.camera_devices WHERE id=$1 FOR UPDATE',[device]);
  const pending=apply(b,duplicate);await waitBlocked(pid);await apply(a,first);await a.query('COMMIT');assert.equal((await pending).result.outcome,'duplicate');
  assert.equal(Number((await one(admin,'SELECT count(*) AS n FROM public.camera_health_history WHERE camera_device_id=$1',[device])).n),1);
  assert.equal(Number((await one(admin,'SELECT count(*) AS n FROM public.app_notifications WHERE unit_tag=$1',['Synthetic '+device])).n),1);
  assert.equal((await one(admin,'SELECT consecutive_failures FROM public.camera_health_current WHERE camera_device_id=$1',[device])).consecutive_failures,1);
 });
 await test('camera-row lock does not block another detector',async()=>{
  await seed(1004);await seed(1005);const event=await ev(1005,'RP','2026-10-12T14:07:12Z','independent-camera');
  await a.query('BEGIN');await a.query('SELECT id FROM public.camera_devices WHERE id=1004 FOR UPDATE');
  let timer;try{const result=await Promise.race([apply(b,event),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Unrelated camera was blocked')),1500)})]);assert.equal(result.result.outcome,'applied')}finally{clearTimeout(timer);await a.query('ROLLBACK')}
 });
 console.log(`${passed} real multi-client concurrency tests passed.`);
}finally{await a.query('ROLLBACK').catch(()=>{});await Promise.all(clients.map(c=>c.end()))}
