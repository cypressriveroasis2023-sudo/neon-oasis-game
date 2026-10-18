// Real concurrent PostgreSQL transactions, disposable loopback data only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
const pg=process.env.COS_MHELP_GEOCODIO_PG_MODULE?(await import(pathToFileURL(process.env.COS_MHELP_GEOCODIO_PG_MODULE).href)).default:require('pg');
const raw=process.env.COS_MHELP_GEOCODIO_TEST_DATABASE_URL;if(!raw)throw Error('Disposable loopback geocoder database required');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.search||url.hash||!/^\/cos_mhelp_geocodio_test_[a-z0-9_]+$/.test(url.pathname))throw Error('Only a disposable loopback cos_mhelp_geocodio_test_* database is allowed');
const database=url.pathname.slice(1),adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=new pg.Client({connectionString:adminUrl.href}),clients=[];
const source='a'.repeat(64),payload='b'.repeat(64),a='c'.repeat(64),b='d'.repeat(64);
async function connect(name){const c=new pg.Client({connectionString:url.href,application_name:name});await c.connect();clients.push(c);return c;}
let created=false;
try{
 await admin.connect();assert.equal((await admin.query('select 1 from pg_database where datname=$1',[database])).rowCount,0,'refuse an existing database');
 await admin.query('create database "'+database+'"');created=true;
 const db=await connect('mhelp_geo_admin');
 let schema=await readFile(new URL('./fixtures/mhelp-geocodio-ledger.sql',import.meta.url),'utf8');
 schema=schema.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`);
 await db.query(schema);await db.query(await readFile(new URL('../db/20261018021255_cos_mhelp_address_geocodio.sql',import.meta.url),'utf8'));
 const before=(await db.query('select * from synthetic_equipment')).rows;
 const one=await connect('mhelp_geo_one'),two=await connect('mhelp_geo_two');for(const c of [one,two])await c.query('set role service_role');
 const add=async()=>await db.query(`insert into app_private.cos_mhelp_address_geocodio_jobs(source_sha256,payload_sha256,address_sha256,street,city,state,zip,product_count,approval_reference)
 select $1,$2,v,'123 Example Rd','Houston','TX','77002',2,'Synthetic approval' from unnest($3::text[]) v`,[source,payload,[a,b]]);
 const claim=async(c,address)=>(await c.query('select public.cos_mhelp_address_geocodio_claim_v1($1,$2,$3) v',[source,payload,address])).rows[0].v;
 const reset=async()=>{await db.query('delete from app_private.cos_mhelp_address_geocodio_jobs;delete from app_private.cos_geocodio_reservations;delete from app_private.cos_geocodio_daily_budget;update app_private.cos_geocodio_account_state set blocked_until=null,cooldown_until=null;');await add();};
 const waitLock=async()=>{for(let n=0;n<100;n++){if((await db.query("select count(*)::int n from pg_stat_activity where application_name='mhelp_geo_two' and wait_event_type='Lock'")).rows[0].n===1)return;await new Promise(r=>setTimeout(r,20));}throw Error('Second real connection did not wait on the account lock');};
 await add();await one.query('begin');const first=await claim(one,a);assert.equal(first.claimed,true);
 const duplicate=claim(two,a);await waitLock();await one.query('commit');assert.equal((await duplicate).claimed,false);
 assert.equal((await db.query('select sum(credits)::int n from app_private.cos_geocodio_daily_budget')).rows[0].n,1);
 console.log('PASS concurrent duplicate claims create one durable request and one credit');
 await reset();await db.query('update app_private.cos_geocodio_control set daily_limit=1');await one.query('begin');const last=await claim(one,a);assert.equal(last.claimed,true);
 const competing=claim(two,b);await waitLock();await one.query('commit');assert.equal((await competing).status,'budget_exhausted');
 assert.equal((await db.query('select count(*)::int n from app_private.cos_geocodio_reservations')).rows[0].n,1);
 console.log('PASS two source addresses cannot spend the same last free account credit');
 await db.query('update app_private.cos_geocodio_control set daily_limit=2');await one.query('begin');
 await one.query('select public.cos_mhelp_address_geocodio_finish_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[source,payload,a,last.requestId,last.reservationToken,'provider_error','provider_forbidden',403,null,null]);
 const afterStop=claim(two,b);await waitLock();await one.query('commit');assert.equal((await afterStop).status,'account_deferred');
 assert.equal((await db.query('select sum(credits)::int n from app_private.cos_geocodio_daily_budget')).rows[0].n,1);
 console.log('PASS a provider account stop wins against a concurrent next-address claim');
 for(const role of ['anon','authenticated']){await two.query('set role '+role);await assert.rejects(claim(two,b),e=>e.code==='42501');await assert.rejects(two.query('select * from app_private.cos_mhelp_address_geocodio_jobs'),e=>e.code==='42501');await two.query('reset role');}
 assert.deepEqual((await db.query('select * from synthetic_equipment')).rows,before);
 console.log('PASS ordinary callers have no job access; equipment/GPS/camera/placement fixture unchanged');
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));if(created)await admin.query('drop database "'+database+'" with (force)');await admin.end();
}
