import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixture,reset,seed,reserve,finish,rpc as ownerRpc,credits,ORG,OWNER,hash} from './fixtures/geocodio-database-fixture.mjs';
let db;
before(async()=>{db=await fixture({imported:true});});
beforeEach(async()=>reset(db));
after(async()=>db?.close());
const reasons=['no_match','provider_empty','ambiguous_results','provider_warning','invalid_components','component_mismatch','formatted_address_mismatch','unsupported_method','low_accuracy','invalid_coordinates','provider_rejected'];
const binding=(zip='77002-1234')=>{
 const installation={street:'1 Main St',city:'Houston',state:'TX',zip};
 const address=['1 Main St','Houston',['TX',zip].filter(Boolean).join(' ')].join(', ').toLowerCase();
 return {schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:'1',unitNumber:'SPOTTER 1',family:'SPOTTER',variant:null,sourceRevision:randomUUID(),sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:hash(address),nativeGuardSha256:'c'.repeat(64),installation,suppliedComponents:{street:true,city:true,state:true,zip:zip!==null},eligibility:'FIELD',eventId:'1'};
};
async function rpc(name,args={},role='service_role'){
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[OWNER]);await db.exec(`set role ${role}`);
 try{return (await db.query(`select public.cos_imported_geocode_${name}(${Object.keys({p_organization_id:ORG,...args}).map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values({p_organization_id:ORG,...args}))).rows[0].result;}
 finally{await db.exec('reset role');}
}
async function sync(b){const c=await rpc('cursor_read');return rpc('sync',{p_scan_generation:c.scanGeneration,p_after_event_id:'0',p_next_event_id:'1',p_events:[{eventId:b.eventId,entityKind:b.entityKind,nativeUnitId:b.nativeUnitId,productId:b.productId,sourceRevision:b.sourceRevision,source:b}]});}
const claim=b=>rpc('census_claim',{p_binding:b,p_request_id:randomUUID()});
const census=(b,t,result)=>rpc('census_finish',{p_binding:b,p_claim_token:t,p_source_current:true,...result});
const geo=(b,t,result)=>rpc('finish',{p_binding:b,p_reservation_token:t,p_source_current:true,...result});
const success=zip=>({p_status:'success',p_latitude:29.1,p_longitude:-95.1,p_matched_address:`1 Main St, Houston, TX ${zip}`});
const paidSuccess=zip=>({...success(zip),p_accuracy_type:'rooftop',p_accuracy:1,p_match_type:'building_centroid'});
const read=b=>rpc('read_many',{p_bindings:[b]});
async function paid(b){await census(b,(await claim(b)).claimToken,{p_status:'no_match'});return rpc('reserve',{p_binding:b,p_request_id:randomUUID()});}

test('postal equivalence preserves leading zeros, permits precision differences and rejects malformed/conflicting ZIPs',async()=>{
 for(const [a,b,want] of [
  ['77002-1234','77002',true],['77002','77002-1234',true],['77002-1234','77002-1234',true],['00501-1234','00501',true],
  ['77002-1234','77002-9999',false],['77002-1234','77003',false],['00501','501',false],['00501','05001',false],
  ['770021234','77002',false],['77002','77002-123',false],['77002','77002-12345',false],['77002','77002 junk',false],
  ['77002',' 77002',false],['77002','７７００２',false],['77002','SW1A 1AA',false],[null,'77002',false],['77002',null,false]
 ])assert.equal((await db.query('select app_private.cos_postal_equivalent($1,$2) ok',[a,b])).rows[0].ok,want,`${a} / ${b}`);
 for(const address of ['1 Main St, Houston, TX 77002-12345','1 Main St, Houston, XX 77002','1 Main St, Houston, TX 177002','1 Main St, Houston, TX 77002 US','1 Main St, Houston, TX 77002\n'])
  assert.equal((await db.query('select app_private.cos_postal_matched_zip($1) zip',[address])).rows[0].zip,null,address);
 for(const zip of [77002,501,'77002-9999'])
  assert.equal((await db.query('select app_private.cos_imported_matched_postal($1,$2) ok',[{installation:{zip}},'1 Main St, Houston, TX 77002-1234'])).rows[0].ok,false);
});

test('imported Census stores same-ZIP5 results under unchanged ZIP+4 source hash and binding',async()=>{
 for(const zip of ['77002-1234','00501-1234']){
  await reset(db);const b=binding(zip);await sync(b);const r=await claim(b);
  const saved=await census(b,r.claimToken,success(zip.slice(0,5)));assert.equal(saved.accepted,true);assert.equal(saved.record.status,'success');
  assert.deepEqual(saved.record.binding,b);assert.equal(saved.record.address.endsWith(zip),true);assert.equal(saved.record.matchedAddress.endsWith(zip.slice(0,5)),true);
  assert.deepEqual((await read(b))[0].binding,b);assert.equal((await read(b))[0].status,'success');assert.equal(await credits(db),0);
  const cache=(await db.query('select address_sha256,address from app_private.cos_imported_census_cache')).rows[0];
  assert.equal(cache.address_sha256,b.addressSha256);assert.equal(hash(cache.address),b.addressSha256);
 }
});

test('ZIP5 sources may match ZIP+4 and omitted optional parts retain their supplied-component policy',async()=>{
 for(const mode of ['zip5','no-city','no-zip']){
  await reset(db);const b=binding(mode==='no-zip'?null:mode==='zip5'?'77002':'77002-1234');
  if(mode==='no-city'){
   b.installation.city=null;b.suppliedComponents.city=false;
   b.addressSha256=hash('1 main st, tx 77002-1234');
  }
  await sync(b);const c=await claim(b);const saved=await census(b,c.claimToken,success('77002-1234'));
  assert.equal(saved.accepted,true);assert.equal(saved.record.status,'success');assert.deepEqual(saved.record.binding,b);
  assert.equal((await read(b))[0].status,'success');
 }
});

test('imported Geocodio and basic fallback accept matching ZIP5 without collapsing source identity',async()=>{
 const b=binding();await sync(b);const r=await paid(b);const result=await geo(b,r.reservationToken,paidSuccess('77002'));
 assert.equal(result.accepted,true);assert.equal((await read(b))[0].status,'success');assert.equal(result.record.binding.addressSha256,b.addressSha256);assert.equal(await credits(db),1);
 const key=await seed(db,{unit:'Other',address:'1 main st, houston, tx 77002-1234'});
 assert.equal((await reserve(db,key)).reason,'cache_hit');assert.equal((await ownerRpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']}))[0].status,'success');assert.equal(await credits(db),1);
 await reset(db);const basic=await seed(db,{address:'1 main st, houston, tx 00501-1234'});const reserved=await reserve(db,basic);
 assert.equal((await finish(db,basic,reserved.reservationToken,paidSuccess('00501'))).accepted,true);assert.equal(await credits(db),1);
});

test('persistence rejects conflicting full ZIP+4, different ZIP5 and malformed matched postal strings',async()=>{
 const b=binding();await sync(b);const c=await claim(b);
 for(const zip of ['77002-9999','77003','770021234','77002-12345','SW1A 1AA'])await assert.rejects(census(b,c.claimToken,success(zip)),/Invalid safe Census result/);
 assert.equal((await read(b))[0].status,'pending');assert.equal(await credits(db),0);
 await census(b,c.claimToken,{p_status:'no_match'});const r=await rpc('reserve',{p_binding:b,p_request_id:randomUUID()});
 for(const zip of ['77002-9999','77003','770021234','77002-12345'])await assert.rejects(geo(b,r.reservationToken,paidSuccess(zip)),/Invalid safe fallback result/);
 assert.equal(await credits(db),1);assert.equal((await geo(b,r.reservationToken,paidSuccess('77002'))).accepted,true);
 await reset(db);const k=await seed(db,{address:'1 main st, houston, tx 77002-1234'});const o=await reserve(db,k);
 await assert.rejects(finish(db,k,o.reservationToken,paidSuccess('77002-9999')),/Invalid safe fallback result/);assert.equal(await credits(db),1);
});

test('read and cache-hit projections suppress historical conflicting ZIPs without rewriting stored success',async()=>{
 const b=binding();await sync(b);const c=await claim(b);await census(b,c.claimToken,success('77002'));
 await db.exec("update app_private.cos_imported_census_cache set matched_address='1 Main St, Houston, TX 77002-9999'");
 let r=(await read(b))[0];assert.equal(r.status,'no_match');assert.equal(r.reason,'formatted_address_mismatch');assert.equal(r.latitude,null);assert.equal(r.matchedAddress,null);
 assert.equal((await claim(b)).record.latitude,null);assert.equal((await db.query('select status from app_private.cos_imported_census_cache')).rows[0].status,'success');
 await reset(db);await sync(b);await geo(b,(await paid(b)).reservationToken,paidSuccess('77002'));
 await db.exec("update app_private.cos_field_geocode_fallback_cache set matched_address='1 Main St, Houston, TX 77003'");
 r=(await read(b))[0];assert.equal(r.status,'no_match');assert.equal(r.latitude,null);assert.equal(r.accuracy,null);
 assert.equal((await rpc('reserve',{p_binding:b,p_request_id:randomUUID()})).record.latitude,null);
 const k=await seed(db,{unit:'Other',address:'1 main st, houston, tx 77002-1234'});
 assert.equal((await reserve(db,k)).record.latitude,null);assert.equal((await ownerRpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']}))[0].reason,'formatted_address_mismatch');
 assert.equal((await db.query('select status from app_private.cos_field_geocode_fallback_cache')).rows[0].status,'success');assert.equal(await credits(db),1);
});

test('safe rejection reasons survive Census, imported Geocodio and basic fallback while status remains no_match',async()=>{
 for(const reason of reasons){
  await reset(db);const b=binding();await sync(b);const c=await claim(b);
  const noMatch={p_status:'no_match',p_reason:reason};const saved=await census(b,c.claimToken,noMatch);
  assert.equal(saved.record.reason,reason);assert.equal(saved.record.status,'no_match');assert.equal(saved.record.latitude,null);assert.equal((await census(b,c.claimToken,noMatch)).accepted,true);
  const r=await rpc('reserve',{p_binding:b,p_request_id:randomUUID()});const g=await geo(b,r.reservationToken,noMatch);
  assert.equal(g.record.reason,reason);assert.equal(g.record.status,'no_match');assert.equal((await read(b))[0].reason,reason);assert.equal((await geo(b,r.reservationToken,noMatch)).accepted,true);assert.equal(await credits(db),1);
  await reset(db);const k=await seed(db);const o=await reserve(db,k);const savedOwner=await finish(db,k,o.reservationToken,noMatch);
  assert.equal(savedOwner.record.reason,reason);assert.equal(savedOwner.record.status,'no_match');assert.equal(savedOwner.record.latitude,null);
 }
});

test('unknown or mixed-status reason payloads fail closed; omission keeps historical no_match',async()=>{
 const b=binding();await sync(b);const c=await claim(b);
 for(const reason of ['secret=provider-body','', 'provider_timeout','invalid_address'])await assert.rejects(census(b,c.claimToken,{p_status:'no_match',p_reason:reason}));
 await assert.rejects(census(b,c.claimToken,{p_status:'provider_error',p_reason:'component_mismatch'}));
 await assert.rejects(census(b,c.claimToken,{p_status:'no_match',p_reason:'invalid_coordinates',p_latitude:29}));
 assert.equal((await census(b,c.claimToken,{p_status:'no_match'})).record.reason,'no_match');
 const r=await rpc('reserve',{p_binding:b,p_request_id:randomUUID()});
 await assert.rejects(geo(b,r.reservationToken,{p_status:'no_match',p_reason:'provider_forbidden'}));
 await assert.rejects(geo(b,r.reservationToken,{p_status:'provider_error',p_reason:'low_accuracy'}));
 await assert.rejects(geo(b,r.reservationToken,{p_status:'no_match',p_reason:'provider_empty',p_retry_after_seconds:60}));
 assert.equal((await geo(b,r.reservationToken,{p_status:'no_match'})).record.reason,'no_match');
 assert.equal(await credits(db),1);
});

test('migrations are idempotent with stable RPC identities/ACLs and no source, credit, attempt or success changes',async()=>{
 const b=binding();await sync(b);await geo(b,(await paid(b)).reservationToken,paidSuccess('77002'));
 const signature=()=>db.query("select p.oid,p.proname,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'cos_field_geocode_fallback_%' or p.proname like 'cos_imported_geocode_%') order by p.proname");
 const snapshot=async()=>{
  const rows={};for(const table of ['cos_imported_geocode_jobs','cos_imported_census_cache','cos_imported_census_requests','cos_field_geocode_fallback_cache','cos_geocodio_reservations','cos_geocodio_daily_budget'])rows[table]=(await db.query(`select to_jsonb(t) value from app_private.${table} t order by to_jsonb(t)::text`)).rows;
  return rows;
 };
 const identities=(await signature()).rows,before=await snapshot();
 for(let i=0;i<2;i++)for(const name of ['geocodio-postal-precision-rejections.sql','geocodio-imported-postal-precision-rejections.sql'])await db.exec(await readFile(new URL(`../db/${name}`,import.meta.url),'utf8'));
 assert.deepEqual((await signature()).rows,identities);assert.deepEqual(await snapshot(),before);
 assert.equal((await read(b))[0].status,'success');assert.equal(await credits(db),1);
 const names=['app_private.cos_postal_equivalent(text,text)','app_private.cos_postal_matched_zip(text)','app_private.cos_postal_safe_no_match_reason(text)','app_private.cos_imported_matched_postal(jsonb,text)'];
 for(const name of names){
  const acl=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[name])).rows[0];
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
 }
 await assert.rejects(rpc('finish',{p_binding:b,p_reservation_token:randomUUID(),p_source_current:true,p_status:'no_match',p_reason:'provider_empty'},'authenticated'));
});
