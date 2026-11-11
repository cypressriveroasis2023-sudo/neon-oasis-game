// Runs the manual equipment record migration in a throwaway local PostgreSQL
// and exercises the function exactly as the server calls it. Skipped when no
// local PostgreSQL server binaries are installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,chmodSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root='/usr/lib/postgresql';
const bin=existsSync(root)?readdirSync(root).map(v=>join(root,v,'bin')).filter(p=>existsSync(join(p,'initdb'))).sort().pop():null;
const asRoot=typeof process.getuid==='function'&&process.getuid()===0;
const canRun=Boolean(bin)&&(!asRoot||spawnSync('id',['postgres']).status===0);
const skip=canRun?false:'no local PostgreSQL server binaries';
const migration=fileURLToPath(new URL('../db/20261111_manual_equipment_record.sql',import.meta.url));
const OWNER='00000000-0000-4000-8000-000000000001',IT='00000000-0000-4000-8000-000000000002',SERVICE='00000000-0000-4000-8000-000000000003',ORG='00000000-0000-4000-8000-0000000000aa';
let dir,port;
const sh=command=>execFileSync(asRoot?'su':'sh',asRoot?['postgres','-s','/bin/sh','-c',command]:['-c',command],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const psql=(sql,{file=false}={})=>{const path=join(dir,'q-'+Math.random().toString(36).slice(2)+'.sql');if(file)copyFileSync(sql,path);else writeFileSync(path,sql);chmodSync(path,0o644);
 return sh(`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -h ${dir} -p ${port} -d postgres -f ${path} 2>&1`).trim();};
const call=(actor,product,action='read',extra={})=>{const j=v=>v===undefined||v===null?'null':`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
 return JSON.parse(psql(`set role service_role; select public.cos_manual_equipment_v1('${actor}','${ORG}',${product===null?'null':`'${product}'`},'${action}',${extra.requestId?`'${extra.requestId}'`:'null'},${extra.reason===undefined?'null':`'${String(extra.reason).replaceAll("'","''")}'`},${j(extra.expected)},${j(extra.changes)});`));};
const fails=(fn,pattern)=>assert.throws(fn,error=>pattern.test(String(error.stdout||'')+String(error.stderr||'')+String(error.message)));
const expected=r=>({productId:r.productId,revision:r.revision,auditId:r.auditId,proof:r.proof});
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');

test.before(()=>{if(!canRun)return;
 dir=mkdtempSync(join(tmpdir(),'cos-manual-'));chmodSync(dir,0o777);port=54000+Math.floor(Math.random()*900);
 sh(`${bin}/initdb -D ${dir}/data -A trust -U postgres >/dev/null && ${bin}/pg_ctl -D ${dir}/data -o "-c listen_addresses='' -k ${dir} -p ${port}" -w -l ${dir}/log start >/dev/null`);
 psql(`create role anon; create role authenticated; create role service_role;
  create schema auth; create schema app_private;
  create table auth.users(id uuid primary key); create table public.organizations(id uuid primary key);
  insert into public.organizations values('${ORG}'); insert into auth.users values('${OWNER}'),('${IT}'),('${SERVICE}');
  create table public.allowed(user_id uuid primary key);insert into public.allowed values('${OWNER}'),('${IT}');
  create function app_private.cos_fleet_shop_actor(p_actor uuid,p_org uuid) returns void language plpgsql security definer set search_path='' as $$begin
   if p_org<>'${ORG}' or not exists(select 1 from public.allowed where user_id=p_actor) then raise exception 'Owner or IT placement access required' using errcode='42501';end if;end $$;`);
 psql(migration,{file:true});
});
test.after(()=>{if(canRun&&dir)try{sh(`${bin}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null 2>&1; rm -rf ${dir}/data`);}catch{}});

test('an unedited Product ID reads as an empty manual record',{skip},()=>{
 const r=call(OWNER,'1713914');
 assert.equal(r.contract,'COS_MANUAL_EQUIPMENT_V1');assert.equal(r.revision,0);assert.equal(r.auditId,null);assert.match(r.proof,/^[a-f0-9]{64}$/);
 assert.deepEqual(r.record,{displayName:null,placement:null,customer:null,siteName:null,address:null,deviceLink:null,note:null});
});
test('Owner and IT have the same edit power; anyone else is refused',{skip},()=>{
 const first=call(OWNER,'2001'),a=call(OWNER,'2001','save',{requestId:id(1),reason:'Installed today',expected:expected(first),changes:{placement:'FIELD',siteName:'Bristol Friendswood'}});
 assert.equal(a.saved,true);assert.equal(a.revision,1);assert.equal(a.recordedBy,OWNER);assert.deepEqual(a.applied,{placement:'FIELD',siteName:'Bristol Friendswood'});
 const b=call(IT,'2001','save',{requestId:id(2),reason:'Returned to shop',expected:expected(a),changes:{placement:'SHOP'}});
 assert.equal(b.saved,true);assert.equal(b.revision,2);assert.equal(b.recordedBy,IT);assert.equal(b.record.placement,'SHOP');assert.equal(b.record.siteName,'Bristol Friendswood');
 fails(()=>call(SERVICE,'2001'),/Owner or IT placement access required/);
 fails(()=>call(SERVICE,'2001','save',{requestId:id(3),reason:'x',expected:expected(b),changes:{placement:'FIELD'}}),/Owner or IT placement access required/);
 assert.equal(call(OWNER,'2001').revision,2);
});
test('the paper trail records who, when, why, and the record before and after',{skip},()=>{
 const h=call(OWNER,'2001','history');
 assert.equal(h.contract,'COS_MANUAL_EQUIPMENT_HISTORY_V1');assert.equal(h.items.length,2);
 const [latest,first]=h.items;
 assert.equal(latest.actorId,IT);assert.equal(latest.reason,'Returned to shop');assert.equal(latest.before.placement,'FIELD');assert.equal(latest.after.placement,'SHOP');assert.ok(Date.parse(latest.recordedAt));
 assert.equal(first.actorId,OWNER);assert.equal(first.reason,'Installed today');assert.equal(first.before.placement,null);assert.deepEqual(first.changes,{placement:'FIELD',siteName:'Bristol Friendswood'});
});
test('the paper trail cannot be edited, deleted or emptied',{skip},()=>{
 fails(()=>psql(`update app_private.cos_manual_equipment_edits set reason='changed'`),/history cannot be changed/);
 fails(()=>psql(`delete from app_private.cos_manual_equipment_edits`),/history cannot be changed/);
 fails(()=>psql(`truncate app_private.cos_manual_equipment_edits`),/history cannot be changed/);
 fails(()=>psql(`set role authenticated; select * from app_private.cos_manual_equipment_edits`),/permission denied/);
 fails(()=>psql(`set role authenticated; select public.cos_manual_equipment_v1('${OWNER}','${ORG}','2001')`),/permission denied/);
 assert.equal(call(OWNER,'2001','history').items.length,2);
});
test('a save made from an out-of-date screen is refused as a conflict, never as a retryable error',{skip},()=>{
 const start=call(OWNER,'2002'),one=call(OWNER,'2002','save',{requestId:id(10),reason:'name',expected:expected(start),changes:{displayName:'Spotter 052'}});
 let text='';try{call(IT,'2002','save',{requestId:id(11),reason:'late',expected:expected(start),changes:{displayName:'Other'}});}catch(error){text=String(error.stdout||'')+String(error.message);}
 assert.match(text,/changed by someone else/);
 // PostgREST retries SQLSTATE 40001 forever. This function must never raise it.
 const source=psql(`select prosrc from pg_proc where proname='cos_manual_equipment_v1'`);assert.ok(!source.includes('40001'));assert.ok(source.includes('PT409'));
 assert.equal(call(OWNER,'2002').record.displayName,'Spotter 052');assert.equal(call(OWNER,'2002').auditId,one.auditId);
});
test('repeating the same save request does not save twice; reusing its id for something else is refused',{skip},()=>{
 const start=call(OWNER,'2003'),args={requestId:id(20),reason:'field',expected:expected(start),changes:{placement:'FIELD'}};
 const first=call(OWNER,'2003','save',args),again=call(OWNER,'2003','save',args);
 assert.equal(first.replayed,false);assert.equal(again.replayed,true);assert.equal(again.auditId,first.auditId);assert.equal(again.proof,first.proof);assert.equal(call(OWNER,'2003','history').items.length,1);
 fails(()=>call(OWNER,'2003','save',{...args,changes:{placement:'SHOP'}}),/reused with different details/);
 fails(()=>call(IT,'2003','save',args),/reused with different details/);
});
test('fields are validated, trimmed, and cleared with null',{skip},()=>{
 let r=call(OWNER,'2004');
 const save=(n,changes)=>{r=call(OWNER,'2004','save',{requestId:id(n),reason:'edit',expected:expected(r),changes});return r;};
 assert.equal(save(30,{displayName:'  Solar Spotter 019  ',address:'110 Twistleaf,\nBuda, TX 78610'}).record.displayName,'Solar Spotter 019');
 assert.equal(r.record.address,'110 Twistleaf, Buda, TX 78610');
 assert.equal(save(31,{displayName:null}).record.displayName,null);assert.equal(r.record.address,'110 Twistleaf, Buda, TX 78610');
 const bad=(changes,pattern)=>fails(()=>call(OWNER,'2004','save',{requestId:id(40+Math.floor(Math.random()*1e6)),reason:'edit',expected:expected(r),changes}),pattern);
 bad({placement:'field'},/Placement must be FIELD or SHOP/);bad({placement:'UNKNOWN'},/Placement must be FIELD or SHOP/);
 bad({owner:'x'},/Unknown field/);bad({displayName:5},/Enter text/);bad({displayName:'x'.repeat(121)},/too long/);
 bad({address:'110 Twistleaf, Buda, TX 78610'},/Nothing would change/);bad({},/change and a reason are required/);
 fails(()=>call(OWNER,'2004','save',{requestId:id(99),reason:'   ',expected:expected(r),changes:{note:'x'}}),/reason are required/);
 fails(()=>call(OWNER,'abc'),/Choose an mHelp Product ID/);fails(()=>call(OWNER,'0'),/Choose an mHelp Product ID/);fails(()=>call(OWNER,null),/Choose an mHelp Product ID/);
 assert.equal(call(OWNER,'2004').revision,2);
});
test('installing over an existing installation is refused',{skip},()=>{
 fails(()=>psql(migration,{file:true}),/already exist; review before replacing/);
});
