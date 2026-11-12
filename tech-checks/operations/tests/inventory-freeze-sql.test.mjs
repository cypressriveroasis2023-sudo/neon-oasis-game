// Runs the inventory-freeze install in a throwaway local PostgreSQL. upload_control,
// upload_batches and the Owner check are SUBSTITUTES with the columns the install
// reads (read from production 2026-11-12); this is not the live schema or importer.
// Production-style default grants and an RLS-bypassing service role are set up
// first, because that is what the install must hold against. Skipped without PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,chmodSync,writeFileSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMhelpInventoryAuthority} from '../src/mhelpInventoryAuthority.ts';
const root='/usr/lib/postgresql';
const bin=existsSync(root)?readdirSync(root).map(v=>join(root,v,'bin')).filter(p=>existsSync(join(p,'initdb'))).sort().pop():null;
const asRoot=typeof process.getuid==='function'&&process.getuid()===0;
const canRun=Boolean(bin)&&(!asRoot||spawnSync('id',['postgres']).status===0),skip=canRun?false:'no local PostgreSQL server binaries';
const install=fileURLToPath(new URL('../db/20261112_inventory_freeze.sql',import.meta.url));
let dir,port;
const sh=c=>execFileSync(asRoot?'su':'sh',asRoot?['postgres','-s','/bin/sh','-c',c]:['-c',c],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const psql=(sql,{file=false}={})=>{const path=join(dir,'q-'+Math.random().toString(36).slice(2)+'.sql');if(file)copyFileSync(sql,path);else writeFileSync(path,sql);chmodSync(path,0o644);
 return sh(`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -h ${dir} -p ${port} -d postgres -f ${path} 2>&1`).trim();};
const q=v=>v==null?'null':`'${String(v).replaceAll("'","''")}'`;
const fails=(fn,pattern)=>assert.throws(fn,e=>pattern.test(String(e.stdout||'')+String(e.stderr||'')+String(e.message)));
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',OWNER='11111111-1111-4111-8111-111111111111',IT='22222222-2222-4222-8222-222222222222';
const A='a'.repeat(64),B='b'.repeat(64),id=n=>'50000000-0000-4000-8000-'+String(n).padStart(12,'0');
const call=(actor,rid,action,payload,role='service_role')=>JSON.parse(psql(`set role ${role}; select public.cos_inventory_freeze_v1(${q(actor)},${q(ORG)},${q(rid)},${q(action)},${q(JSON.stringify(payload))}::jsonb);`));
const state=()=>JSON.parse(psql(`set role service_role; select public.cos_inventory_freeze_state_v1(${q(ORG)});`));
const approve=(extra={})=>({sourceSha256:A,recordCount:4,fieldCount:3,shopCount:1,acceptedByName:'James Martin',reason:'COS keeps its own copy; inventory is edited by hand',...extra});
const rows=()=>Number(psql('select count(*) from cos_mhelp_placement_private.inventory_freeze_log;'));
const READ_AT='2026-11-11T18:36:05.112Z';
test.before(()=>{if(!canRun)return;
 dir=mkdtempSync(join(tmpdir(),'cos-freeze-'));chmodSync(dir,0o777);port=57000+Math.floor(Math.random()*900);
 sh(`${bin}/initdb -D ${dir}/data -A trust -U postgres >/dev/null && ${bin}/pg_ctl -D ${dir}/data -o "-c listen_addresses='' -k ${dir} -p ${port}" -w -l ${dir}/log start >/dev/null`);
 const recs=p=>JSON.stringify(['1001','1002','1003'].map(x=>({productId:x,placement:'FIELD'})).concat([{productId:'1004',placement:p}]));
 psql(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema cos_mhelp_placement_private; create schema app_private;
  alter default privileges grant all on tables to anon,authenticated,service_role;
  alter default privileges grant all on sequences to anon,authenticated,service_role;
  alter default privileges grant execute on functions to anon,authenticated,service_role;
  grant usage on schema cos_mhelp_placement_private,app_private to service_role;
  create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text not null,receipt jsonb not null,records jsonb not null,admitted_at timestamptz not null default now());
  create table cos_mhelp_placement_private.upload_control(singleton boolean primary key default true check(singleton),active_sha256 text);
  insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values
   (${q(A)},'p1','{"complete":true,"reviewed":true,"recordCount":4,"receivedAt":"${READ_AT}"}',${q(recs('SHOP'))}),
   (${q(B)},'p2','{"complete":true,"reviewed":true,"recordCount":4,"receivedAt":"2026-11-11T19:05:00.000Z"}',${q(recs('FIELD'))}),
   ('${'c'.repeat(64)}','p3','{"complete":true,"reviewed":null,"recordCount":4,"receivedAt":"2026-11-11T19:35:00.000Z"}',${q(recs('SHOP'))});
  insert into cos_mhelp_placement_private.upload_control values(true,${q(A)});
  create function app_private.cos_owner_identity_assert_actor(p_actor uuid,p_org uuid,p_write boolean) returns void language plpgsql as $$
   begin if p_actor is distinct from '${OWNER}'::uuid or p_org is distinct from '${ORG}'::uuid then raise exception 'Owner access required' using errcode='42501'; end if; end$$;`);
 psql(install,{file:true});
});
test.after(()=>{if(canRun&&dir)try{sh(`${bin}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null`);}catch{}});

test('nothing is frozen at install, and no API role can touch the history or its sequence directly',{skip},()=>{
 assert.deepEqual(state(),{contract:'COS_INVENTORY_FREEZE_STATE_V1',state:'none'});
 const direct=`insert into cos_mhelp_placement_private.inventory_freeze_log(id,organization_id,action,source_sha256,source_read_at,record_count,field_count,shop_count,accepted_by,accepted_by_name,reason) values('${id(99)}','${ORG}','freeze','${A}',now(),4,3,1,'${OWNER}','x','y');`;
 for(const role of ['anon','authenticated','service_role']){
  fails(()=>psql(`set role ${role}; ${direct}`),/permission denied/);
  fails(()=>psql(`set role ${role}; select setval('cos_mhelp_placement_private.inventory_freeze_log_seq_seq',99);`),/permission denied/);
  fails(()=>psql(`set role ${role}; select count(*) from cos_mhelp_placement_private.inventory_freeze_log;`),/permission denied/);
 }
 for(const role of ['anon','authenticated']){fails(()=>call(OWNER,id(1),'freeze',approve(),role),/permission denied/);fails(()=>psql(`set role ${role}; select public.cos_inventory_freeze_state_v1('${ORG}');`),/permission denied/);}
 assert.equal(rows(),0);
});

test('only the Owner can freeze, only the exact active reviewed census, and only with the totals they were shown',{skip},()=>{
 fails(()=>call(IT,id(1),'freeze',approve()),/Owner access required/);
 fails(()=>call(OWNER,id(1),'freeze',approve({sourceSha256:B})),/no longer the active one/);
 fails(()=>call(OWNER,id(1),'freeze',approve({fieldCount:4,shopCount:0})),/totals do not match/);
 fails(()=>call(OWNER,id(1),'freeze',approve({recordCount:5})),/totals do not match/);
 fails(()=>call(OWNER,id(1),'freeze',approve({reason:' '})),/incomplete/);
 fails(()=>call(OWNER,id(1),'freeze',approve({acceptedByName:''})),/incomplete/);
 fails(()=>call(OWNER,id(1),'thaw',approve()),/incomplete/);
 fails(()=>call(OWNER,id(1),'unfreeze',approve()),/not frozen/);
 psql(`update cos_mhelp_placement_private.upload_control set active_sha256='${'c'.repeat(64)}';`);
 fails(()=>call(OWNER,id(1),'freeze',approve({sourceSha256:'c'.repeat(64)})),/complete, reviewed census/);
 psql(`update cos_mhelp_placement_private.upload_control set active_sha256='${A}';`);
 assert.equal(rows(),0);assert.equal(state().state,'none');
});

test('a freeze records the real mHelp read time, and the app-side rule accepts exactly that census',{skip},()=>{
 assert.deepEqual(call(OWNER,id(1),'freeze',approve()),{contract:'COS_INVENTORY_FREEZE_RESULT_V1',id:id(1),applied:true,repeat:false});
 const s=state();assert.equal(s.state,'frozen');
 assert.equal(s.freeze.contract,'COS_INVENTORY_FREEZE_V1');assert.equal(s.freeze.sourceSha256,A);assert.equal(s.freeze.sourceReadAt,READ_AT);
 assert.equal(s.freeze.acceptedBy,'James Martin');assert.deepEqual([s.freeze.recordCount,s.freeze.fieldCount,s.freeze.shopCount],[4,3,1]);
 // Hand the stored freeze to the rule the board uses: a week-old copy is usable, and its date has not moved.
 const records=[['1001','FIELD'],['1002','FIELD'],['1003','FIELD'],['1004','SHOP']].map(([productId,placement])=>({productId,placement,uploadLifecycle:'UNFLAGGED',recordId:'mhelp_product:'+productId}));
 const census=sha=>({contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',source:'mhelpdesk_api',sourceSha256:sha,receivedAt:READ_AT,lastApiReadAt:READ_AT,records,
  summary:{totalRecords:4,fieldRecords:3,shopRecords:1,unflaggedFieldRecords:3,doNotUseRecords:0,missingRecords:0},frozen:s.freeze});
 const later=Date.parse(s.freeze.acceptedAt)+7*24*60*60*1000;
 const a=readMhelpInventoryAuthority(census(A),later);assert.equal(a.stale,false);assert.equal(a.receivedAt,READ_AT);assert.equal(a.frozen.acceptedBy,'James Martin');
 assert.equal(readMhelpInventoryAuthority(census(B),later).stale,true,'the same freeze does not cover a different census');
});

test('repeats are harmless only when identical; a second freeze is refused',{skip},()=>{
 assert.deepEqual(call(OWNER,id(1),'freeze',approve()),{contract:'COS_INVENTORY_FREEZE_RESULT_V1',id:id(1),applied:false,repeat:true});
 fails(()=>call(OWNER,id(1),'freeze',approve({reason:'different'})),/already used for a different change/);
 fails(()=>call(OWNER,id(1),'unfreeze',approve()),/already used for a different change/);
 fails(()=>call(OWNER,id(2),'freeze',approve()),/already frozen/);
 assert.equal(rows(),1);
});

test('while frozen the approved census cannot be swapped out, and loading batches is not blocked',{skip},()=>{
 fails(()=>psql(`set role service_role; update cos_mhelp_placement_private.upload_control set active_sha256='${B}' where singleton;`),/frozen on the approved copy/);
 fails(()=>psql(`delete from cos_mhelp_placement_private.upload_control;`),/frozen on the approved copy/);
 assert.equal(psql(`update cos_mhelp_placement_private.upload_control set active_sha256='${A}' where singleton returning 1;`),'1','re-affirming the same census is allowed');
 assert.equal(psql(`insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values('${'d'.repeat(64)}','p4','{}','[]') returning 1;`),'1','a new batch can still be admitted');
 assert.equal(psql(`select active_sha256 from cos_mhelp_placement_private.upload_control;`),A);
});

test('history is append-only; unfreezing is a new Owner entry and restores normal behaviour',{skip},()=>{
 fails(()=>psql(`update cos_mhelp_placement_private.inventory_freeze_log set reason='x';`),/append-only/);
 fails(()=>psql(`delete from cos_mhelp_placement_private.inventory_freeze_log;`),/append-only/);
 fails(()=>psql(`truncate cos_mhelp_placement_private.inventory_freeze_log;`),/append-only/);
 fails(()=>call(IT,id(3),'unfreeze',approve()),/Owner access required/);
 assert.equal(call(OWNER,id(3),'unfreeze',approve({reason:'Resume mHelp updates'})).applied,true);
 assert.deepEqual(state(),{contract:'COS_INVENTORY_FREEZE_STATE_V1',state:'none'});
 assert.equal(psql(`update cos_mhelp_placement_private.upload_control set active_sha256='${B}' where singleton returning 1;`),'1');
 // A later freeze names the census active then, with its own totals and read time.
 assert.equal(call(OWNER,id(4),'freeze',approve({sourceSha256:B,fieldCount:4,shopCount:0})).applied,true);
 assert.equal(state().freeze.sourceReadAt,'2026-11-11T19:05:00.000Z');assert.equal(rows(),3);
});

test('the install adds one guard trigger and otherwise alters no existing object',{skip},()=>{
 const sql=readFileSync(install,'utf8').replace(/--.*$/gm,'');
 assert.equal((sql.match(/create trigger[^;]*on cos_mhelp_placement_private\.upload_control/g)||[]).length,1);
 assert.equal(/alter\s+table\s+cos_mhelp_placement_private\.(upload_control|upload_batches)|create\s+or\s+replace|drop\s/i.test(sql),false);
 assert.equal(/equipment_units|camera|sim\b/i.test(sql),false);
});
