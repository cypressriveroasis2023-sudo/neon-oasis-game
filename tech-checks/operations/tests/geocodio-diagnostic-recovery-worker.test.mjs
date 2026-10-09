import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {fixture as nativeFixture,seed,install,rpc as nativeRPC,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
import {fixture as legacyFixture} from './fixtures/geocodio-database-fixture.mjs';
import {createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {projectImportedSourceAddresses,projectImportedGeocodes} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
const serial=fn=>{let prior=Promise.resolve();return (...args)=>{const next=prior.then(()=>fn(...args));prior=next.catch(()=>{});return next;};};
const json=x=>new Response(JSON.stringify(x));
test('unchanged live-v9 worker drains diagnostic queue through guards, selectors, ledger, and shared honest map pins',async()=>{
 const native=await nativeFixture(),legacy=await legacyFixture({imported:true});
 try{
  for(const name of ['geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql','geocodio-diagnostic-recovery-v1.sql'])await legacy.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
  await legacy.exec('update app_private.cos_geocodio_control set enabled=true,free_only=true;');
  const sources=[];
  for(let i=0;i<5;i++){
   const rec=await seed(native,{label:`HELIOS ${100+i}HDC4`,product:String(10000+i)});
   rec.installation={street:`${i===4?100:100+i} Main St`,city:'Houston',state:'TX',zip:'77002'};
   rec.addressSha256=hash(`${rec.installation.street}, Houston, TX 77002`.toLowerCase());
   sources.push(...await install(native,[rec]));
  }
  const rpc=serial(async(name,args)=>{
   await legacy.exec('set role service_role');
   try{return (await legacy.query(`select public.${name}(${Object.keys(args).map((n,i)=>n+'=>$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}
   catch(error){console.error(name,error.message);throw error;}finally{await legacy.exec('reset role');}
  });
  const key='a'.repeat(64),bridge=createGeocodeSourcesHandler({readKey:key,rpc:serial((name,args)=>nativeRPC(native,name.replace('cos_geocode_sources_',''),args))});
  let recovering=false,active=0;const calls=[],finished=[];
  const fetch=async(url,init)=>{
   const u=new URL(url);
   if(u.hostname==='tughscoxralhofrckvxy.supabase.co')return bridge(new Request(url,init));
   assert.ok(['geocoding.geo.census.gov','api.geocod.io'].includes(u.hostname),'all provider traffic is intercepted');
   const stage=u.hostname==='api.geocod.io'?'geocodio':'census',street=u.searchParams.get('street'),n=Number(street.split(' ')[0]);
   active++;
   try{
    if(!recovering)return json({result:{addressMatches:[]}});
    calls.push([stage,n]);await new Promise(r=>setTimeout(r,n===101?30:1));
    if(stage==='census')return json({result:{addressMatches:n===100?[{matchedAddress:`${street}, Houston, TX 77002`,coordinates:{x:-95,y:29}}]:[]}});
    if(n===102)return new Response('',{status:503});
    if(n===103)await native.query('update equipment_units set gps_latitude=31,gps_longitude=-96 where id=$1',[sources[3].nativeUnitId]);
    return json({results:[{address_components:{number:String(n),formatted_street:'Main St',city:'Houston',state_province:'TX',postal_code:'77002',country:'US'},formatted_address:`${street}, Houston, TX 77002`,location:{lat:29,lng:-95},accuracy:1,accuracy_type:'rooftop'}]});
   }finally{active--;}
  };
  const run=()=>processImportedGeocodes({rpc:async(name,args)=>{const r=await rpc(name,args);if(name.endsWith('_finish'))finished.push({name,args,result:r});return r;},fetch,sourceReadKey:key,geocodioApiKey:recovering?'fixture-only':undefined,deadlineMs:Date.now()+100000});
  await run();
  // Synthetic history only. No production cache, source data or real provider calls.
  await legacy.exec(`update app_private.cos_imported_census_cache set reason='no_match',attempts=1,attempt_day='2026-10-08',updated_at='2026-10-08T22:00Z',geocoded_at='2026-10-08T22:00Z';
   insert into app_private.cos_field_geocode_fallback_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,updated_at,geocoded_at)
    select organization_id,address_sha256,address,'no_match','no_match',1,'2026-10-08','2026-10-08T22:00Z','2026-10-08T22:00Z' from app_private.cos_imported_census_cache;`);
  const manifest=sources.slice(0,4).map(binding=>({binding,censusUpdatedAt:'2026-10-08T22:00Z',geocodioUpdatedAt:'2026-10-08T22:00Z'}));
  const operator=await readFile(new URL('../db/geocodio-diagnostic-recovery-v1-operator.sql',import.meta.url),'utf8');
  await legacy.query("select set_config('cos.reviewed_diagnostic_manifest',$1,false)",[JSON.stringify(manifest)]);
  await legacy.exec('set role service_role;'+operator.slice(operator.indexOf('do $$'),operator.indexOf('\nselect diagnostic_recovery_v1'))+'reset role;');
  const before=(await legacy.query('select diagnostic_recovery_v1 from app_private.cos_geocodio_account_state')).rows[0].diagnostic_recovery_v1;
  recovering=true;finished.length=0;
  const result=await run();
  assert.equal(active,0);assert.equal(result.censusSucceeded,1);assert.equal(result.geocodioSucceeded,1);assert.equal(result.stale,1);
  assert.equal(calls.filter(c=>c[0]==='census').length,4);assert.equal(calls.filter(c=>c[0]==='geocodio').length,3);
  assert.equal(calls.filter(c=>c[1]===100).length,1,'shared address receives only one Census request');
  assert.equal(finished.filter(x=>x.name==='cos_imported_geocode_finish'&&x.args.p_source_current===false).length,1);
  assert.equal(Number((await legacy.query('select sum(credits) credits from app_private.cos_geocodio_daily_budget')).rows[0].credits),3);
  const bindings=sources.slice(0,3).concat(sources[4]);
  const sourceRows=await nativeRPC(native,'map_projection',{p_organization_id:ORG,p_identities:bindings.map(s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}))});
  const raw=bindings.map(s=>({id:s.nativeUnitId,unitNumber:s.unitNumber,readOnly:false,_sourceField:false,modelName:s.family,status:'available',currentLocationType:null,hasUnitGps:false,latitude:null,longitude:null,address:null}));
  const overlay=await projectImportedSourceAddresses({items:[],inventoryItems:raw,summary:{}},sourceRows,[],[]);
  const records=await rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:bindings});
  const map=await projectImportedGeocodes(overlay,records,[],[]);
  for(const i of [0,1,4]){
   const row=map.items.find(r=>r.id===sources[i].nativeUnitId),point=await checkedAddressEstimate(row);
   assert.ok(point);assert.equal(point.latitude,29);assert.equal(row.hasUnitGps,false);assert.equal(row.latitude,null);
  }
  assert.equal(await checkedAddressEstimate(map.items.find(r=>r.id===sources[2].nativeUnitId)),null);
  const oldCalls=calls.slice();await run();assert.deepEqual(calls,oldCalls,'next ordinary sweep cannot resend spent diagnostic attempts');
  const after=(await legacy.query('select diagnostic_recovery_v1 from app_private.cos_geocodio_account_state')).rows[0].diagnostic_recovery_v1;
  for(const sha of Object.keys(before.jobs))for(const field of ['binding','censusBefore','fallbackBefore'])assert.deepEqual(after.jobs[sha][field],before.jobs[sha][field]);
  assert.equal(Number((await legacy.query('select count(*) n from app_private.cos_imported_postal_retry_jobs')).rows[0].n),0);
 }finally{await native.close();await legacy.close();}
});
