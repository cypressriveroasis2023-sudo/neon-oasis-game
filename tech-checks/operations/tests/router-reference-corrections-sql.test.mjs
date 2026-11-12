// Runs the audited router-reference correction install in a throwaway local
// PostgreSQL. camera_unit_routers here is a SUBSTITUTE built from the column
// types, defaults, checks and indexes read from production on 2026-11-11, and
// camera_devices is a small stand-in used only to prove it is never touched.
// This is not the live schema: the read-only precheck is what compares the
// install against production, and it is run here too. Skipped without PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,chmodSync,writeFileSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root='/usr/lib/postgresql';
const bin=existsSync(root)?readdirSync(root).map(v=>join(root,v,'bin')).filter(p=>existsSync(join(p,'initdb'))).sort().pop():null;
const asRoot=typeof process.getuid==='function'&&process.getuid()===0;
const canRun=Boolean(bin)&&(!asRoot||spawnSync('id',['postgres']).status===0),skip=canRun?false:'no local PostgreSQL server binaries';
const install=fileURLToPath(new URL('../db/20261111_router_reference_corrections.sql',import.meta.url));
const precheck=fileURLToPath(new URL('../db/20261111_router_reference_corrections_precheck.sql',import.meta.url));
let dir,port;
const sh=c=>execFileSync(asRoot?'su':'sh',asRoot?['postgres','-s','/bin/sh','-c',c]:['-c',c],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const psql=(sql,{file=false}={})=>{const path=join(dir,'q-'+Math.random().toString(36).slice(2)+'.sql');if(file)copyFileSync(sql,path);else writeFileSync(path,sql);chmodSync(path,0o644);
 return sh(`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -h ${dir} -p ${port} -d postgres -f ${path} 2>&1`).trim();};
const q=v=>v==null?'null':`'${String(v).replaceAll("'","''")}'`;
const id=n=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0');
const UNIT='3316ab55-4f24-49c5-9d8e-9751e06e1da3';
const fails=(fn,pattern)=>assert.throws(fn,e=>pattern.test(String(e.stdout||'')+String(e.stderr||'')+String(e.message)));
const args=(p={})=>({id:id(1),routerId:182,unitKey:'SOLARSPOTTER 053',oldIp:'166.168.147.21',newIp:'38.246.194.11',serial:'RF3152533023889',productId:'2300342',unitId:UNIT,
 provider:'InHand',source:'InHand Device Manager live read',status:'online',observedAt:'now',approvedBy:'James Martin',approvalSource:'Synthetic test approval',reason:'Router address is outdated',...p});
const correct=(p={},role='service_role')=>{const a=args(p);return JSON.parse(psql(`set role ${role}; select public.camera_unit_router_correct_v1(${q(a.id)},${a.routerId},${q(a.unitKey)},${q(a.oldIp)}::inet,${q(a.newIp)}::inet,${q(a.serial)},${q(a.productId)},${q(a.unitId)},${q(a.provider)},${q(a.source)},${q(a.status)},${a.observedAt==='now'?"date_trunc('milliseconds',now())":q(a.observedAt)+'::timestamptz'},${q(a.approvedBy)},${q(a.approvalSource)},${q(a.reason)});`));};
const revert=(rid,of,role='service_role')=>JSON.parse(psql(`set role ${role}; select public.camera_unit_router_revert_v1(${q(rid)},${q(of)},'James Martin','Synthetic test approval','Wrong router');`));
const row=n=>JSON.parse(psql(`select to_jsonb(r) from public.camera_unit_routers r where id=${n};`));
const hash=t=>psql(`select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from ${t} x;`);
const receipts=()=>Number(psql('select count(*) from public.camera_unit_router_corrections;'));
const others=()=>psql('select md5(string_agg(to_jsonb(x)::text,\'\' order by id)) from public.camera_unit_routers x where id not in(182,79,150);');
let pre,cams0,others0;
test.before(()=>{if(!canRun)return;
 dir=mkdtempSync(join(tmpdir(),'cos-routers-'));chmodSync(dir,0o777);port=56000+Math.floor(Math.random()*900);
 sh(`${bin}/initdb -D ${dir}/data -A trust -U postgres >/dev/null && ${bin}/pg_ctl -D ${dir}/data -o "-c listen_addresses='' -k ${dir} -p ${port}" -w -l ${dir}/log start >/dev/null`);
 // Production-equivalent defaults: new public tables are granted to the API roles, and service_role bypasses RLS.
 psql(`create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create table public.camera_unit_routers(id bigint primary key,unit_key text not null unique,router_name text not null default 'InHand Router',router_model text,unit_ip inet,router_public_ip inet,
   web_port integer,web_protocol text,reported_status text not null default 'unknown' check(reported_status in('online','offline','unknown')),reported_latency_ms integer,status_source text,
   status_observed_at timestamptz,current_status text constraint camera_unit_routers_current_status_check check(current_status is null or current_status in('online','offline','unknown')),
   last_checked_at timestamptz,last_online_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
  create index camera_unit_routers_last_checked_idx on public.camera_unit_routers(last_checked_at nulls first) where router_public_ip is not null or unit_ip is not null;
  insert into public.camera_unit_routers(id,unit_key,router_model,unit_ip,router_public_ip,reported_status,reported_latency_ms,status_source,status_observed_at,current_status,last_checked_at,last_online_at) values
   (14,'RANGER 024','InHand IR302','166.203.204.120','166.203.204.120','online',40,'InHand gateway online export','2026-09-22T21:03:44Z','offline','2026-11-11T23:30:43Z','2026-10-15T21:00:11Z'),
   (79,'SPOTTER 185','InHand IR300',null,'166.203.205.83','online',55,'InHand gateway online export','2026-09-22T21:03:44Z','online','2026-11-11T23:15:16Z','2026-11-08T05:00:21Z'),
   (150,'SOLAR SPOTTER 019','InHand IR300',null,'166.203.204.28','online',null,'InHand gateway online export','2026-09-22T21:03:44Z','offline','2026-11-11T23:30:16Z','2026-09-24T15:43:02Z'),
   (182,'SOLARSPOTTER 053','InHand IR300',null,'166.168.147.21','online',61,'InHand gateway online export','2026-09-22T21:03:44Z','offline','2026-11-11T23:30:43Z','2026-10-07T13:20:03Z'),
   (218,'SOLARSPOTTER 019','ir300',null,'166.203.204.28','unknown',null,null,null,'offline','2026-11-11T23:15:18Z','2026-09-24T15:48:07Z');
  create table public.camera_devices(id bigint primary key,unit_key text,device_name text,public_ip inet,vigilant_status text,activation_state text,source_metadata jsonb);
  insert into public.camera_devices values(1,'SOLARSPOTTER 053','SolarSpotter 053 CAM 1','50.148.14.82','Online','deactivated','{"sim":"synthetic"}'),(2,'SOLARSPOTTER 019','SS019_1','166.203.205.83','Online','active','{}'),(3,'RANGER 024','Ranger 024','38.246.195.69','Online','active','{}');
  grant select,insert,update,delete on public.camera_unit_routers to service_role;`);
 pre=JSON.parse(psql(precheck,{file:true}));cams0=hash('public.camera_devices');
 psql(install,{file:true});others0=others();
});
test.after(()=>{if(canRun&&dir)try{sh(`${bin}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null`);}catch{}});

test('the read-only precheck passes on the production-shaped table and reports each candidate truthfully',{skip},()=>{
 assert.deepEqual(pre.missingOrChangedColumns,[]);for(const k of ['rolesExist','nothingToCreateAlreadyExists','currentStatusAllowsUnknown'])assert.equal(pre[k],true,k);
 assert.equal(pre.routerTableTriggers,0);
 const by=Object.fromEntries(pre.candidates.map(c=>[c.routerId,c]));
 assert.equal(by[182].wouldPass,true);assert.equal(by[79].wouldPass,true);
 assert.equal(by[150].wouldPass,false);assert.deepEqual(by[150].newAddressHeldBy,['SPOTTER 185']);
 assert.equal(by[14].wouldPass,false);assert.equal(by[14].noUnitIp,false);
 assert.equal(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i.test(readFileSync(precheck,'utf8').replace(/--.*$/gm,'')),false);
});

test('the install alters no existing object and only the service role may call it',{skip},()=>{
 const sql=readFileSync(install,'utf8').replace(/--.*$/gm,'');
 assert.equal(/alter\s+table\s+public\.camera_unit_routers\b|drop\s|create\s+trigger\s+\S+\s+(before|after)[^;]*on\s+public\.camera_unit_routers\b/i.test(sql),false);
 assert.equal(/camera_devices|sim|activation|placement|monitor/i.test(sql),false);
 for(const role of ['anon','authenticated']){fails(()=>correct({},role),/permission denied/);fails(()=>psql(`set role ${role}; select count(*) from public.camera_unit_router_corrections;`),/permission denied/);}
 // A structurally valid receipt, written directly: refused for every API role, including the RLS-bypassing service role.
 const direct=`insert into public.camera_unit_router_corrections(id,action,router_id,unit_key,prior_row,old_public_ip,new_public_ip,router_serial,product_id,cos_unit_id,provider,source,reported_status,observed_at,approved_by,approval_source,reason) values('${id(99)}','correct',182,'SOLARSPOTTER 053','{}','166.168.147.21','38.246.194.11','RF3152533023889','2300342','${UNIT}','InHand','direct','online',now(),'James Martin','direct','direct');`;
 for(const role of ['anon','authenticated','service_role'])fails(()=>psql(`set role ${role}; ${direct}`),/permission denied for table camera_unit_router_corrections/);
 assert.equal(psql(`select rolbypassrls from pg_roles where rolname='service_role';`),'t');
 assert.equal(psql(`select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_name='camera_unit_router_corrections' and grantee in('anon','authenticated','service_role','PUBLIC');`),'SELECT');
 assert.equal(psql(`set role service_role; select count(*) from public.camera_unit_router_corrections;`),'0');
 // The receipt order decides which correction may be reversed, so no API role may read or move its sequence.
 const seqName='public.camera_unit_router_corrections_seq_seq';
 assert.equal(psql(`select pg_get_serial_sequence('public.camera_unit_router_corrections','seq');`),seqName);
 for(const role of ['anon','authenticated','service_role'])for(const stmt of [`select setval('${seqName}',1,false)`,`select setval('${seqName}',9999)`,`select nextval('${seqName}')`,`select currval('${seqName}')`,`select last_value from ${seqName}`])
  fails(()=>psql(`set role ${role}; ${stmt};`),/permission denied for sequence camera_unit_router_corrections_seq_seq/);
 assert.equal(psql(`select count(*) from information_schema.role_usage_grants where object_name='camera_unit_router_corrections_seq_seq' and grantee in('anon','authenticated','service_role','PUBLIC');`),'0');
 // The same statement as the table owner is structurally valid — the refusal above is the privilege, not the shape.
 assert.equal(psql(`begin; ${direct} select count(*) from public.camera_unit_router_corrections; rollback;`),'1');
 assert.equal(receipts(),0);
});

test('every guard refuses, and a refusal writes nothing',{skip},()=>{
 const before=hash('public.camera_unit_routers');
 fails(()=>correct({oldIp:'166.168.147.99'}),/address changed since review/);
 fails(()=>correct({unitKey:'SOLARSPOTTER 054'}),/not the one reviewed/);
 fails(()=>correct({routerId:999}),/not the one reviewed/);
 fails(()=>correct({newIp:'166.168.147.21'}),/already has that address/);
 fails(()=>correct({serial:''}),/incomplete/);fails(()=>correct({serial:'rf 1'}),/incomplete/);
 fails(()=>correct({productId:'A2300342'}),/incomplete/);fails(()=>correct({approvedBy:' '}),/incomplete/);
 fails(()=>correct({status:'up'}),/incomplete/);fails(()=>correct({newIp:'38.246.194.0/24'}),/incomplete/);
 fails(()=>correct({observedAt:'2026-09-22T21:03:44Z'}),/not current/);
 fails(()=>correct({observedAt:'2099-01-01T00:00:00Z'}),/not current/);
 // SS019: Spotter 185's record still holds the address.
 fails(()=>correct({id:id(2),routerId:150,unitKey:'SOLAR SPOTTER 019',oldIp:'166.203.204.28',newIp:'166.203.205.83',serial:'RF3152442003375',productId:'2258996'}),/Another router record already holds that address \(SPOTTER 185\)/);
 // Ranger 024: has a unit IP, so it is never changed here.
 fails(()=>correct({id:id(3),routerId:14,unitKey:'RANGER 024',oldIp:'166.203.204.120',newIp:'38.246.195.69',serial:'RF3022338285541',productId:'2289749'}),/unit IP that needs separate review/);
 // An address that is another record's unit IP is also refused.
 fails(()=>correct({newIp:'166.203.204.120'}),/Another router record already holds that address \(RANGER 024\)/);
 assert.equal(hash('public.camera_unit_routers'),before);assert.equal(receipts(),0);
});

test('a correction keeps the whole prior row, changes only the address fields and clears the old probe result',{skip},()=>{
 const prior=row(182);
 // A health check that read the row before the correction, as the deployed sweep does.
 const stale={updated_at:prior.updated_at,ip:prior.router_public_ip};
 const out=correct();assert.deepEqual(out,{contract:'COS_ROUTER_CORRECTION_V1',id:id(1),applied:true,repeat:false});
 const now=row(182),r=JSON.parse(psql(`select to_jsonb(c) from public.camera_unit_router_corrections c where id='${id(1)}';`));
 assert.deepEqual(r.prior_row,prior);assert.equal(r.old_public_ip,'166.168.147.21');assert.equal(r.new_public_ip,'38.246.194.11');
 // The security-definer function still draws from the locked sequence (the owner's rolled-back insert above used one value).
 assert.ok(Number.isInteger(r.seq)&&r.seq>=1);assert.equal(psql(`select max(seq) from public.camera_unit_router_corrections;`),String(r.seq));
 assert.equal(r.router_serial,'RF3152533023889');assert.equal(r.product_id,'2300342');assert.equal(r.cos_unit_id,UNIT);assert.equal(r.provider,'InHand');assert.equal(r.approved_by,'James Martin');
 assert.equal(now.router_public_ip,'38.246.194.11');assert.equal(now.current_status,'unknown');assert.equal(now.last_checked_at,null);assert.equal(now.last_online_at,null);assert.equal(now.reported_latency_ms,null);
 assert.equal(now.reported_status,'online');assert.equal(now.status_source,'InHand Device Manager live read');assert.equal(now.status_observed_at,r.observed_at);
 for(const k of ['id','unit_key','router_name','router_model','unit_ip','web_port','web_protocol','created_at'])assert.deepEqual(now[k],prior[k],k);
 // The stale check's conditional save (same predicate as camera-health-sweep) no longer matches: an old result cannot land on the new address.
 assert.equal(psql(`set role service_role; with u as (update public.camera_unit_routers set current_status='offline',last_checked_at=now(),updated_at=now() where id=182 and unit_key='SOLARSPOTTER 053' and updated_at=${q(stale.updated_at)} and router_public_ip=${q(stale.ip)} and unit_ip is null and web_port is null returning id) select count(*) from u;`),'0');
 assert.equal(row(182).current_status,'unknown');
 // The next check picks the row up (never-checked rows are due first) and writes its own fresh result.
 assert.equal(psql(`select id from public.camera_unit_routers where router_public_ip is not null or unit_ip is not null order by last_checked_at nulls first limit 1;`),'182');
 const fresh=row(182);
 assert.equal(psql(`set role service_role; with u as (update public.camera_unit_routers set current_status='online',last_checked_at=now(),last_online_at=now(),updated_at=now() where id=182 and unit_key='SOLARSPOTTER 053' and updated_at=${q(fresh.updated_at)} and router_public_ip='38.246.194.11' and unit_ip is null and web_port is null returning id) select count(*) from u;`),'1');
 assert.equal(hash('public.camera_devices'),cams0);assert.equal(others(),others0);
});

test('repeating the same correction is harmless; reusing its id for something else is refused',{skip},()=>{
 const a=psql(`select observed_at from public.camera_unit_router_corrections where id='${id(1)}';`),before=hash('public.camera_unit_routers');
 assert.deepEqual(correct({observedAt:a}),{contract:'COS_ROUTER_CORRECTION_V1',id:id(1),applied:false,repeat:true});
 fails(()=>correct({observedAt:a,newIp:'38.246.194.12'}),/already used for a different change/);
 // Every reviewed field is part of the replay comparison.
 for(const change of [{unitId:'22222222-2222-4222-8222-222222222222'},{unitKey:'SOLARSPOTTER 054'},{routerId:79},{oldIp:'166.168.147.22'},{serial:'RF3152533023880'},{productId:'2300343'},{provider:'Other'},{source:'Another source'},{status:'offline'},{approvedBy:'Someone Else'},{approvalSource:'Another approval'},{reason:'Another reason'},{observedAt:new Date(Date.now()-60*60*1000).toISOString()}])
  fails(()=>correct({observedAt:a,...change}),/already used for a different change/);
 fails(()=>correct({id:id(4),routerId:79,unitKey:'SPOTTER 185',oldIp:'166.203.205.83',newIp:'38.246.195.93',serial:'RF3152533023889',productId:'2257840'}),/serial is already recorded for another router record/);
 assert.equal(hash('public.camera_unit_routers'),before);assert.equal(receipts(),1);
});

test('receipts cannot be edited, deleted or emptied, even by the table owner',{skip},()=>{
 fails(()=>psql(`update public.camera_unit_router_corrections set approved_by='x';`),/append-only/);
 fails(()=>psql(`delete from public.camera_unit_router_corrections;`),/append-only/);
 fails(()=>psql(`truncate public.camera_unit_router_corrections;`),/append-only/);
 assert.equal(receipts(),1);
});

test('SS019 is accepted only after Spotter 185 is corrected first, and duplicate #218 is left exactly as it was',{skip},()=>{
 const dup=JSON.stringify(row(218));
 correct({id:id(5),routerId:79,unitKey:'SPOTTER 185',oldIp:'166.203.205.83',newIp:'38.246.195.93',serial:'RF3022423383640',productId:'2257840',unitId:'11111111-1111-4111-8111-111111111185'});
 assert.equal(row(79).current_status,'unknown');
 correct({id:id(6),routerId:150,unitKey:'SOLAR SPOTTER 019',oldIp:'166.203.204.28',newIp:'166.203.205.83',serial:'RF3152442003375',productId:'2258996',unitId:'b41be068-91c3-4e0c-9328-7c914bca1f0d'});
 assert.equal(row(150).router_public_ip,'166.203.205.83');assert.equal(JSON.stringify(row(218)),dup);
 assert.equal(psql(`select count(*) from public.camera_unit_routers where router_public_ip='166.203.205.83';`),'1');
 assert.equal(hash('public.camera_devices'),cams0);assert.equal(others(),others0);
});

test('a reversal is a new receipt that restores the saved address without restoring the old probe result',{skip},()=>{
 fails(()=>revert(id(7),id(42)),/No such correction/);
 // Spotter 185 cannot go back while SS019 holds its earlier address.
 fails(()=>revert(id(7),id(5)),/Another router record now holds the earlier address \(SOLAR SPOTTER 019\)/);
 assert.deepEqual(revert(id(8),id(1)),{contract:'COS_ROUTER_CORRECTION_V1',id:id(8),applied:true,repeat:false});
 const now=row(182);assert.equal(now.router_public_ip,'166.168.147.21');assert.equal(now.current_status,'unknown');assert.equal(now.last_checked_at,null);assert.equal(now.last_online_at,null);assert.equal(now.reported_status,'unknown');
 assert.deepEqual(revert(id(8),id(1)),{contract:'COS_ROUTER_CORRECTION_V1',id:id(8),applied:false,repeat:true});
 for(const [by,src,why] of [['Someone Else','Synthetic test approval','Wrong router'],['James Martin','Another approval','Wrong router'],['James Martin','Synthetic test approval','Another reason']])
  fails(()=>psql(`set role service_role; select public.camera_unit_router_revert_v1('${id(8)}','${id(1)}',${q(by)},${q(src)},${q(why)});`),/already used for a different change/);
 fails(()=>revert(id(8),id(5)),/already used for a different change/);
 fails(()=>revert(id(9),id(1)),/already reversed/);
 assert.equal(psql(`select action||':'||(reverts is not null) from public.camera_unit_router_corrections where id='${id(1)}';`),'correct:false');
 assert.equal(receipts(),4);
 // After a reversal the serial is free to be recorded again.
 assert.equal(correct({id:id(10)}).applied,true);
 assert.equal(hash('public.camera_devices'),cams0);assert.equal(others(),others0);
});

test('two corrections racing for one address: exactly one is applied',{skip},async()=>{
 psql(`insert into public.camera_unit_routers(id,unit_key,router_public_ip) values(901,'RACE A','198.51.100.1'),(902,'RACE B','198.51.100.2');`);
 const {spawn}=await import('node:child_process');
 const run=(n,rid,key,old,serial)=>new Promise(res=>{const a=args({id:id(n),routerId:rid,unitKey:key,oldIp:old,newIp:'198.51.100.9',serial,productId:'2300'+n});
  const sql=`set role service_role; select pg_sleep(0.3); select public.camera_unit_router_correct_v1(${q(a.id)},${a.routerId},${q(a.unitKey)},${q(a.oldIp)}::inet,${q(a.newIp)}::inet,${q(a.serial)},${q(a.productId)},${q(a.unitId)},'InHand','race','online',now(),'James Martin','Synthetic','race');`;
  const p=join(dir,'race-'+n+'.sql');writeFileSync(p,sql);chmodSync(p,0o644);
  const c=spawn(asRoot?'su':'sh',asRoot?['postgres','-s','/bin/sh','-c',`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -h ${dir} -p ${port} -d postgres -f ${p} 2>&1`]:['-c',`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -h ${dir} -p ${port} -d postgres -f ${p} 2>&1`]);
  let out='';c.stdout.on('data',d=>out+=d);c.on('close',code=>res({code,out}));});
 const [a,b]=await Promise.all([run(21,901,'RACE A','198.51.100.1','RACESERIAL0001'),run(22,902,'RACE B','198.51.100.2','RACESERIAL0002')]);
 assert.equal([a,b].filter(x=>x.code===0).length,1);assert.match([a,b].find(x=>x.code!==0).out,/Another router record already holds that address/);
 assert.equal(psql(`select count(*) from public.camera_unit_routers where router_public_ip='198.51.100.9';`),'1');
});

test('only the latest correction in effect can be reversed: A→B, B→C, C→B, then the first A→B is refused',{skip},()=>{
 psql(`insert into public.camera_unit_routers(id,unit_key,router_public_ip) values(950,'CHAIN','203.0.113.1');`);
 const step=(n,from,to)=>correct({id:id(n),routerId:950,unitKey:'CHAIN',oldIp:from,newIp:to,serial:'CHAINSERIAL0001',productId:'2999001'});
 step(31,'203.0.113.1','203.0.113.2');step(32,'203.0.113.2','203.0.113.3');
 fails(()=>revert(id(41),id(31)),/changed since the correction|later correction is in effect/);
 step(33,'203.0.113.3','203.0.113.2');
 // The address equals what the first correction set, but a later one is in effect.
 const before=hash('public.camera_unit_routers'),n=receipts();
 fails(()=>revert(id(41),id(31)),/later correction is in effect/);
 fails(()=>revert(id(41),id(32)),/changed since the correction|later correction is in effect/);
 assert.equal(hash('public.camera_unit_routers'),before);assert.equal(receipts(),n);
 // Undoing in order works: latest first, each restoring what its own receipt saved.
 assert.equal(revert(id(42),id(33)).applied,true);assert.equal(row(950).router_public_ip,'203.0.113.3');
 fails(()=>revert(id(43),id(31)),/changed since the correction|later correction is in effect/);
 assert.equal(revert(id(44),id(32)).applied,true);assert.equal(row(950).router_public_ip,'203.0.113.2');
 assert.equal(revert(id(45),id(31)).applied,true);assert.equal(row(950).router_public_ip,'203.0.113.1');
 assert.equal(hash('public.camera_devices'),cams0);
});
