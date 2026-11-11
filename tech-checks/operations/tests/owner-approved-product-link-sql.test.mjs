// Runs the Owner-approved Product link install and the two recorded approvals in
// a throwaway local PostgreSQL. The tables it reads, the Owner check and the batch
// loader here are SUBSTITUTES with the same columns the install reads: this is not
// the real mHelp importer and not the live schema. The read-only precheck file is
// what compares the install against the live schema; it is run here too so the
// substitutes are held to the same shape. Skipped without PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,chmodSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root='/usr/lib/postgresql';
const bin=existsSync(root)?readdirSync(root).map(v=>join(root,v,'bin')).filter(p=>existsSync(join(p,'initdb'))).sort().pop():null;
const asRoot=typeof process.getuid==='function'&&process.getuid()===0;
const canRun=Boolean(bin)&&(!asRoot||spawnSync('id',['postgres']).status===0),skip=canRun?false:'no local PostgreSQL server binaries';
const precheck=fileURLToPath(new URL('../db/20261111_owner_approved_product_links_precheck.sql',import.meta.url));
const install=fileURLToPath(new URL('../db/20261111_owner_approved_product_links.sql',import.meta.url)),two=fileURLToPath(new URL('../db/20261111_owner_approved_product_links_two_approvals.sql',import.meta.url));
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',OWNER='00000000-0000-4000-8000-000000000001',IT='00000000-0000-4000-8000-000000000002';
const U12='0d3a6038-b645-4c62-913d-479783c34f6f',U281='e2fb7468-b4bf-4b4a-97a1-6248f7c144e4',U28='bbf580b9-0000-4000-8000-000000000028',U18='5034a257-f5ee-4285-afcf-0e8533708165',U11='1cfaf423-a5ac-4910-b9b8-08486827a53b';
let dir,port;
const sh=c=>execFileSync(asRoot?'su':'sh',asRoot?['postgres','-s','/bin/sh','-c',c]:['-c',c],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const psql=(sql,{file=false}={})=>{const path=join(dir,'q-'+Math.random().toString(36).slice(2)+'.sql');if(file)copyFileSync(sql,path);else writeFileSync(path,sql);chmodSync(path,0o644);
 return sh(`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -h ${dir} -p ${port} -d postgres -f ${path} 2>&1`).trim();};
const q=v=>v==null?'null':`'${String(v).replaceAll("'","''")}'`;
const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const payload=(p={})=>({productId:'2232677',unitId:U12,mhelpLabel:'Solar Spotter 012',cosLabel:'Solar Spotter 012HDC2',approvedBy:'James Martin',approvalSource:'Approved in the Fleet screen by the signed-in Owner.',approvedAt:'2026-11-11T15:54:00-06:00',reason:'Fresh inventory link by exact A#.',...p});
const call=(actor,request,action,p)=>JSON.parse(psql(`set role service_role; select public.cos_owner_product_link_v1(${q(actor)},${q(ORG)},${q(request)},${q(action)},${q(JSON.stringify(p))}::jsonb);`));
const active=()=>JSON.parse(psql(`set role service_role; select public.cos_owner_product_links_active_v1(${q(ORG)});`)).links;
const fails=(fn,pattern)=>assert.throws(fn,e=>pattern.test(String(e.stdout||'')+String(e.stderr||'')+String(e.message)));
const rec=(pid,label,extra={})=>({productId:pid,unitNumber:label,category:'Solar Spotter',customer:'Customer: Site',placement:'FIELD',lifecycle:'UNFLAGGED',binding:null,possibleAliasUnitIds:[],...extra});
const load=(sha,recs)=>psql(`insert into cos_mhelp_placement_private.upload_batches values(${q(sha)},${q(JSON.stringify(recs))}::jsonb) on conflict(source_sha256) do nothing; update cos_mhelp_placement_private.upload_control set active_sha256=${q(sha)} where singleton;`);
const base=()=>[rec('2232677','Solar Spotter 012',{holdReason:'Product ID identity label changed; confirm before linking'}),rec('2221820','Spotter 028.1 HDC4S - SOLAR COMPATIBLE',{holdReason:'Prior reviewed scoped identity or assignment requires Owner installation review'}),
 rec('2274383','SOLAR SPOTTER 028',{binding:{nativeUnitId:U28,trackerId:null,representedUnitIds:[U28]}}),rec('2258987','Solar Spotter 018',{holdReason:'api_equipment_label_changed'}),
 rec('2232676','Solar Spotter 011',{holdReason:'identity_conflict',possibleAliasUnitIds:[U11]}),rec('2300001','Solar Spotter 090',{lifecycle:'DO_NOT_USE'})];
const objects=()=>psql(`select string_agg(x,E'\\n' order by x) from (select 'fn '||p.oid::regprocedure||' '||md5(p.prosrc) x from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('cos_mhelp_placement_private','public','app_private') and p.proname not like 'cos_owner_product_link%'
 union all select 'trg '||tgrelid::regclass||' '||tgname from pg_trigger where not tgisinternal and tgname not like 'cos_owner_product_links%'
 union all select 'tbl '||c.oid::regclass||' '||(select string_agg(attname||':'||atttypid::regtype,',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('cos_mhelp_placement_private','public','app_private') and c.relname<>'cos_owner_product_links') s;`);
let before,pre,units0;
test.before(()=>{if(!canRun)return;
 dir=mkdtempSync(join(tmpdir(),'cos-links-'));chmodSync(dir,0o777);port=55000+Math.floor(Math.random()*900);
 sh(`${bin}/initdb -D ${dir}/data -A trust -U postgres >/dev/null && ${bin}/pg_ctl -D ${dir}/data -o "-c listen_addresses='' -k ${dir} -p ${port}" -w -l ${dir}/log start >/dev/null`);
 psql(`create role anon; create role authenticated; create role service_role;
  create schema app_private; create schema cos_mhelp_placement_private;
  create table public.equipment_units(id uuid primary key,organization_id uuid,unit_number text,status text,retired_at timestamptz);
  insert into public.equipment_units values('${U12}','${ORG}','Solar Spotter 012HDC2','available',null),('${U281}','${ORG}','Spotter 028.1HDC4S','available',null),('${U28}','${ORG}','Solar Spotter 028HDC2','available',null),('${U18}','${ORG}','Solar Spotter 018HDC2','available',null),('${U11}','${ORG}','Solar Spotter 011HDC2','available',null);
  create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,records jsonb);
  create table cos_mhelp_placement_private.upload_control(singleton boolean primary key default true,active_sha256 text);insert into cos_mhelp_placement_private.upload_control values(true,null);
  create function cos_mhelp_placement_private.scoped_records(p text) returns jsonb language sql stable as $$select records from cos_mhelp_placement_private.upload_batches where source_sha256=p$$;
  create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid);
  create table app_private.cos_owner_identity_claims(native_unit_id uuid,product_association jsonb);
  create function app_private.cos_owner_identity_assert_actor(p_actor uuid,p_org uuid,p_write boolean) returns void language plpgsql as $$begin if p_actor<>'${OWNER}' or p_org<>'${ORG}' then raise exception 'Owner authorization required' using errcode='42501';end if;end$$;`);
 load('a'.repeat(64),base());before=objects();
 pre=JSON.parse(psql(precheck,{file:true}));units0=psql(`select md5(string_agg(to_jsonb(u)::text,'' order by id)) from public.equipment_units u;`);
 psql(install,{file:true});
});
test.after(()=>{if(canRun&&dir)try{sh(`${bin}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null`);}catch{}});

test('the read-only precheck passes before the install and reports both approvals as passing their guards',{skip},()=>{
 assert.deepEqual(pre.missingColumns,[]);for(const k of ['scopedRecordsReturnsJsonb','ownerAssertExists','rolesExist','nothingToCreateAlreadyExists'])assert.equal(pre[k],true,k);
 assert.equal(pre.uploadBatchesTriggers,0);assert.deepEqual(pre.approvals,[{productId:'2221820',cosRecordOk:true,mhelpRecordOk:true,nothingElseClaimsIt:true},{productId:'2232677',cosRecordOk:true,mhelpRecordOk:true,nothingElseClaimsIt:true}]);
 assert.equal(JSON.parse(psql(precheck,{file:true})).nothingToCreateAlreadyExists,false);                       // after the install it says so
});
test('the install adds its own objects only: no existing table, trigger or function is changed',{skip},()=>{
 assert.equal(objects(),before);
 assert.equal(psql(`select count(*) from pg_trigger where not tgisinternal and tgrelid='cos_mhelp_placement_private.upload_batches'::regclass;`),'0');
});
test('a substitute batch insert in the importer\'s own form (insert ... on conflict do nothing) still goes in after the install',{skip},()=>{
 load('b'.repeat(64),base());assert.equal(psql(`select active_sha256 from cos_mhelp_placement_private.upload_control;`),'b'.repeat(64));
});
test('only the Owner can record an approval; IT, browser roles and unknown fields are refused',{skip},()=>{
 fails(()=>call(IT,id(1),'approve',payload()),/Owner authorization required/);
 fails(()=>call(OWNER,id(1),'approve',{...payload(),extra:1}),/Invalid Product link request/);
 for(const role of ['anon','authenticated'])fails(()=>psql(`set role ${role}; select public.cos_owner_product_links_active_v1('${ORG}');`),/permission denied/);
 fails(()=>psql(`set role service_role; select * from app_private.cos_owner_product_links;`),/permission denied/);
 assert.deepEqual(active(),[]);
});
test('guards: wrong COS label, retired record, flagged or held or already-linked A#, claimed record, renamed mHelp label',{skip},()=>{
 fails(()=>call(OWNER,id(2),'approve',payload({cosLabel:'Solar Spotter 012'})),/missing, renamed or retired/);
 fails(()=>call(OWNER,id(2),'approve',payload({unitId:id(999)})),/missing, renamed or retired/);
 fails(()=>call(OWNER,id(2),'approve',payload({mhelpLabel:'Solar Spotter 012.1'})),/flagged, already linked, renamed or under a hold/);
 fails(()=>call(OWNER,id(2),'approve',payload({productId:'2258987',unitId:U18,mhelpLabel:'Solar Spotter 018',cosLabel:'Solar Spotter 018HDC2'})),/under a hold/);
 fails(()=>call(OWNER,id(2),'approve',payload({productId:'2232676',unitId:U11,mhelpLabel:'Solar Spotter 011',cosLabel:'Solar Spotter 011HDC2'})),/under a hold/);
 fails(()=>call(OWNER,id(2),'approve',payload({productId:'2300001',mhelpLabel:'Solar Spotter 090'})),/flagged/);
 fails(()=>call(OWNER,id(2),'approve',payload({productId:'2274383',mhelpLabel:'SOLAR SPOTTER 028'})),/already linked/);
 fails(()=>call(OWNER,id(2),'approve',payload({unitId:U28,cosLabel:'Solar Spotter 028HDC2'})),/already claims/);
 fails(()=>call(OWNER,id(2),'approve',payload({productId:'9999999'})),/not present exactly once/);
 fails(()=>call(OWNER,id(2),'approve',payload({approvedAt:'2099-01-01T00:00:00Z'})),/Invalid Product link request/);
 psql(`insert into app_private.cos_owner_identity_claims values('${U12}','{"productId":"555"}');`);
 fails(()=>call(OWNER,id(2),'approve',payload()),/already claims/);psql(`truncate app_private.cos_owner_identity_claims;`);
 psql(`insert into cos_mhelp_placement_private.links values('555',null,'${U12}');`);fails(()=>call(OWNER,id(2),'approve',payload()),/already claims/);psql(`truncate cos_mhelp_placement_private.links;`);
 psql(`update public.equipment_units set status='retired' where id='${U12}';`);fails(()=>call(OWNER,id(2),'approve',payload()),/missing, renamed or retired/);psql(`update public.equipment_units set status='available' where id='${U12}';`);
 assert.deepEqual(active(),[]);
});
test('the two recorded approvals go through the same guards, separately, with their source and time',{skip},()=>{
 psql(two,{file:true});
 assert.deepEqual(active().map(l=>[l.productId,l.unitId,l.mhelpLabel,l.cosLabel]),[['2221820',U281,'Spotter 028.1 HDC4S - SOLAR COMPATIBLE','Spotter 028.1HDC4S'],['2232677',U12,'Solar Spotter 012','Solar Spotter 012HDC2']]);
 const rows=JSON.parse(psql(`select jsonb_agg(to_jsonb(l) order by product_id) from app_private.cos_owner_product_links l;`));
 assert.equal(rows.length,2);for(const r of rows){assert.equal(r.approved_by,'James Martin');assert.equal(r.recorded_via,'reviewed_install');assert.equal(r.recorded_by,null);assert.ok(r.approval_source.length>40);assert.ok(r.evidence.sourceSha256);}
 assert.equal(new Date(rows[0].approved_at).toISOString(),'2026-11-11T21:38:00.000Z');assert.equal(new Date(rows[1].approved_at).toISOString(),'2026-11-11T21:54:00.000Z');
 assert.equal(rows[1].evidence.answeredNote,'Product ID identity label changed; confirm before linking');
 assert.ok(rows[0].approval_source.includes('Wed 2026-11-11 3:38 PM CT: "James confirms A#2221820 matches Spotter 028.1.'));assert.ok(rows[1].approval_source.includes('Wed 2026-11-11 3:54 PM CT: "James approved the fresh inventory link mHelp A#2232677 Solar Spotter 012 → COS Solar Spotter 012HDC2'));
 psql(two,{file:true});assert.equal(psql(`select count(*) from app_private.cos_owner_product_links;`),'2');           // running the file again records nothing new
});
test('history cannot be edited or deleted; one live approval per A# and per COS record',{skip},()=>{
 for(const sql of [`update app_private.cos_owner_product_links set cos_label='x'`,`delete from app_private.cos_owner_product_links`,`truncate app_private.cos_owner_product_links`])fails(()=>psql(sql+';'),/append-only/);
 fails(()=>call(OWNER,id(3),'approve',payload()),/already has a live approval/);
 fails(()=>call(OWNER,id(3),'approve',payload({productId:'2258987',mhelpLabel:'Solar Spotter 018'})),/already has a live approval/);
});
test('a later mHelp load keeps both approvals live; revoking adds a new entry and frees the A# to be approved again',{skip},()=>{
 load('c'.repeat(64),base().map(r=>r.productId==='2232677'?{...r,unitNumber:'SOLAR SPOTTER 012'}:r));assert.equal(active().length,2);
 const live=active().find(l=>l.productId==='2232677');
 fails(()=>call(IT,id(4),'revoke',payload({revokes:live.approvalId})),/Owner authorization required/);
 const out=call(OWNER,id(4),'revoke',payload({revokes:live.approvalId,reason:'Recorded against the wrong unit; revoking.'}));assert.equal(out.action,'revoke');
 assert.deepEqual(active().map(l=>l.productId),['2221820']);assert.equal(psql(`select count(*) from app_private.cos_owner_product_links;`),'3');
 fails(()=>call(OWNER,id(5),'revoke',payload({revokes:live.approvalId})),/No live approval to revoke/);
 assert.equal(call(OWNER,id(4),'revoke',payload({revokes:live.approvalId,reason:'Recorded against the wrong unit; revoking.'})).replayed,true);
 fails(()=>call(OWNER,id(4),'revoke',payload({revokes:live.approvalId,reason:'A different reason entirely.'})),/reused with different content/);
 const again=call(OWNER,id(6),'approve',payload({mhelpLabel:'solar spotter 012 '}));assert.equal(again.action,'approve');assert.equal(again.evidence.mhelpUnitNumber,'SOLAR SPOTTER 012');
 assert.deepEqual(active().map(l=>l.productId),['2221820','2232677']);
});

const session=sql=>new Promise(done=>{const path=join(dir,'s-'+Math.random().toString(36).slice(2)+'.sql');writeFileSync(path,sql);chmodSync(path,0o644);
 const cmd=`${bin}/psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -h ${dir} -p ${port} -d postgres -f ${path} 2>&1`;const child=spawn(asRoot?'su':'sh',asRoot?['postgres','-s','/bin/sh','-c',cmd]:['-c',cmd]);
 let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);child.on('close',code=>done({code,out}));});
const direct=(rid,product,unit,ml,cl)=>`select app_private.cos_owner_product_link_record('${rid}','${ORG}','approve','${product}','${unit}','${ml}','${cl}','James Martin','Concurrent test approval source text.',now(),'Concurrent test approval reason.',null,'reviewed_install',null);`;
test('two approvals racing for the same COS record: exactly one is recorded; a load arriving meanwhile is not held up',{skip},async()=>{
 psql(`insert into public.equipment_units values('${id(700)}','${ORG}','Spotter 700','available',null);`);
 load('d'.repeat(64),[...base(),rec('7000001','Spotter 700'),rec('7000002','Spotter 700B')]);
 const first=session(`begin; ${direct(id(71),'7000001',id(700),'Spotter 700','Spotter 700')} select pg_sleep(1.5); commit;`);
 await new Promise(r=>setTimeout(r,500));
 const started=Date.now();load('e'.repeat(64),[...base(),rec('7000001','Spotter 700'),rec('7000002','Spotter 700B')]);
 assert.ok(Date.now()-started<900,'a batch insert must not wait for an approval in progress');
 const second=await session(direct(id(72),'7000002',id(700),'Spotter 700B','Spotter 700'));
 assert.equal((await first).code,0);assert.notEqual(second.code,0);assert.match(second.out,/already has a live approval/);
 assert.deepEqual(active().filter(l=>l.unitId===id(700)).map(l=>l.productId),['7000001']);
});
test('the source changing while an approval waits is seen: the approval is checked against the load that is current when it runs',{skip},async()=>{
 psql(`insert into public.equipment_units values('${id(800)}','${ORG}','Spotter 800','available',null),('${id(801)}','${ORG}','Spotter 801','available',null);`);
 const withUnits=label=>[...base(),rec('7000001','Spotter 700'),rec('8000001','Spotter 800'),rec('8000002',label)];
 load('f'.repeat(64),withUnits('Spotter 801'));
 const holder=session(`begin; ${direct(id(81),'8000001',id(800),'Spotter 800','Spotter 800')} select pg_sleep(1.5); commit;`);
 await new Promise(r=>setTimeout(r,400));
 const waiting=session(direct(id(82),'8000002',id(801),'Spotter 801','Spotter 801'));                          // queued behind the first approval
 await new Promise(r=>setTimeout(r,300));load('9'.repeat(64),withUnits('Spotter 801 REPLACED'));               // mHelp renames it while the approval waits
 assert.equal((await holder).code,0);const out=await waiting;assert.notEqual(out.code,0);assert.match(out.out,/flagged, already linked, renamed or under a hold/);
 assert.equal(active().some(l=>l.productId==='8000002'),false);
});
test('approvals and revocations never write to an equipment record',{skip},()=>{
 assert.equal(psql(`select md5(string_agg(to_jsonb(u)::text,'' order by id)) from public.equipment_units u where id in('${U12}','${U281}','${U28}','${U18}','${U11}');`),units0);
});
