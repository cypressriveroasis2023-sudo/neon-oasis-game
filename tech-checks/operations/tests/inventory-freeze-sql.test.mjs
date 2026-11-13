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
const ipCensus=(sha,extra={})=>({contract:'COS_TRACKER_CONNECTION_CENSUS_V2',expectedMhelpSourceSha256:sha,verifiedAt:'2026-11-11T18:40:00.000Z',records:[
 {productId:'1001',recordId:'mhelp_product:1001',placement:'FIELD',publicIp:'8.8.8.8',sourceRow:2,reviewReasons:[]},
 {productId:'1002',recordId:'mhelp_product:1002',placement:'FIELD',publicIp:'9.9.9.9',sourceRow:3,reviewReasons:[]},
 {productId:'1003',recordId:'mhelp_product:1003',placement:'FIELD',publicIp:null,sourceRow:4,reviewReasons:[]},
 {productId:'1004',recordId:'mhelp_product:1004',placement:'SHOP',publicIp:null,sourceRow:5,reviewReasons:[]}],...extra});
const approve=(extra={})=>({sourceSha256:A,recordCount:4,fieldCount:3,shopCount:1,acceptedByName:'James Martin',reason:'COS keeps its own copy; inventory is edited by hand',ipCensus:ipCensus(extra.sourceSha256||A),...extra});
const edit=(actor,rid,payload,role='service_role')=>JSON.parse(psql(`set role ${role}; select public.cos_inventory_ip_edit_v1(${q(actor)},${q(ORG)},${q(rid)},${q(JSON.stringify({editedByName:'Teddy',reason:'Confirmed in VCC',...payload}))}::jsonb);`));
const ipOf=pid=>state().ipCensus.records.find(r=>r.productId===pid).publicIp;
const TECH='33333333-3333-4333-8333-333333333333';
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
   begin if p_org is distinct from '${ORG}'::uuid or not(p_actor='${OWNER}'::uuid or (not p_write and p_actor='${IT}'::uuid)) then raise exception 'Owner access required' using errcode='42501'; end if; end$$;`);
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
 // The IP list approved with it must be for this census and list exactly its A#s.
 fails(()=>call(OWNER,id(1),'freeze',approve({ipCensus:undefined})),/IP list does not match/);
 fails(()=>call(OWNER,id(1),'freeze',approve({ipCensus:ipCensus(B)})),/IP list does not match/);
 const short=ipCensus(A);short.records.pop();fails(()=>call(OWNER,id(1),'freeze',approve({ipCensus:short})),/IP list does not match/);
 const dup=ipCensus(A);dup.records[3].productId='1001';fails(()=>call(OWNER,id(1),'freeze',approve({ipCensus:dup})),/IP list does not match/);
 const stranger=ipCensus(A);stranger.records[3].productId='7777';fails(()=>call(OWNER,id(1),'freeze',approve({ipCensus:stranger})),/IP list does not match/);
 fails(()=>edit(OWNER,id(50),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.4'}),/not frozen/);
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

test('IPs change only by a recorded hand edit from the Owner or IT, one A# at a time',{skip},()=>{
 assert.deepEqual(state().ipCensus,ipCensus(A),'the approved IP list is served exactly as approved');
 assert.deepEqual(state().ipEdits,{count:0,lastAt:null});
 fails(()=>edit(TECH,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.4'}),/Owner access required/);
 for(const role of ['anon','authenticated'])fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.4'},role),/permission denied/);
 fails(()=>edit(IT,id(51),{productId:'9999',expectedOldIp:null,newIp:'8.8.4.4'}),/not in the approved COS inventory/);
 fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'1.1.1.1',newIp:'8.8.4.4'}),/changed since you opened it/);
 fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'9.9.9.9'}),/A# 1002 already has that IP/);
 fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.8.8'}),/already the saved IP/);
 for(const bad of ['192.168.1.10','10.0.0.5','999.1.1.1','8.8.8','8.8.8.8/24','008.8.8.8','example.com','127.0.0.1'])
  fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:bad}),/public IPv4/);
 fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.4',reason:' '}),/incomplete/);
 fails(()=>edit(IT,id(51),{productId:'1001',newIp:'8.8.4.4'}),/incomplete/);
 assert.equal(psql('select count(*) from cos_mhelp_placement_private.inventory_ip_edit_log;'),'0');
 // IT corrects one; the Owner fills in a blank; IT clears one.
 assert.equal(edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.4'}).applied,true);
 assert.equal(edit(OWNER,id(52),{productId:'1003',expectedOldIp:null,newIp:'1.1.1.1',editedByName:'James Martin'}).applied,true);
 assert.equal(edit(IT,id(53),{productId:'1002',expectedOldIp:'9.9.9.9',newIp:null}).applied,true);
 assert.deepEqual([ipOf('1001'),ipOf('1002'),ipOf('1003'),ipOf('1004')],['8.8.4.4',null,'1.1.1.1',null]);
 // Everything else about the approved list is untouched, and its real date has not moved.
 const now=state().ipCensus,seed=ipCensus(A);
 assert.equal(now.verifiedAt,seed.verifiedAt);assert.equal(now.expectedMhelpSourceSha256,A);
 assert.deepEqual(now.records.map(({publicIp,...rest})=>rest),seed.records.map(({publicIp,...rest})=>rest));
 assert.equal(state().ipEdits.count,3);
 // Repeat of the same edit is a no-op; the same id for something else is refused; the freed IP can now be used.
 assert.deepEqual(edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.4'}),{contract:'COS_INVENTORY_IP_EDIT_RESULT_V1',id:id(51),applied:false,repeat:true});
 fails(()=>edit(IT,id(51),{productId:'1001',expectedOldIp:'8.8.8.8',newIp:'8.8.4.5'}),/already used for a different change/);
 assert.equal(edit(IT,id(54),{productId:'1004',expectedOldIp:null,newIp:'9.9.9.9'}).applied,true);
 // Each edit is kept with who, old and new; the history cannot be altered.
 assert.equal(psql(`select string_agg(product_id||':'||coalesce(old_ip,'-')||'>'||coalesce(new_ip,'-')||':'||edited_by_name,' | ' order by seq) from cos_mhelp_placement_private.inventory_ip_edit_log;`),
  '1001:8.8.8.8>8.8.4.4:Teddy | 1003:->1.1.1.1:James Martin | 1002:9.9.9.9>-:Teddy | 1004:->9.9.9.9:Teddy');
 fails(()=>psql(`update cos_mhelp_placement_private.inventory_ip_edit_log set new_ip='1.2.3.4';`),/append-only/);
 fails(()=>psql(`delete from cos_mhelp_placement_private.inventory_ip_edit_log;`),/append-only/);
 for(const role of ['anon','authenticated','service_role'])fails(()=>psql(`set role ${role}; insert into cos_mhelp_placement_private.inventory_ip_edit_log(id,organization_id,freeze_id,product_id,old_ip,new_ip,edited_by,edited_by_name,reason) values('${id(98)}','${ORG}','${id(1)}','1001','a','b','${IT}','x','y');`),/permission denied/);
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
 fails(()=>psql(`truncate cos_mhelp_placement_private.inventory_freeze_log;`),/append-only|referenced in a foreign key/);
 fails(()=>psql(`truncate cos_mhelp_placement_private.inventory_freeze_log cascade;`),/append-only/);
 fails(()=>call(IT,id(3),'unfreeze',approve()),/Owner access required/);
 assert.equal(call(OWNER,id(3),'unfreeze',approve({reason:'Resume mHelp updates'})).applied,true);
 assert.deepEqual(state(),{contract:'COS_INVENTORY_FREEZE_STATE_V1',state:'none'});
 assert.equal(psql(`update cos_mhelp_placement_private.upload_control set active_sha256='${B}' where singleton returning 1;`),'1');
 // A later freeze names the census active then, with its own totals and read time.
 const second=ipCensus(B);second.records[3].placement='FIELD';
 assert.equal(call(OWNER,id(4),'freeze',approve({sourceSha256:B,fieldCount:4,shopCount:0,ipCensus:second})).applied,true);
 // seeded:true records that these IPs were supplied with the approval, not seeded empty.
 assert.deepEqual(state().ipCensus,{...second,seeded:true},'a new freeze starts from its own approved IP list; earlier edits do not carry over silently');
 assert.equal(state().freeze.sourceReadAt,'2026-11-11T19:05:00.000Z');assert.equal(rows(),3);
});

test('the install adds one guard trigger and otherwise alters no existing object',{skip},()=>{
 const sql=readFileSync(install,'utf8').replace(/--.*$/gm,'');
 assert.equal((sql.match(/create trigger[^;]*on cos_mhelp_placement_private\.upload_control/g)||[]).length,1);
 assert.equal(/alter\s+table\s+cos_mhelp_placement_private\.(upload_control|upload_batches)|create\s+or\s+replace|drop\s/i.test(sql),false);
 assert.equal(/equipment_units|camera|sim\b/i.test(sql),false);
});

// The Owner can accept the unit list without supplying the IPs: the IPs live in the
// 2027 tracker, and reading that sheet is slow and can fail, so the acceptance must
// not depend on it. The database then seeds the list from the census it just approved,
// every IP null, marked seeded:false so nothing can read "not copied in yet" as
// "this A# has no IP". Copying the real IPs in is its own recorded step.
test('the unit list can be accepted without the IPs, and says so',{skip},()=>{
 // The earlier tests leave census B frozen; start again from A, released.
 if(state().state==='frozen')assert.equal(call(OWNER,id(59),'unfreeze',{acceptedByName:'James Martin',reason:'reset for this case'}).applied,true);
 assert.equal(psql(`update cos_mhelp_placement_private.upload_control set active_sha256='${A}' where singleton returning 1;`),'1');
 assert.deepEqual(call(OWNER,id(60),'freeze',{sourceSha256:A,recordCount:4,fieldCount:3,shopCount:1,
  acceptedByName:'James Martin',reason:'COS keeps its own copy; IPs come later'}),
  {contract:'COS_INVENTORY_FREEZE_RESULT_V1',id:id(60),applied:true,repeat:false});
 const s=state();
 assert.equal(s.state,'frozen');
 assert.equal(s.ipCensus.seeded,false,'an unsupplied IP list must not claim to be seeded');
 assert.equal(s.ipCensus.expectedMhelpSourceSha256,A);
 assert.deepEqual(s.ipCensus.records.map(r=>r.productId).sort(),['1001','1002','1003','1004']);
 assert.equal(s.ipCensus.records.every(r=>r.publicIp===null),true,'seeded IPs must all be null');
 // A hand edit still works on the seeded list, and the list stays marked unseeded.
 assert.equal(edit(OWNER,id(61),{productId:'1002',newIp:'8.8.8.8',expectedOldIp:null}).applied,true);
 assert.equal(ipOf('1002'),'8.8.8.8');
 assert.equal(state().ipCensus.seeded,false);
 assert.deepEqual(call(OWNER,id(62),'unfreeze',{acceptedByName:'James Martin',reason:'done'}).applied,true);
});

test('a supplied IP list is marked seeded, and one that does not match the census is still refused',{skip},()=>{
 assert.equal(call(OWNER,id(63),'freeze',approve()).applied,true);
 const s=state();
 assert.equal(s.ipCensus.seeded,true,'a supplied IP list must be marked seeded');
 assert.equal(s.ipCensus.records.find(r=>r.productId==='1001').publicIp,'8.8.8.8');
 assert.equal(call(OWNER,id(64),'unfreeze',{acceptedByName:'James Martin',reason:'done'}).applied,true);
 fails(()=>call(OWNER,id(65),'freeze',approve({ipCensus:{expectedMhelpSourceSha256:A,records:[{productId:'1001',publicIp:'8.8.8.8'}]}})),/does not match the census/);
 fails(()=>call(OWNER,id(66),'freeze',approve({ipCensus:{expectedMhelpSourceSha256:B,records:ipCensus(A).records}})),/does not match the census/);
 assert.equal(state().state,'none');
});
